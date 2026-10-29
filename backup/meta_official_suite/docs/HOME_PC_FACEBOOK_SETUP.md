# Facebook Messenger: remove the hardcoded token, go all-in on real OAuth

Written on the other machine (`d:\CSE499_Demo`), for you to apply on your home PC — that's
the machine that actually runs `railway up`, and the only place the Ollama/Qwen backend
integration exists. **Do not deploy from any other machine** — that would overwrite your
home PC's build and silently delete the Ollama integration, since it isn't in this git repo.

## Why this change

Up to now, Messenger worked only because of a hardcoded fallback: if no merchant had
completed the real "Connect with Facebook" OAuth flow, the server quietly used the
`META_PAGE_ACCESS_TOKEN` env var (a manually pasted-in token) instead. That's the
"hardcoded solution" — it meant the self-serve OAuth flow was built but never actually
load-bearing; the manual token silently did all the work instead.

This change removes that fallback entirely. After this, Facebook Messenger **only** works
through the real flow: merchant clicks "Connect with Facebook" → logs into Facebook → picks
a Page → grants permissions → done. No env var can substitute for that anymore.

**Consequence: Messenger goes dark until you complete the OAuth connect for real.**
There is currently a live Page ("ShopMate Test") receiving real customer messages purely
via the hardcoded token. The instant this change deploys, those messages stop getting AI
replies until someone completes the OAuth connect flow on the live site.

## What changed (in `server.ts`)

Two functions, both in the webhook/messaging code path:

### 1. `getPageAccessTokenForStore` — no more env var fallback

```diff
-  // Prefers the per-store token from a real self-serve OAuth connection; falls back to
-  // the single global env-var token used by the manual-token connection path.
+  // Only the real self-serve OAuth connection's per-store token is used — there is no
+  // manual/env-var fallback, so a store with no completed Facebook connection simply
+  // can't send or fetch anything via Messenger.
   async function getPageAccessTokenForStore(storeId: string): Promise<string | null> {
     const channel = await prisma.channel.findUnique({ where: { storeId_type: { storeId, type: 'FACEBOOK' } } });
     if (channel?.connected && channel.credentials) {
       try {
         const { token } = channel.credentials as { token: string };
         return decryptSecret(token);
       } catch (err) {
         console.error('Failed to decrypt stored Facebook token:', err);
       }
     }
-    return process.env.META_PAGE_ACCESS_TOKEN || null;
+    return null;
   }
```

### 2. `handleIncomingMessengerMessage` — no more "guess the store" fallback

Previously, if an incoming Page ID didn't match a stored `Channel` row, the code guessed by
attaching the message to whichever store was created first in the entire database. That
guess only existed to make the hardcoded manual-token Page "just work" without ever going
through OAuth. Now that there's no manual token, that guess makes no sense — a message from
a Page nobody has connected is simply dropped (logged, not processed):

```diff
     // A real self-serve OAuth connection always has a Channel row keyed by this exact
-    // Page ID already (see finalizeFacebookConnection), so this lookup routes the event
-    // to the right store automatically. The fallback below only fires for a Page that's
-    // never been connected through either flow — e.g. the older manual-token setup.
-    let channel = await prisma.channel.findFirst({ where: { type: 'FACEBOOK', externalId: pageId } });
-    let storeId: string;
-    if (channel) {
-      storeId = channel.storeId;
-    } else {
-      const store = await prisma.store.findFirst({ orderBy: { createdAt: 'asc' } });
-      if (!store) {
-        console.error('No store found to attach the Facebook channel to');
-        return;
-      }
-      storeId = store.id;
-      await prisma.channel.upsert({
-        where: { storeId_type: { storeId, type: 'FACEBOOK' } },
-        update: { connected: true, externalId: pageId },
-        create: { storeId, type: 'FACEBOOK', connected: true, externalId: pageId },
-      });
+    // Page ID (see finalizeFacebookConnection). There is no fallback: a Page that hasn't
+    // been connected through that flow has no known store to attach the message to, so
+    // it's dropped rather than guessed at.
+    const channel = await prisma.channel.findFirst({ where: { type: 'FACEBOOK', connected: true, externalId: pageId } });
+    if (!channel) {
+      console.error('Ignoring Messenger event for unconnected Page:', pageId);
+      return;
     }
+    const storeId = channel.storeId;
```

Nothing else changed. `server/meta.ts` (the actual OAuth code — login URL, code exchange,
Page listing, webhook auto-subscribe) was already complete and already requests the right
permissions: `pages_messaging`, `pages_show_list`, `pages_manage_metadata`,
`pages_read_engagement`. That part didn't need touching.

## How to apply this on your home PC

Your home PC's copy of this repo has extra local code (the Ollama integration) that isn't
tracked in git here, so don't blindly overwrite files. Instead, open `server.ts` on your
home PC and make the same two edits shown above by hand (search for
`getPageAccessTokenForStore` and `handleIncomingMessengerMessage`) — they're small,
self-contained, and shouldn't conflict with anything Ollama-related since that's a
completely separate code path (the AI reply generation, not the Messenger plumbing).

If you'd rather sync via git: these edits haven't been committed/pushed from the other
machine yet (by design — commits only happen when explicitly asked). Say the word if you
want them pushed so you can `git pull` instead of hand-editing.

## After deploying: how to actually connect Facebook for real

1. Deploy from your home PC as usual (`railway up`), so the Ollama integration comes along
   with these edits.
2. Log into the deployed app as the merchant.
3. Go to **Integrations** → the Facebook card should say **"Connect"** (it currently shows
   disconnected in the database).
4. Click it. This redirects to a real Facebook OAuth consent screen.
5. Log in with the Facebook account that manages the "ShopMate Test" Page (or whichever
   Page you want connected) and approve the requested permissions.
6. If that account manages more than one Page, you'll get a picker — choose the right one.
7. You're redirected back with the Facebook card now showing **"Connected"** and the real
   Page name. Behind the scenes this stored an encrypted Page token and auto-subscribed the
   webhook (`subscribed_fields: ["messages"]`) via the Graph API — no manual webhook setup
   needed in Meta's dashboard.
8. Send a test message to the Page **from a Meta app tester account** — the app is still in
   dev mode (no App Review done), so only testers can message it. Confirm the message
   appears in the Inbox and gets a real AI reply.

## Optional cleanup, once step 8 above works

`META_PAGE_ACCESS_TOKEN` and `META_PAGE_ID` are no longer read by any code — you can remove
them from Railway's variables (`railway variables` to check, then unset via the dashboard or
CLI) whenever you're comfortable that OAuth is the only path in use. Not urgent, just dead
weight. Do **not** remove `META_APP_SECRET` or `META_VERIFY_TOKEN` — those are still required
for webhook signature verification and the verification handshake regardless of which flow
issued the token.
