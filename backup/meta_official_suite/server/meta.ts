import crypto from 'crypto';

export function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);

  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export async function sendMessengerMessage(pageAccessToken: string, recipientPsid: string, text: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientPsid },
      message: { text },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Messenger send failed: ${res.status} ${body}`);
  }
}

export async function sendMessengerImage(pageAccessToken: string, recipientPsid: string, imageUrl: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientPsid },
      message: { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Messenger image send failed: ${res.status} ${body}`);
  }
}

export async function sendWhatsAppMessage(phoneNumberId: string, accessToken: string, recipientWaId: string, text: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientWaId,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp send failed: ${res.status} ${body}`);
  }
}

export async function sendWhatsAppImage(phoneNumberId: string, accessToken: string, recipientWaId: string, imageUrl: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientWaId,
      type: 'image',
      image: { link: imageUrl },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp image send failed: ${res.status} ${body}`);
  }
}

export interface MetaProfile {
  name: string | null;
  profilePicUrl: string | null;
}

export async function fetchMessengerProfile(pageAccessToken: string, psid: string): Promise<MetaProfile> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${psid}?fields=first_name,last_name,profile_pic&access_token=${encodeURIComponent(pageAccessToken)}`
    );
    if (!res.ok) return { name: null, profilePicUrl: null };
    const data = await res.json();
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
    return { name: name || null, profilePicUrl: data.profile_pic || null };
  } catch (err) {
    console.error('Failed to fetch Messenger profile:', err);
    return { name: null, profilePicUrl: null };
  }
}

export async function sendInstagramMessage(igAccountId: string, accessToken: string, recipientIgUserId: string, text: string): Promise<void> {
  // Try sending via IG account endpoint first
  let res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(igAccountId)}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: recipientIgUserId },
      message: { text },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // If Meta returns capability error (#3), fallback to /me/messages (supported by Page Access Tokens for connected IG accounts)
    if (body.includes('"code":3') || body.includes('capability')) {
      console.log('IG endpoint returned Code 3 capability error, trying /me/messages fallback...');
      const fallbackRes = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientIgUserId },
          message: { text },
        }),
      });
      if (fallbackRes.ok) return;
      const fallbackBody = await fallbackRes.text();
      throw new Error(`Instagram send failed (fallback): ${fallbackRes.status} ${fallbackBody}`);
    }
    throw new Error(`Instagram send failed: ${res.status} ${body}`);
  }
}

export async function sendInstagramImage(igAccountId: string, accessToken: string, recipientIgUserId: string, imageUrl: string): Promise<void> {
  let res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(igAccountId)}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: recipientIgUserId },
      message: { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (body.includes('"code":3') || body.includes('capability')) {
      const fallbackRes = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientIgUserId },
          message: { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } },
        }),
      });
      if (fallbackRes.ok) return;
      const fallbackBody = await fallbackRes.text();
      throw new Error(`Instagram image send failed (fallback): ${fallbackRes.status} ${fallbackBody}`);
    }
    throw new Error(`Instagram image send failed: ${res.status} ${body}`);
  }
}

export async function fetchInstagramProfile(accessToken: string, igUserId: string): Promise<MetaProfile> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}?fields=name,username,profile_pic&access_token=${encodeURIComponent(accessToken)}`
    );
    if (!res.ok) return { name: null, profilePicUrl: null };
    const data = await res.json();
    return { name: data.username || data.name || null, profilePicUrl: data.profile_pic || null };
  } catch (err) {
    console.error('Failed to fetch Instagram profile:', err);
    return { name: null, profilePicUrl: null };
  }
}

const FACEBOOK_OAUTH_SCOPES = [
  'pages_messaging',
  'pages_show_list',
  'pages_manage_metadata',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_manage_messages',
  'business_management',
  'whatsapp_business_messaging',
  'whatsapp_business_management',
];

export function getFacebookOAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID || '',
    redirect_uri: redirectUri,
    state,
    scope: FACEBOOK_OAUTH_SCOPES.join(','),
    response_type: 'code',
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForUserToken(code: string, redirectUri: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID || '',
    client_secret: process.env.META_APP_SECRET || '',
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Facebook code exchange failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.access_token;
}

export interface ManagedPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

export async function listManagedPages(userAccessToken: string): Promise<ManagedPage[]> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(userAccessToken)}`
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to list managed Pages: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.data || [];
}

export interface WhatsAppPhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name?: string;
}

export async function listWhatsAppPhoneNumbers(userAccessToken: string): Promise<{ wabaId: string; wabaName: string; phoneNumbers: WhatsAppPhoneNumber[] }[]> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me/whatsapp_business_accounts?fields=id,name,phone_numbers{id,display_phone_number,verified_name}&access_token=${encodeURIComponent(userAccessToken)}`
    );
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return (data.data || []).map((acc: any) => ({
      wabaId: acc.id,
      wabaName: acc.name || 'WhatsApp Business Account',
      phoneNumbers: acc.phone_numbers?.data || [],
    }));
  } catch (err) {
    console.error('Failed to list WhatsApp accounts:', err);
    return [];
  }
}

export async function replyToFacebookComment(commentId: string, pageAccessToken: string, text: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(commentId)}/comments?access_token=${encodeURIComponent(pageAccessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Facebook comment reply failed: ${res.status} ${body}`);
  }
}

export async function sendFacebookPrivateReply(commentId: string, pageAccessToken: string, text: string): Promise<void> {
  // First try Meta's official Private Reply endpoint for Page post comments
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text },
    }),
  });

  if (!res.ok) {
    console.warn(`Facebook private reply by comment_id failed (${res.status}), trying direct message fallback...`);
  }
}

export async function replyToInstagramComment(commentId: string, accessToken: string, text: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(commentId)}/replies`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Instagram comment reply failed: ${res.status} ${body}`);
  }
}

export async function sendInstagramPrivateReply(igAccountId: string, accessToken: string, recipientIgUserId: string, text: string): Promise<void> {
  // IG Private Reply using igAccountId endpoint or fallback
  await sendInstagramMessage(igAccountId, accessToken, recipientIgUserId, text);
}

export async function subscribePageWebhook(pageId: string, pageAccessToken: string): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,feed&access_token=${encodeURIComponent(pageAccessToken)}`,
    { method: 'POST' }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to subscribe Page webhook: ${res.status} ${body}`);
  }
}

