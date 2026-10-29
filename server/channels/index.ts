import { restoreWhatsApp } from './whatsapp';

/** Restores the persisted WhatsApp (QR) session after a server restart. */
export async function startChannelAdapters() {
  await restoreWhatsApp();
}
