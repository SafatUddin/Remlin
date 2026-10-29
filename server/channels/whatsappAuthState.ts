// Baileys auth state stored in Postgres (replaces useMultiFileAuthState) so WhatsApp stays
// paired across restarts and redeploys without needing a persistent disk.
import { prisma } from '../db';

export async function useDbAuthState(channelId: string) {
  const { initAuthCreds, BufferJSON, proto }: any = await import('@whiskeysockets/baileys');

  const read = async (key: string) => {
    const row = await prisma.whatsAppAuthState.findUnique({ where: { channelId_key: { channelId, key } } });
    return row ? JSON.parse(row.value, BufferJSON.reviver) : null;
  };
  const write = (key: string, data: unknown) =>
    prisma.whatsAppAuthState.upsert({
      where: { channelId_key: { channelId, key } },
      update: { value: JSON.stringify(data, BufferJSON.replacer) },
      create: { channelId, key, value: JSON.stringify(data, BufferJSON.replacer) },
    });
  const remove = (key: string) => prisma.whatsAppAuthState.deleteMany({ where: { channelId, key } });

  const creds = (await read('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: Record<string, unknown> = {};
          await Promise.all(ids.map(async (id) => {
            let value = await read(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.create(value);
            data[id] = value;
          }));
          return data;
        },
        set: async (data: Record<string, Record<string, unknown>>) => {
          const tasks: Promise<unknown>[] = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              tasks.push(value ? write(`${category}-${id}`, value) : remove(`${category}-${id}`));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write('creds', creds),
  };
}

export const clearWhatsAppAuth = (channelId: string) => prisma.whatsAppAuthState.deleteMany({ where: { channelId } });
