// Baileys auth state stored in Postgres (replaces useMultiFileAuthState) so WhatsApp stays
// paired across restarts and redeploys without needing a persistent disk.
//
// Pairing makes Baileys write hundreds of signal keys within seconds; a database round trip per
// key is far too slow and makes WhatsApp reject the link ("couldn't link device"). So all keys
// are loaded into memory once, served from memory, and flushed to the database in batches.
import { prisma } from '../db';

const FLUSH_DELAY_MS = 250;
const BATCH_SIZE = 200;

export async function useDbAuthState(channelId: string) {
  const { initAuthCreds, BufferJSON, proto }: any = await import('@whiskeysockets/baileys');

  const cache = new Map<string, string>();
  const rows = await prisma.whatsAppAuthState.findMany({ where: { channelId }, select: { key: true, value: true } });
  rows.forEach((r) => cache.set(r.key, r.value));

  const dirty = new Map<string, string | null>();
  let timer: NodeJS.Timeout | null = null;
  let flushing: Promise<void> = Promise.resolve();

  const flushNow = () => {
    flushing = flushing.then(async () => {
      if (!dirty.size) return;
      const pending = [...dirty.entries()];
      dirty.clear();
      const upserts = pending.filter(([, v]) => v !== null) as [string, string][];
      const removals = pending.filter(([, v]) => v === null).map(([k]) => k);
      try {
        for (let i = 0; i < upserts.length; i += BATCH_SIZE) {
          const chunk = upserts.slice(i, i + BATCH_SIZE);
          await prisma.$executeRaw`
            INSERT INTO "WhatsAppAuthState" ("channelId", "key", "value")
            SELECT ${channelId}, t.k, t.v FROM unnest(${chunk.map(([k]) => k)}::text[], ${chunk.map(([, v]) => v)}::text[]) AS t(k, v)
            ON CONFLICT ("channelId", "key") DO UPDATE SET "value" = EXCLUDED."value"`;
        }
        if (removals.length) await prisma.whatsAppAuthState.deleteMany({ where: { channelId, key: { in: removals } } });
      } catch (err) {
        console.error('[whatsapp] failed to persist auth state, will retry:', (err as Error)?.message);
        for (const [k, v] of pending) if (!dirty.has(k)) dirty.set(k, v);
        schedule();
      }
    });
    return flushing;
  };
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; void flushNow(); }, FLUSH_DELAY_MS);
  };
  const put = (key: string, data: unknown) => {
    const value = JSON.stringify(data, BufferJSON.replacer);
    cache.set(key, value);
    dirty.set(key, value);
    schedule();
  };
  const drop = (key: string) => {
    cache.delete(key);
    dirty.set(key, null);
    schedule();
  };
  const read = (key: string) => {
    const raw = cache.get(key);
    return raw === undefined ? null : JSON.parse(raw, BufferJSON.reviver);
  };

  const creds = read('creds') || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: Record<string, unknown> = {};
          for (const id of ids) {
            let value = read(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.create(value);
            data[id] = value;
          }
          return data;
        },
        set: async (data: Record<string, Record<string, unknown>>) => {
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              value ? put(`${category}-${id}`, value) : drop(`${category}-${id}`);
            }
          }
        },
      },
    },
    saveCreds: async () => put('creds', creds),
    flush: async () => {
      if (timer) { clearTimeout(timer); timer = null; }
      await flushNow();
    },
  };
}

export const clearWhatsAppAuth = (channelId: string) => prisma.whatsAppAuthState.deleteMany({ where: { channelId } });
