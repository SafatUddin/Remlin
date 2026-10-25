import express from 'express';
import { prisma } from '../db';
import type { RequestWithRawBody } from '../types';
import {
  verifyMetaSignature,
  sendMessengerMessage,
  fetchMessengerProfile,
  fetchInstagramProfile,
  replyToFacebookComment,
  sendFacebookPrivateReply,
  replyToInstagramComment,
  sendInstagramPrivateReply,
} from '../meta';
import { isQuestionOrPriceInquiry } from '../agent';
import { resolveConnectedChannelByExternalId } from '../channelSecurity';
import { claimWebhookEvent } from '../webhookIdempotency';
import {
  getPageAccessTokenForStore,
  getInstagramCredentialsForStore,
  getWhatsAppCredentialsForStore,
  generateAndStoreAgentReply,
  sendOpeningGreetingIfNew,
} from '../conversationEngine';
import { downloadInboundImage } from '../imageRecognition';
import { downloadInboundAudio, transcribeVoiceMessage } from '../voiceMessages';

const isProduction = process.env.NODE_ENV === 'production';

// Meta's profile_pic URLs are short-lived signed CDN links (observed Instagram URLs
// expiring within ~24h) — refetch periodically rather than only once, or the stored
// avatarUrl silently rots into a dead link the first time it expires.
const AVATAR_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

function isProfileBackfillDue(conversation: { customerName: string | null; avatarUrl: string | null; avatarFetchedAt: Date | null }): boolean {
  if (!conversation.customerName || !conversation.avatarUrl || !conversation.avatarFetchedAt) return true;
  return Date.now() - conversation.avatarFetchedAt.getTime() > AVATAR_REFRESH_INTERVAL_MS;
}

