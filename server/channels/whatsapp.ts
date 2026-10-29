// WhatsApp via Baileys (WhatsApp Web multi-device). The user scans a QR code once; the
// auth keys live in the database (WhatsAppAuthState, keyed by channel id) so the session survives
// restarts and redeploys.
import QRCode from 'qrcode';
import pino from 'pino';
import { prisma } from '../db';
import { humanPause } from './antiBan';
import { ingestInboundDm } from './ingest';
import { registerAdapter, unregisterAdapter, type DmAdapter } from './types';
import { saveConnectedChannel } from './sessionStore';
import { useDbAuthState, clearWhatsAppAuth } from './whatsappAuthState';
import { isChannelOwnershipError } from '../channelSecurity';

export type WhatsAppStatus = 'idle' | 'starting' | 'qr' | 'connected' | 'error';

interface WaSession {
  storeId: string;
  channelId: string;
  sock: any;
  status: WhatsAppStatus;
  qr: string | null;
  phone: string | null;
  error: string | null;
  stopped: boolean;
  adapter: DmAdapter;
}

const sessions = new Map<string, WaSession>();
const logger = pino({ level: 'silent' });

const toJid = (id: string) => (id.includes('@') ? id : `${id}@s.whatsapp.net`);
const digits = (jid: string) => jid.split('@')[0].split(':')[0];

export function getWhatsAppState(storeId: string) {
  const s = sessions.get(storeId);
  return { status: (s?.status ?? 'idle') as WhatsAppStatus, qr: s?.qr ?? null, phone: s?.phone ?? null, error: s?.error ?? null };
}

export async function startWhatsApp(storeId: string) {
  const existing = sessions.get(storeId);
  if (existing && !existing.stopped && existing.status !== 'error') return;

  // The Channel row exists (disconnected) before pairing so the auth folder can be keyed by channel id.
  const channel = await prisma.channel.upsert({
    where: { storeId_type: { storeId, type: 'WHATSAPP' } },
    update: {},
    create: { storeId, type: 'WHATSAPP', connected: false },
  });

  const session: WaSession = {
    storeId,
    channelId: channel.id,
    sock: null,
    status: 'starting',
    qr: null,
    phone: null,
    error: null,
    stopped: false,
    adapter: null as unknown as DmAdapter,
  };
  session.adapter = {
    typing: async (recipient) => { await session.sock?.sendPresenceUpdate('composing', toJid(recipient)); },
    sendText: async (recipient, text) => {
      const jid = toJid(recipient);
      await session.sock.sendMessage(jid, { text });
      await session.sock.sendPresenceUpdate('paused', jid).catch(() => undefined);
    },
    sendImage: async (recipient, image) => { await session.sock.sendMessage(toJid(recipient), { image }); },
    stop: async () => stopSession(session, false),
  };
  sessions.set(storeId, session);
  await connect(session);
}

async function connect(session: WaSession) {
  const baileys: any = await import('@whiskeysockets/baileys');
  const makeWASocket = baileys.default?.default ?? baileys.default ?? baileys.makeWASocket;
  const { DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = baileys;

  const { state, saveCreds } = await useDbAuthState(session.channelId);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  const sock = makeWASocket({ auth: state, version, logger, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false });
  session.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update: any) => {
    if (session.stopped || session.sock !== sock) return;
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      session.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      session.status = 'qr';
    }
    if (connection === 'open') {
      const phone = digits(sock.user?.id || '');
      try {
        await saveConnectedChannel(session.storeId, 'WHATSAPP', phone, { name: `+${phone}`, phoneNumber: `+${phone}` });
      } catch (err) {
        session.error = isChannelOwnershipError(err) ? 'That WhatsApp number is already connected to another account.' : 'Failed to save the WhatsApp connection.';
        session.status = 'error';
        await stopSession(session, true);
        return;
      }
      session.phone = phone;
      session.qr = null;
      session.status = 'connected';
      registerAdapter(session.storeId, 'WHATSAPP', session.adapter);
    }
    if (connection === 'close') {
      unregisterAdapter(session.storeId, 'WHATSAPP', session.adapter);
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        session.error = 'WhatsApp logged this device out. Generate a new QR code to reconnect.';
        session.status = 'error';
        await stopSession(session, true);
        return;
      }
      session.status = 'starting';
      setTimeout(() => {
        if (!session.stopped) connect(session).catch((err) => {
          session.status = 'error';
          session.error = 'Could not reconnect to WhatsApp.';
          console.error('WhatsApp reconnect failed:', err?.message);
        });
      }, 2000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        await handleMessage(session, sock, msg, downloadMediaMessage);
      } catch (err) {
        console.error('WhatsApp message handling failed:', (err as Error)?.message);
      }
    }
  });
}

async function handleMessage(session: WaSession, sock: any, msg: any, downloadMediaMessage: any) {
  const jid: string | undefined = msg.key?.remoteJid;
  if (!jid || jid === 'status@broadcast' || msg.key.fromMe === true || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || !msg.message) return;

  const content = msg.message.ephemeralMessage?.message || msg.message;
  const text: string | undefined = content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption;
  const hasImage = !!content.imageMessage;
  const hasAudio = !!content.audioMessage;
  if (!text && !hasImage && !hasAudio) return;

  const phoneJid: string | undefined = msg.key.remoteJidAlt || (jid.endsWith('@s.whatsapp.net') ? jid : undefined);
  const externalUserId = phoneJid ? digits(phoneJid) : jid;
  const customerName: string | undefined = msg.pushName || (phoneJid ? `WhatsApp User (+${digits(phoneJid)})` : undefined);

  // Read receipt + typing presence, then a human-like pause before the agent is asked.
  await sock.readMessages([msg.key]).catch(() => undefined);
  await sock.sendPresenceUpdate('composing', jid).catch(() => undefined);
  await humanPause();

  const download = async (): Promise<Buffer | undefined> =>
    downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }).catch(() => undefined);

  await ingestInboundDm({
    storeId: session.storeId,
    channelType: 'WHATSAPP',
    externalUserId,
    externalMessageId: msg.key.id,
    text,
    customerName,
    image: hasImage ? await download() : undefined,
    audio: hasAudio ? await download() : undefined,
  });
}

async function stopSession(session: WaSession, wipeAuth: boolean) {
  session.stopped = true;
  unregisterAdapter(session.storeId, 'WHATSAPP', session.adapter);
  try {
    if (wipeAuth) await session.sock?.logout?.().catch(() => undefined);
    session.sock?.end?.(undefined);
  } catch {
    // socket already closed
  }
  if (wipeAuth) {
    await clearWhatsAppAuth(session.channelId);
    await prisma.channel.updateMany({ where: { id: session.channelId }, data: { connected: false, credentials: null as any, externalId: null } });
  }
  if (sessions.get(session.storeId) === session) {
    if (session.status === 'error') setTimeout(() => sessions.get(session.storeId) === session && sessions.delete(session.storeId), 60_000);
    else sessions.delete(session.storeId);
  }
}

export async function disconnectWhatsApp(storeId: string) {
  const session = sessions.get(storeId);
  if (session) return stopSession(session, true);
  const channel = await prisma.channel.findUnique({ where: { storeId_type: { storeId, type: 'WHATSAPP' } } });
  if (channel) await clearWhatsAppAuth(channel.id);
}

export async function restoreWhatsApp() {
  const channels = await prisma.channel.findMany({ where: { type: 'WHATSAPP', connected: true } });
  for (const c of channels) await startWhatsApp(c.storeId).catch((err) => console.error('WhatsApp restore failed:', err?.message));
}
