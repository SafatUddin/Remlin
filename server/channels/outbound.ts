import { downloadInboundImage } from '../imageRecognition';
import { guardedDm } from './antiBan';
import { getAdapter } from './types';

/**
 * Delivers an AI/merchant WhatsApp message through the linked-device (QR) session, after the
 * anti-ban typing delay. Returns true when the conversation is a WhatsApp one (whether or not the
 * send succeeded) so callers skip the Meta Cloud API path.
 */
export async function deliverChannelMessage(
  conversation: { storeId: string; channelType: string; externalUserId: string | null },
  text: string,
  imageUrl?: string,
): Promise<boolean> {
  if (conversation.channelType !== 'WHATSAPP') return false;
  const recipient = conversation.externalUserId;
  const adapter = getAdapter(conversation.storeId, 'WHATSAPP');
  if (!recipient) return true;
  if (!adapter) {
    console.error('No active WhatsApp session for store; reply not delivered');
    return true;
  }
  try {
    await guardedDm(
      `${conversation.storeId}:WHATSAPP`,
      async () => {
        await adapter.sendText(recipient, text);
        if (imageUrl) {
          const image = await downloadInboundImage(imageUrl);
          if (image) await adapter.sendImage(recipient, image);
        }
      },
      adapter.typing ? () => adapter.typing!(recipient) : undefined,
    );
  } catch (err) {
    console.error('Failed to deliver WhatsApp reply:', (err as Error)?.message);
  }
  return true;
}
