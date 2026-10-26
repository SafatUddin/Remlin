// When a customer sends a photo, the reply waits a short window (30s by default) so a message
// typed right after it ("do you have this in red?", "add this to your shop") is answered
// together with the photo. Text that arrives with no photo pending is answered immediately.
//
// Batches live in this process's memory; with several server instances a customer's follow-up
// could land on another instance and be answered separately (not lost).
import { prisma } from './db';
import { generateAndStoreAgentReply, IMAGE_PLACEHOLDER_TEXT, startCatalogImageMatch } from './conversationEngine';
import type { VisualMatch } from './imageRecognition';

export const IMAGE_REPLY_WAIT_MS = Number(process.env.IMAGE_REPLY_WAIT_MS) > 0 ? Number(process.env.IMAGE_REPLY_WAIT_MS) : 30_000;

type ConversationRef = Parameters<typeof generateAndStoreAgentReply>[0];

interface PendingPhotoTurn {
  conversation: ConversationRef;
  image: Buffer;
  /** Catalog comparison started the moment the photo arrived, so it overlaps the wait. */
  match: Promise<VisualMatch>;
  texts: string[];
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingPhotoTurn>();

function scheduleFlush(conversationId: string) {
  return setTimeout(() => {
    void flush(conversationId);
  }, IMAGE_REPLY_WAIT_MS);
}

function startMatch(storeId: string, image: Buffer): Promise<VisualMatch> {
  const match = startCatalogImageMatch(storeId, image).catch((err): VisualMatch => {
    console.error('Catalog image match failed:', err);
    return { match: 'unavailable', sku: null, confidence: 0, candidates: [] };
  });
  return match;
}

async function flush(conversationId: string) {
  const turn = pending.get(conversationId);
  if (!turn) return;
  pending.delete(conversationId);
  try {
    // Re-read the conversation: the merchant may have switched autopilot on/off meanwhile.
    const latest = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!latest) return;
    const text = turn.texts.join('\n').trim() || IMAGE_PLACEHOLDER_TEXT;
    await generateAndStoreAgentReply(latest, text, turn.image, turn.match);
  } catch (err) {
    console.error('Failed to reply to customer photo:', err);
  }
}

/**
 * Entry point for every inbound customer chat message (after it has been stored).
 * Photos start (or restart) the wait window; texts during the window join it.
 */
export async function handleInboundCustomerMessage(
  conversation: ConversationRef,
  text: string,
  image?: Buffer,
): Promise<void> {
  const words = text.trim() && text.trim() !== IMAGE_PLACEHOLDER_TEXT ? text.trim() : '';
  const existing = pending.get(conversation.id);

  if (image) {
    if (existing) {
      clearTimeout(existing.timer);
      existing.image = image;
      existing.match = startMatch(conversation.storeId, image);
      if (words) existing.texts.push(words);
      existing.timer = scheduleFlush(conversation.id);
    } else {
      pending.set(conversation.id, {
        conversation,
        image,
        match: startMatch(conversation.storeId, image),
        texts: words ? [words] : [],
        timer: scheduleFlush(conversation.id),
      });
    }
    return;
  }

  if (existing) {
    if (words) existing.texts.push(words);
    return;
  }

  await generateAndStoreAgentReply(conversation, text);
}

/** Test helper: answers any waiting photo immediately. */
export async function flushPendingPhotoTurns(): Promise<void> {
  const ids = [...pending.keys()];
  ids.forEach((id) => clearTimeout(pending.get(id)!.timer));
  await Promise.all(ids.map(flush));
}