export function createWebhooksRouter(): express.Router {
  const router = express.Router();

  // Meta webhook verification handshake (Messenger/Instagram/WhatsApp all use this same shape)
  router.get('/webhooks/meta', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });


  async function handleIncomingMessengerMessage(pageId: string, senderPsid: string, messageText: string, externalMessageId: string, imageUrl?: string, imageBuffer?: Buffer, audioUrl?: string, audioBuffer?: Buffer) {
    if (!isProduction) {
      console.log('[WEBHOOK] handleIncomingMessengerMessage — messageId:', externalMessageId);
    }
    // Meta's webhook delivery is "at-least-once" — it may redeliver the same event.
    // Bail out immediately if we've already recorded this exact message.
    const alreadyProcessed = await prisma.message.findUnique({ where: { externalId: externalMessageId } });
    if (alreadyProcessed) {
      console.log('Duplicate Messenger webhook event, skipping');
      return;
    }

    // A real self-serve OAuth connection always has a Channel row keyed by this exact
    // Page ID (see finalizeFacebookConnection). There is no fallback: a Page that hasn't
    // been connected through that flow has no known store to attach the message to, so
    // it's dropped rather than guessed at. Ownership comes only from the Channel row.
    const channel = await resolveConnectedChannelByExternalId('FACEBOOK', pageId);
    if (!channel) {
      console.error('Ignoring Messenger event for unconnected Page');
      return;
    }
    const storeId = channel.storeId;
    if (imageUrl && !imageBuffer) {
      const pageAccessToken = await getPageAccessTokenForStore(storeId);
      imageBuffer = await downloadInboundImage(imageUrl, pageAccessToken || undefined) || undefined;
    }
    if (audioUrl && !audioBuffer) {
      const pageAccessToken = await getPageAccessTokenForStore(storeId);
      audioBuffer = await downloadInboundAudio(audioUrl, pageAccessToken || undefined) || undefined;
    }
    const transcript = audioBuffer ? await transcribeVoiceMessage(audioBuffer) : null;
    const agentText = transcript || messageText;

    let conversation = await prisma.conversation.findFirst({
      where: { storeId, channelType: 'FACEBOOK', externalUserId: senderPsid },
    });
    const isNewConversation = !conversation;
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { storeId, channelType: 'FACEBOOK', externalUserId: senderPsid, lastMessageAt: new Date() },
      });
    }

    // Backfill the customer's real name/avatar if we don't have both yet, or if the
    // stored avatar URL is old enough to have likely expired — covers brand-new
    // conversations, older ones created before this profile lookup existed, and
    // conversations whose Meta-issued avatar link has since gone stale.
    if (isProfileBackfillDue(conversation)) {
      const pageAccessToken = await getPageAccessTokenForStore(storeId);
      const profile = pageAccessToken ? await fetchMessengerProfile(pageAccessToken, senderPsid) : { name: null, profilePicUrl: null };
      const updateData: any = { avatarFetchedAt: new Date() };
      if (profile.name) updateData.customerName = profile.name;
      if (profile.profilePicUrl) updateData.avatarUrl = profile.profilePicUrl;
      conversation = await prisma.conversation.update({ where: { id: conversation.id }, data: updateData });
    }

    try {
      await prisma.message.create({
        data: { conversationId: conversation.id, sender: 'CUSTOMER', text: messageText, imageUrl, audioUrl, transcript, mediaType: audioUrl ? 'audio' : imageUrl ? 'image' : undefined, externalId: externalMessageId },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        // Lost a race with a concurrent redelivery of the same event — the other one wins.
        console.log('Duplicate Messenger webhook event (race), skipping');
        return;
      }
      throw err;
    }

    const greetedInstead = await sendOpeningGreetingIfNew(isNewConversation, conversation);
    if (!greetedInstead) {
      await generateAndStoreAgentReply(conversation, agentText, imageBuffer);
    }
  }

  async function handleIncomingWhatsAppMessage(phoneNumberId: string, senderWaId: string, messageText: string, externalMessageId: string, customerName?: string, imageMediaId?: string, audioMediaId?: string) {
    const alreadyProcessed = await prisma.message.findUnique({ where: { externalId: externalMessageId } });
    if (alreadyProcessed) {
      console.log('Duplicate WhatsApp webhook event, skipping');
      return;
    }

    const channel = await resolveConnectedChannelByExternalId('WHATSAPP', phoneNumberId);
    if (!channel) {
      console.error('Ignoring WhatsApp event for unconnected Phone Number ID');
      return;
    }
    const storeId = channel.storeId;
    let imageUrl: string | undefined;
    let imageBuffer: Buffer | undefined;
    let audioUrl: string | undefined;
    let audioBuffer: Buffer | undefined;
    if (imageMediaId) {
      const credentials = await getWhatsAppCredentialsForStore(storeId);
      if (credentials) {
        try {
          const mediaResponse = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(imageMediaId)}`, {
            headers: { Authorization: `Bearer ${credentials.accessToken}` },
          });
          if (mediaResponse.ok) {
            const media = await mediaResponse.json() as { url?: string };
            if (media.url) {
              imageUrl = media.url;
              imageBuffer = await downloadInboundImage(media.url, credentials.accessToken) || undefined;
            }
          }
        } catch {
          console.error('Failed to fetch WhatsApp image media');
        }
      }
    }
    if (audioMediaId) {
      const credentials = await getWhatsAppCredentialsForStore(storeId);
      if (credentials) {
        try {
          const mediaResponse = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(audioMediaId)}`, {
            headers: { Authorization: `Bearer ${credentials.accessToken}` },
          });
          if (mediaResponse.ok) {
            const media = await mediaResponse.json() as { url?: string };
            if (media.url) {
              audioUrl = media.url;
              audioBuffer = await downloadInboundAudio(media.url, credentials.accessToken) || undefined;
            }
          }
        } catch {
          console.error('Failed to fetch WhatsApp audio media');
        }
      }
    }
    const transcript = audioBuffer ? await transcribeVoiceMessage(audioBuffer) : null;
    const agentText = transcript || messageText;

    let conversation = await prisma.conversation.findFirst({
      where: { storeId, channelType: 'WHATSAPP', externalUserId: senderWaId },
    });
    const isNewConversation = !conversation;
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          storeId,
          channelType: 'WHATSAPP',
          externalUserId: senderWaId,
          customerName: customerName || `WhatsApp User (+${senderWaId})`,
          lastMessageAt: new Date(),
        },
      });
    } else if (customerName && conversation.customerName !== customerName) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { customerName },
      });
    }

    try {
      await prisma.message.create({
        data: { conversationId: conversation.id, sender: 'CUSTOMER', text: messageText, imageUrl, audioUrl, transcript, mediaType: audioUrl ? 'audio' : imageUrl ? 'image' : undefined, externalId: externalMessageId },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        console.log('Duplicate WhatsApp webhook event (race), skipping');
        return;
      }
      throw err;
    }

    const greetedInstead = await sendOpeningGreetingIfNew(isNewConversation, conversation);
    if (!greetedInstead) {
      await generateAndStoreAgentReply(conversation, agentText, imageBuffer);
    }
  }

  async function handleIncomingInstagramMessage(igAccountId: string, senderIgUserId: string, messageText: string, externalMessageId: string, imageUrl?: string, imageBuffer?: Buffer, audioUrl?: string, audioBuffer?: Buffer) {
    const alreadyProcessed = await prisma.message.findUnique({ where: { externalId: externalMessageId } });
    if (alreadyProcessed) {
      console.log('Duplicate Instagram webhook event, skipping');
      return;
    }

    const channel = await resolveConnectedChannelByExternalId('INSTAGRAM', igAccountId);
    if (!channel) {
      console.error('Ignoring Instagram event for unconnected Account ID');
      return;
    }
    const storeId = channel.storeId;
    if (imageUrl && !imageBuffer) {
      const igCreds = await getInstagramCredentialsForStore(storeId);
      imageBuffer = await downloadInboundImage(imageUrl, igCreds?.accessToken) || undefined;
    }
    if (audioUrl && !audioBuffer) {
      const igCreds = await getInstagramCredentialsForStore(storeId);
      audioBuffer = await downloadInboundAudio(audioUrl, igCreds?.accessToken) || undefined;
    }
    const transcript = audioBuffer ? await transcribeVoiceMessage(audioBuffer) : null;
    const agentText = transcript || messageText;

    let conversation = await prisma.conversation.findFirst({
      where: { storeId, channelType: 'INSTAGRAM', externalUserId: senderIgUserId },
    });
    const isNewConversation = !conversation;
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { storeId, channelType: 'INSTAGRAM', externalUserId: senderIgUserId, lastMessageAt: new Date() },
      });
    }

    if (isProfileBackfillDue(conversation)) {
      const igCreds = await getInstagramCredentialsForStore(storeId);
      const profile = igCreds ? await fetchInstagramProfile(igCreds.accessToken, senderIgUserId) : { name: null, profilePicUrl: null };
      const updateData: any = { avatarFetchedAt: new Date() };
      if (profile.name) updateData.customerName = `@${profile.name}`;
      if (profile.profilePicUrl) updateData.avatarUrl = profile.profilePicUrl;
      conversation = await prisma.conversation.update({ where: { id: conversation.id }, data: updateData });
    }

    try {
      await prisma.message.create({
        data: { conversationId: conversation.id, sender: 'CUSTOMER', text: messageText, imageUrl, audioUrl, transcript, mediaType: audioUrl ? 'audio' : imageUrl ? 'image' : undefined, externalId: externalMessageId },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        console.log('Duplicate Instagram webhook event (race), skipping');
        return;
      }
      throw err;
    }

    const greetedInstead = await sendOpeningGreetingIfNew(isNewConversation, conversation);
    if (!greetedInstead) {
      await generateAndStoreAgentReply(conversation, agentText, imageBuffer);
    }
  }

  // Meta webhook receiver — signature-verified before any payload is trusted
  router.post('/webhooks/meta', async (req: RequestWithRawBody, res) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const appSecret = process.env.META_APP_SECRET;

    if (!appSecret || !req.rawBody || !verifyMetaSignature(req.rawBody, signature, appSecret)) {
      return res.sendStatus(401);
    }

    // Acknowledge immediately — Meta expects a fast 200 and will retry on timeout.
    res.sendStatus(200);

    try {
      const body = req.body;

      if (body.object === 'page') {
        for (const entry of body.entry || []) {
          const pageId = entry.id;
          for (const event of entry.messaging || []) {
            const senderPsid = event.sender?.id;
            const messageText = event.message?.text;
            const messageId = event.message?.mid;
            const imageUrl = event.message?.attachments?.find((attachment: any) => attachment.type === 'image')?.payload?.url;
            const audioUrl = event.message?.attachments?.find((attachment: any) => attachment.type === 'audio')?.payload?.url;
            if (!senderPsid || (!messageText && !imageUrl && !audioUrl) || !messageId || event.message?.is_echo) continue;

            await handleIncomingMessengerMessage(pageId, senderPsid, messageText || (audioUrl ? 'Customer sent a voice message.' : 'Customer sent an image.'), messageId, imageUrl, undefined, audioUrl);
          }

          // Handle Facebook Post Comment webhooks (feed field)
          for (const change of entry.changes || []) {
            if (change.field === 'feed' && change.value) {
              const val = change.value;
              if (!isProduction) {
                console.log('[WEBHOOK] Received FB feed change event');
              }
              // Prefer Meta's stable comment_id. Do not fall back to post_id alone —
              // that would collide across comments on the same post and is not a
              // reliable per-event idempotency key.
              const commentId =
                typeof val.comment_id === 'string'
                  ? val.comment_id
                  : val.item === 'comment' && typeof val.id === 'string'
                    ? val.id
                    : null;
              const verb = val.verb || 'add';

              if (verb === 'add' && commentId) {
                const claimed = await claimWebhookEvent('meta', `facebook.comment.${commentId}`, 'facebook_comment');
                if (!claimed) {
                  console.log('Duplicate Facebook comment webhook event, skipping');
                  continue;
                }

                const messageText = val.message || '';
                const fromPsid = val.from?.id;
                const fromName = val.from?.name || 'Customer';

                if (messageText && (await isQuestionOrPriceInquiry(messageText))) {
                  if (!isProduction) {
                    console.log('[COMMENT BOT] Triggered for FB feed event');
                  }

                  const channel = await resolveConnectedChannelByExternalId('FACEBOOK', pageId);
                  if (channel) {
                    const pageAccessToken = await getPageAccessTokenForStore(channel.storeId);
                    if (pageAccessToken) {
                      // 1. Reply to comment in public comment section: "Check Inbox"
                      try {
                        await replyToFacebookComment(commentId, pageAccessToken, 'Check Inbox');
                      } catch (err: any) {
                        console.error('Failed to reply to Facebook comment');
                      }

                      // 2. Send private message in inbox: "Hello [customer_name] Please tell us about any inquiry you have"
                      const dmText = `Hello ${fromName} Please tell us about any inquiry you have`;
                      try {
                        if (fromPsid) {
                          await sendMessengerMessage(pageAccessToken, fromPsid, dmText);
                        } else {
                          await sendFacebookPrivateReply(commentId, pageAccessToken, dmText);
                        }
                      } catch (err: any) {
                        console.error('Failed to send Facebook inbox message for comment');
                      }
                    }
                  }
                } else if (!isProduction) {
                  console.log('[COMMENT BOT] Ignored FB feed event (not a question/price inquiry)');
                }
              }
            }
          }
        }
      } else if (body.object === 'instagram') {
        for (const entry of body.entry || []) {
          const igAccountId = entry.id;
          for (const event of entry.messaging || []) {
            const senderIgUserId = event.sender?.id;
            const messageText = event.message?.text;
            const messageId = event.message?.mid;
            const imageUrl = event.message?.attachments?.find((attachment: any) => attachment.type === 'image')?.payload?.url;
            const audioUrl = event.message?.attachments?.find((attachment: any) => attachment.type === 'audio')?.payload?.url;
            if (!senderIgUserId || (!messageText && !imageUrl && !audioUrl) || !messageId || event.message?.is_echo) continue;

            await handleIncomingInstagramMessage(igAccountId, senderIgUserId, messageText || (audioUrl ? 'Customer sent a voice message.' : 'Customer sent an image.'), messageId, imageUrl, undefined, audioUrl);
          }

          // Handle Instagram Post Comment webhooks (comments field)
          for (const change of entry.changes || []) {
            if (change.field === 'comments' && change.value) {
              const val = change.value;
              const commentId = typeof val.id === 'string' ? val.id : null;
              if (!commentId) continue;

              const claimed = await claimWebhookEvent('meta', `instagram.comment.${commentId}`, 'instagram_comment');
              if (!claimed) {
                console.log('Duplicate Instagram comment webhook event, skipping');
                continue;
              }

              const messageText = val.text || '';
              const fromUser = val.from || {};
              const senderIgUserId = fromUser.id;
              let customerName = fromUser.username || fromUser.name || 'Customer';

              if (messageText && (await isQuestionOrPriceInquiry(messageText))) {
                if (!isProduction) {
                  console.log('[COMMENT BOT] Triggered for IG comment');
                }

                const channel = await resolveConnectedChannelByExternalId('INSTAGRAM', igAccountId);
                if (channel) {
                  const igCreds = await getInstagramCredentialsForStore(channel.storeId);
                  if (igCreds) {
                    if (senderIgUserId && customerName === 'Customer') {
                      const fetchedProfile = await fetchInstagramProfile(igCreds.accessToken, senderIgUserId);
                      if (fetchedProfile.name) customerName = fetchedProfile.name;
                    }

                    // 1. Reply to comment in public comment section: "Check Inbox"
                    try {
                      await replyToInstagramComment(commentId, igCreds.accessToken, 'Check Inbox');
                    } catch (err: any) {
                      console.error('Failed to reply to IG comment');
                    }

                    // 2. Send private message in inbox: "Hello [customer_name] Please tell us about any inquiry you have"
                    const dmText = `Hello ${customerName} Please tell us about any inquiry you have`;
                    try {
                      if (senderIgUserId) {
                        await sendInstagramPrivateReply(igCreds.igAccountId, igCreds.accessToken, senderIgUserId, dmText);
                      }
                    } catch (err: any) {
                      console.error('Failed to send IG inbox message for comment');
                    }
                  }
                }
              }
            }
          }
        }
      } else if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field !== 'messages') continue;
            const value = change.value;
            const phoneNumberId = value?.metadata?.phone_number_id;
            const contacts = value?.contacts || [];
            const messages = value?.messages || [];

            for (const msg of messages) {
              if (msg.type !== 'text' && msg.type !== 'image' && msg.type !== 'audio') continue;
              const senderWaId = msg.from;
              const messageText = msg.type === 'text'
                ? msg.text?.body
                : msg.type === 'audio'
                  ? 'Customer sent a voice message.'
                  : msg.image?.caption || 'Customer sent an image.';
              const externalMessageId = msg.id;
              const contact = contacts.find((c: any) => c.wa_id === senderWaId);
              const customerName = contact?.profile?.name;

              if (phoneNumberId && senderWaId && messageText && externalMessageId) {
                await handleIncomingWhatsAppMessage(phoneNumberId, senderWaId, messageText, externalMessageId, customerName, msg.type === 'image' ? msg.image?.id : undefined, msg.type === 'audio' ? msg.audio?.id : undefined);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Meta webhook processing error:', err);
    }
  });

  return router;
}
