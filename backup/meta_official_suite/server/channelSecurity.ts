import { ChannelType } from '@prisma/client';
import { prisma } from './db';

export const CHANNEL_ALREADY_CONNECTED_MESSAGE =
  'That channel is already connected to another account.';

export class ChannelOwnershipError extends Error {
  constructor(message = CHANNEL_ALREADY_CONNECTED_MESSAGE) {
    super(message);
    this.name = 'ChannelOwnershipError';
  }
}

/**
 * Ensures no other store already owns this provider channel identity.
 * Same-store reconnects are allowed. Does not expose other-store details.
 */
export async function assertChannelExternalIdAvailable(
  type: ChannelType,
  externalId: string,
  storeId: string,
): Promise<void> {
  if (!externalId) {
    throw new ChannelOwnershipError('Unable to connect integration');
  }

  const existing = await prisma.channel.findFirst({
    where: {
      type,
      externalId,
      NOT: { storeId },
    },
    select: { id: true },
  });

  if (existing) {
    throw new ChannelOwnershipError();
  }
}

/**
 * Resolve a connected channel by provider type + external identity.
 * Ownership comes only from the Channel row (never from webhook-supplied storeId).
 * After @@unique([type, externalId]), at most one row can match.
 */
export async function resolveConnectedChannelByExternalId(
  type: ChannelType,
  externalId: string,
) {
  if (!externalId) return null;

  const channel = await prisma.channel.findUnique({
    where: { type_externalId: { type, externalId } },
  });

  if (!channel?.connected) return null;
  return channel;
}

export function isChannelOwnershipError(err: unknown): err is ChannelOwnershipError {
  return err instanceof ChannelOwnershipError || (err as any)?.name === 'ChannelOwnershipError';
}

/** Prisma unique-constraint violation (race on connect). */
export function isUniqueConstraintError(err: unknown): boolean {
  return (err as any)?.code === 'P2002';
}
