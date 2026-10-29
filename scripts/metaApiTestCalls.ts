// Fires one safe Graph API call per permission so Meta's "required API test calls"
// check has traffic for every submitted permission. Read calls are used wherever
// possible; write endpoints are only probed with intentionally invalid IDs so the
// request registers in Meta's telemetry without publishing real content.
import 'dotenv/config';
import { prisma } from '../server/db';
import { decryptSecret } from '../server/crypto';

const V = 'v21.0';
const BASE = `https://graph.facebook.com/${V}`;

async function call(label: string, url: string, init?: RequestInit) {
  try {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    const err = (body as any)?.error;
    console.log(`${res.ok ? 'OK ' : 'ERR'} ${res.status} ${label}${err ? ` :: ${err.code ?? ''} ${String(err.message || '').slice(0, 120)}` : ''}`);
    return { ok: res.ok, body };
  } catch (e: any) {
    console.log(`FAIL ${label} :: ${e?.message}`);
    return { ok: false, body: null };
  }
}

async function main() {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const appToken = appId && appSecret ? `${appId}|${appSecret}` : null;

  const channels = await prisma.channel.findMany({
    where: { connected: true, type: { in: ['FACEBOOK', 'INSTAGRAM', 'WHATSAPP'] } },
  });
  console.log(`connected channels: ${channels.map(c => c.type).join(', ') || 'none'}`);

  // Collect every candidate token per type, then keep the first valid one.
  const pick = async (type: string) => {
    for (const c of channels.filter(c => c.type === type)) {
      const cred = c.credentials as any;
      if (!cred?.token) continue;
      try {
        const token = decryptSecret(cred.token);
        const r = await fetch(`${BASE}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken!)}`);
        const d = (await r.json())?.data;
        console.log(`     ${type} store=${c.storeId.slice(0, 10)} valid=${d?.is_valid} scopes=${(d?.scopes || []).join(',')}`);
        if (d?.is_valid) return { token, externalId: c.externalId, storeId: c.storeId };
      } catch { /* malformed creds, skip */ }
    }
    return null;
  };

  if (!appToken) { console.log('FACEBOOK_APP_ID/META_APP_SECRET missing'); return; }

  const fb = await pick('FACEBOOK');
  const ig = await pick('INSTAGRAM');
  const wa = await pick('WHATSAPP');

  const fbToken = fb?.token || null;
  const igToken = ig?.token || null;
  const waCreds = wa ? (channels.find(c => c.type === 'WHATSAPP' && c.storeId === wa.storeId)?.credentials as any) : null;
  const waToken = wa?.token || null;
  const waPhoneId = waCreds?.phoneNumberId || null;
  const pageId = fb?.externalId || process.env.META_PAGE_ID;
  const igId = ig?.externalId;

  // --- Facebook Page calls ---
  if (fbToken && pageId) {
    await call('pages_show_list-ish: GET /{page}', `${BASE}/${pageId}?fields=name&access_token=${fbToken}`);
    await call('pages_manage_metadata: GET /{page}/subscribed_apps', `${BASE}/${pageId}/subscribed_apps?access_token=${fbToken}`);
    await call('pages_messaging: GET /{page}/conversations', `${BASE}/${pageId}/conversations?limit=1&access_token=${fbToken}`);
    const feed = await call('pages_read_engagement: GET /{page}/feed', `${BASE}/${pageId}/feed?limit=1&access_token=${fbToken}`);
    const postId = (feed.body as any)?.data?.[0]?.id;
    if (postId) {
      const comments = await call('pages_read_user_content: GET /{post}/comments', `${BASE}/${postId}/comments?limit=1&access_token=${fbToken}`);
      const commentId = (comments.body as any)?.data?.[0]?.id;
      if (commentId) {
        await call('pages_read_user_content: GET /{comment}', `${BASE}/${commentId}?fields=message,from&access_token=${fbToken}`);
      }
    }
    // Probe the write endpoint with an invalid comment id so the call registers
    // without publishing anything (expected 400-series error is fine).
    await call('pages_manage_engagement: POST /{comment}/comments (probe)', `${BASE}/${pageId}_0/comments?access_token=${fbToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test' }),
    });
  }

  // --- Instagram calls ---
  if (igToken && igId) {
    await call('instagram_basic: GET /{ig-user}', `${BASE}/${igId}?fields=username,name&access_token=${igToken}`);
    const media = await call('instagram_manage_comments: GET /{ig-user}/media', `${BASE}/${igId}/media?limit=1&access_token=${igToken}`);
    const mediaId = (media.body as any)?.data?.[0]?.id;
    if (mediaId) {
      await call('instagram_manage_comments: GET /{media}/comments', `${BASE}/${mediaId}/comments?limit=1&access_token=${igToken}`);
      // invalid comment id -> registers write-endpoint call without publishing
      await call('instagram_manage_comments: POST /{comment}/replies (probe)', `${BASE}/${mediaId}_0/replies`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${igToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test' }),
      });
    }
    await call('instagram_manage_messages: GET /{ig-user}/conversations', `${BASE}/${igId}/conversations?limit=1&access_token=${igToken}`);
  }

  // --- WhatsApp calls ---
  if (waToken && waPhoneId) {
    await call('whatsapp_business_management: GET /{phone-number-id}', `${BASE}/${waPhoneId}?fields=display_phone_number,verified_name,code_verification_status`, {
      headers: { Authorization: `Bearer ${waToken}` },
    });
    await call('whatsapp_business_management: GET /{phone-number-id}/whatsapp_business_profile', `${BASE}/${waPhoneId}/whatsapp_business_profile?fields=about,websites`, {
      headers: { Authorization: `Bearer ${waToken}` },
    });
    // invalid recipient -> registers /messages endpoint call, delivers to nobody
    await call('whatsapp_business_messaging: POST /{phone-number-id}/messages (probe)', `${BASE}/${waPhoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: '0', type: 'text', text: { body: 'test' } }),
    });
  }

  // --- business_management ---
  if (fbToken) {
    await call('business_management: GET /me/businesses', `${BASE}/me/businesses?access_token=${fbToken}`);
  }
  if (waToken) {
    await call('business_management: GET /me/businesses (wa token)', `${BASE}/me/businesses`, {
      headers: { Authorization: `Bearer ${waToken}` },
    });
    if (waPhoneId) {
      await call('whatsapp_business_accounts lookup', `${BASE}/me/whatsapp_business_accounts?fields=id,name`, {
        headers: { Authorization: `Bearer ${waToken}` },
      });
    }
  }

  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
