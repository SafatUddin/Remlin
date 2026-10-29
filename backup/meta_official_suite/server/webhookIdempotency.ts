import { prisma } from './db';

/**
 * Atomically claim a webhook/event id for idempotent processing.
 * Returns true if this process owns the event; false if it was already processed.
 * Does not store webhook payloads or PII.
 */
export async function claimWebhookEvent(
  provider: string,
  eventId: string,
  eventType?: string,
): Promise<boolean> {
  if (!provider || !eventId) return false;

  try {
    await prisma.webhookEvent.create({
      data: {
        provider,
        eventId,
        eventType: eventType || null,
      },
    });
    return true;
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return false;
    }
    throw err;
  }
}
