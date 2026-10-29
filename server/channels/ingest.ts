// Single entry point for DMs received by the open-source adapters. It mirrors what the
// Meta webhook handlers do (dedupe, conversation, stored customer message, opening greeting)
// and then hands the message to the existing AI Agent pipeline via handleInboundCustomerMessage.
import { prisma } from '../db';
import { handleInboundCustomerMessage } from '../inboundBatcher';
import { IMAGE_PLACEHOLDER_TEXT, sendOpeningGreetingIfNew } from '../conversationEngine';
import { saveChatImage } from '../mediaStorage';
import { transcribeVoiceMessage } from '../voiceMessages';
import type { ChannelAdapterType } from './config';

export interface InboundDm {
  storeId: string;
  channelType: ChannelAdapterType;
  externalUserId: string;
  externalMessageId: string;
  text?: string;
  customerName?: string | null;
  avatarUrl?: string | null;
  image?: Buffer;
  audio?: Buffer;
}

export async function ingestInboundDm(dm: InboundDm): Promise<void> {
  const externalId = `${dm.channelType.toLowerCase()}:${dm.externalMessageId}`;
  if (await prisma.message.findUnique({ where: { externalId } })) return;

  const transcript = dm.audio ? await transcribeVoiceMessage(dm.audio) : null;
  const messageText = dm.text?.trim() || (dm.audio ? 'Customer sent a voice message.' : IMAGE_PLACEHOLDER_TEXT);
  const agentText = transcript || messageText;

  const { storeId, channelType, externalUserId } = dm;
  let conversation = await prisma.conversation.findFirst({ where: { storeId, channelType, externalUserId } });
  const isNewConversation = !conversation;
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { storeId, channelType, externalUserId, customerName: dm.customerName || undefined, avatarUrl: dm.avatarUrl || undefined, lastMessageAt: new Date() },
    });
  } else if ((dm.customerName && conversation.customerName !== dm.customerName) || (dm.avatarUrl && !conversation.avatarUrl)) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        ...(dm.customerName ? { customerName: dm.customerName } : {}),
        ...(dm.avatarUrl && !conversation.avatarUrl ? { avatarUrl: dm.avatarUrl, avatarFetchedAt: new Date() } : {}),
      },
    });
  }

  const savedImageUrl = dm.image ? await saveChatImage(storeId, dm.image).catch(() => null) : null;
  try {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: 'CUSTOMER',
        text: messageText,
        imageUrl: savedImageUrl || undefined,
        transcript,
        mediaType: dm.audio ? 'audio' : dm.image ? 'image' : undefined,
        externalId,
      },
    });
  } catch (err: any) {
    if (err.code === 'P2002') return;
    throw err;
  }

  const greetedInstead = await sendOpeningGreetingIfNew(isNewConversation, conversation);
  if (!greetedInstead || dm.image) await handleInboundCustomerMessage(conversation, agentText, dm.image);
}
