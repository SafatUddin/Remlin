import { ChannelType } from '@prisma/client';
import { prisma } from '../db';
import { assertChannelExternalIdAvailable, isUniqueConstraintError, ChannelOwnershipError } from '../channelSecurity';

/** Marks a channel connected under its provider identity (e.g. the paired WhatsApp number). */
export async function saveConnectedChannel(storeId: string, type: ChannelType, externalId: string, meta: Record<string, unknown>) {
  await assertChannelExternalIdAvailable(type, externalId, storeId);
  try {
    return await prisma.channel.upsert({
      where: { storeId_type: { storeId, type } },
      update: { connected: true, externalId, credentials: meta as any },
      create: { storeId, type, connected: true, externalId, credentials: meta as any },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new ChannelOwnershipError();
    throw err;
  }
}
