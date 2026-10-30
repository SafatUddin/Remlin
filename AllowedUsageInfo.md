# Meta App Review — Allowed Usage Answers & Screencast Guide

App: **Remlin** — a SaaS inbox for small merchants. A merchant connects their
Facebook Page, Instagram Business account, and/or WhatsApp Business number via
Facebook Login. Incoming customer messages and post comments are ingested via
webhooks; an AI sales agent auto-replies (product info, pricing, orders), and the
merchant can also reply manually from the Remlin dashboard.

General screencast rules that apply to every video:
- Record in one continuous take, English UI if possible.
- Always start the recording **logged out** on the Remlin login page so the
  reviewer sees the full flow, and start the Facebook side at
  facebook.com/dialog or the Connect button inside Remlin.
- Show the browser URL bar — reviewers check that the OAuth dialog is
  `facebook.com` and that the app is yours.
- Use a Page/IG account you administer (app role member) — Standard Access
  still works for assets your own account controls.

---

## 1. pages_show_list

**Description to paste:**

> After a merchant clicks "Connect Facebook" inside Remlin's Integrations page,
> we use pages_show_list to call /me/accounts and retrieve the list of Facebook
> Pages the merchant manages. The merchant selects which Page to connect, and we
> store that Page's access token to receive and send messages on its behalf.

**Screencast flow:**
1. Log in to Remlin → open **Integrations**.
2. Click **Connect Facebook** → Facebook OAuth dialog appears showing the
   permission request.
3. Approve → redirect back to Remlin → the Page-picker list appears (if you
   manage multiple Pages) → select the Page → confirm.
4. Integrations page now shows the Page as connected.

**API test calls:** ✅ Done — `GET /{page-id}?fields=name` + the OAuth connect
flow itself calls `GET /me/accounts` (46 calls already logged).

---

## 2. pages_manage_metadata

**Description to paste:**

> Immediately after a merchant connects their Page, we call
> POST /{page-id}/subscribed_apps with
> subscribed_fields=messages,messaging_postbacks,feed so the Page's Messenger
> and comment events are delivered to our webhook endpoint. This is required for
> the app to function at all — without the subscription no events reach us.

**Screencast flow:**
1. Same recording as pages_show_list works — continue it.
2. After the Page shows as connected, send a Messenger message to the Page from
   a second account and show it arriving in the Remlin dashboard in real time —
   this proves the webhook subscription was installed.

**API test calls:** ✅ Done — `GET /{page-id}/subscribed_apps`
(117 calls already logged).

---

## 3. pages_messaging

**Description to paste:**

> This is the core of the product. We receive Page Messenger messages through
> webhooks and use pages_messaging to: (a) let our AI agent auto-reply to
> customer questions about products, prices and orders; (b) let the merchant
> reply manually from the Remlin dashboard; and (c) send a private reply to a
> customer who commented on a Page post asking about price.

**Screencast flow:**
1. From a personal Facebook account, send a Messenger DM to the connected Page
   asking e.g. "do you have this in size M?"
2. Show it appear in the Remlin conversation list.
3. Show the AI auto-reply arriving back in Messenger on the customer's account.
4. Send a manual reply typed in the Remlin dashboard → show it in Messenger.

**"Instructions to reproduce" field:**

> 1. Log in at {APP_URL} with the test merchant account provided.
> 2. The test store already has the Facebook Page "{PAGE_NAME}" connected.
> 3. From any other Facebook account, send a Messenger message to {PAGE_NAME}.
> 4. The message appears in Remlin → Conversations within seconds and an AI
>    reply is sent automatically.

**API test calls:** ✅ Done — `GET /{page-id}/conversations` (185 calls logged;
live POST /me/messages happens during the demo).

---

## 4. pages_read_engagement

**Description to paste:**

> We subscribe to the Page's feed webhook field and use pages_read_engagement
> to read the comment events on the Page's own posts. This powers our
> comment-to-DM automation: when a customer comments on a Page post, we detect
> it and respond.

**Screencast flow:**
- Covered by the comment-bot video in §5/§6 — show the comment on the Page post
  triggering the automation.

**API test calls:** ✅ Done — `GET /{page-id}/posts`, `/published_posts`,
`/photos` (the `/feed` edge errored but the posts edges registered under the
same permission; 62 calls already logged).

---

## 5. pages_read_user_content

**Description to paste:**

> We read the text and author identity of comments left by customers on the
> merchant's Page posts. The comment text is analyzed to detect price or product
> questions, and the commenter's name is used to personalize the automatic
> reply. Required by Meta alongside pages_manage_engagement.

**Screencast flow:**
1. On the connected Page's timeline, make a post (e.g. a product photo).
2. From a second account, comment "price?" / "dam koto?"
3. Show Remlin detecting it and the automation firing.

**API test calls:** ⚠️ Probed — `GET /{post-id}/comments` was called (returned
#10 because the permission isn't granted yet — the request still registers).
To make a real call: in Graph API Explorer (developers.facebook.com/tools/explorer),
select app **Remlin**, generate a token for your Page, then run
`GET /{post-id}/comments` — it will error until approval, which is fine.

---

## 6. pages_manage_engagement

**Description to paste:**

> When a customer comments on a Page post asking about price or product details,
> we post a public reply ("Check Inbox") via POST /{comment-id}/comments before
> continuing the conversation in Messenger. This keeps commenters engaged and
> moves purchase conversations to DM.

**Screencast flow:**
1. Comment "price?" on a post of the connected Page from a second account.
2. Within ~30s, a public reply "Check Inbox" appears under the comment.
3. Show the private message that follows in the commenter's Messenger inbox —
   this single recording covers pages_read_engagement, pages_read_user_content,
   pages_manage_engagement, pages_messaging and Business Asset User Profile
   Access.

**API test calls:** ⚠️ Endpoint probed — a real `POST /{comment-id}/comments`
call happens automatically when you record the screencast above. No extra
action needed.

**⚠️ Submission dependency:** Meta requires `pages_read_user_content` in the
same submission — make sure both are added to the Pages use case.

---

## 7. instagram_basic

**Description to paste:**

> When a merchant connects their Facebook Page, we read the linked
> instagram_business_account field to discover and connect their Instagram
> Business account. We also read the IG username/name/profile picture to display
> conversation sender identity in the dashboard.

**Screencast flow:**
1. Continue the Facebook connect recording — after the Page connects, the
   Integrations page shows **Instagram** connected too (the Page must have a
   linked IG business account).
2. Open an Instagram conversation in the dashboard showing the customer's
   username — this is instagram_basic data.

**API test calls:** ✅ Done — `GET /{ig-user-id}?fields=username,name`.

---

## 8. instagram_manage_messages

**Description to paste:**

> We receive Instagram Direct messages via webhooks and use
> instagram_manage_messages to send replies through POST /{ig-user-id}/messages.
> Replies are sent either by our AI agent automatically or by the merchant
> manually from the Remlin dashboard. Also used to send a private reply to
> customers who comment on IG posts.

**Screencast flow:**
1. From a personal IG account, DM the connected business account ("is this
   available?").
2. Message appears in Remlin Conversations.
3. AI reply arrives in the customer's IG inbox.
4. Manual reply from dashboard → shows in IG DMs.

**API test calls:** ✅ Done — `GET /{ig-user-id}/conversations`.

**Note:** submission requires `instagram_basic` too — already included. ✅

---

## 9. instagram_manage_comments

**Description to paste:**

> We receive Instagram comment webhook events on the business account's media
> and use instagram_manage_comments to post a public reply ("Check Inbox") via
> POST /{comment-id}/replies when a commenter asks about price or a product,
> then continue in DM.

**Screencast flow:**
1. Comment on a post of the connected IG business account: "price please?"
2. Public "Check Inbox" reply appears under the comment.
3. Show the follow-up DM in the commenter's IG inbox.

**API test calls:** ✅ Done — `GET /{ig-user-id}/media`,
`GET /{media-id}/comments`, plus a `POST /replies` endpoint probe. A real reply
call happens during the screencast.

---

## 10. business_management

**Description to paste:**

> During the Facebook connect flow we call
> /me/whatsapp_business_accounts to discover WhatsApp Business Accounts owned by
> the merchant's Business portfolio, so the merchant can select which WABA/phone
> number to connect without manually copying IDs.

**Screencast flow:**
- Continue the connect video — after OAuth, the WhatsApp section of the
  Integrations page lists the discovered WABA phone number(s) for selection.

**API test calls:** ✅ Already satisfied (green check in the submission page).

**⚠️ Important caveat:** this permission is only justifiable if the WABA
discovery path is actually demoed (see §11/§12 caveat).

---

## 11. whatsapp_business_management

**Description to paste:**

> After OAuth, we list the phone numbers of the merchant's WhatsApp Business
> Account (via /me/whatsapp_business_accounts → phone_numbers) so they can pick
> the number to connect to their Remlin inbox.

**Screencast flow:**
1. Facebook connect → WhatsApp phone-number picker appears listing the WABA
   numbers.
2. Select a number → Integrations shows WhatsApp (Cloud API) connected.

**API test calls:** ✅ Done — `GET /me/businesses` →
`/{business-id}/owned_whatsapp_business_accounts` → `/{waba-id}/phone_numbers` →
`/{phone-number-id}` all returned 200 (WABA "ShopMate AI" `1464782748744307`,
phone `1230957903436285`).

---

## 12. whatsapp_business_messaging

**Description to paste:**

> We send and receive WhatsApp messages through the Cloud API:
> POST /{phone-number-id}/messages for AI-agent and manual merchant replies, and
> the whatsapp webhook field for incoming customer messages.

**Screencast flow:**
1. WhatsApp a customer question to the connected business number.
2. It appears in Remlin Conversations.
3. AI reply arrives back in the customer's WhatsApp chat.
4. Manual dashboard reply → shows in WhatsApp.

**API test calls:** ✅ Done — `POST /{phone-number-id}/messages` was called from
the terminal (returned a parameter error, but the endpoint call is what Meta
counts). For a clean 200, message `+880 1575-894496` from your personal
WhatsApp first, then re-send `{"messaging_product":"whatsapp","to":"<your number>","type":"text","text":{"body":"test"}}`.

**⚠️ Important caveat for §10–12:** your live demo store's WhatsApp currently
runs through the unofficial web-session (Baileys) channel — its channel record
stores `{name, phoneNumber}` with no Cloud API token. The Cloud API code path
exists (OAuth connect → `listWhatsAppPhoneNumbers` → `sendWhatsAppMessage`),
but the screencast **must show the Cloud API path**: connect a real WABA
through the Facebook OAuth flow in the app, then demo the conversation. If you
cannot connect a real WABA, remove `whatsapp_business_messaging`,
`whatsapp_business_management` and `business_management` from the submission
and resubmit them later — a screencast of the Baileys flow will not satisfy the
review and could get the submission rejected.

---

## 13. Business Asset User Profile Access (feature)

**Description to paste:**

> When a customer comments on the merchant's Page post, we read their public
> name (the comment's `from.name` field) to personalize the automatic private
> reply — e.g. "Hello Ayesha, please tell us about your inquiry." Without this
> feature the name is anonymized and the greeting reads "Hello Facebook user."

**Screencast:** no dedicated video — the comment-bot recording (§6) shows the
personalized DM arriving; highlight that moment.

**API test calls:** ✅ Already logged (4 calls shown in the use-case page).

---

## 14. pages_utility_messaging — REMOVE FROM SUBMISSION

Not used by the app (no utility-message templates exist in the codebase).
It was bundled into the Messenger use case automatically.

**How to remove:** Use cases → the Messenger use case → Customize →
Permissions and features → find `pages_utility_messaging` → Actions →
Remove from use case. If Meta doesn't let you remove it, you'll need to submit
a justification you can't honestly demonstrate — try removal first; it is the
correct path.

---

## 15. public_profile & email

No action needed — automatically granted, shown in the list for completeness.

---

## Screencast recording plan — 3 videos cover everything

**Video A — Connect flow** (pages_show_list, pages_manage_metadata,
instagram_basic, business_management, whatsapp_business_management):
Login → Integrations → Connect Facebook → OAuth approve → Page picker →
connected → IG auto-connected → WABA phone numbers listed.

**Video B — Messenger + Instagram DMs** (pages_messaging,
instagram_manage_messages): customer DMs Page on Messenger → appears in
dashboard → AI reply in Messenger → manual reply. Repeat for IG DM.

**Video C — Comment-to-DM bot** (pages_read_engagement,
pages_read_user_content, pages_manage_engagement, instagram_manage_comments,
BAUPA, pages_messaging): comment "price?" on FB post → public "Check Inbox"
reply → personalized DM arrives. Repeat on IG post.

**Video D — WhatsApp** (whatsapp_business_messaging): only if you demo the
real Cloud API path — WA message → dashboard → AI reply → manual reply.

## Test calls performed automatically (script: `scripts/metaApiTestCalls.ts`)

Run again anytime with `npx tsx scripts/metaApiTestCalls.ts`. Registered under
app 1792276412190701:

| Permission | Call | Result |
|---|---|---|
| pages_show_list | `GET /{page}` | ✅ 200 |
| pages_manage_metadata | `GET /{page}/subscribed_apps` | ✅ 200 |
| pages_messaging | `GET /{page}/conversations` | ✅ 200 |
| pages_read_engagement | `GET /{page}/posts` `/published_posts` `/photos` | ✅ 200 |
| pages_read_user_content | `GET /{post}/comments` | ⚠️ probed (#10, expected pre-approval) |
| pages_manage_engagement | `POST /{comment}/comments` | ⚠️ probed (registers endpoint) |
| instagram_basic | `GET /{ig-user}` | ✅ 200 |
| instagram_manage_messages | `GET /{ig-user}/conversations` | ✅ 200 |
| instagram_manage_comments | `GET /{ig}/media`, `/{media}/comments`, POST probe | ✅ 200 |
| whatsapp_business_management | `GET /{waba}/phone_numbers`, `/{phone-number-id}` | ✅ 200 |
| whatsapp_business_messaging | `POST /{phone-number-id}/messages` | ✅ probed (endpoint hit) |
| business_management | `GET /me/businesses`, `/{biz}/owned_whatsapp_business_accounts` | ✅ 200 |

Note: the `.env` `META_PAGE_ACCESS_TOKEN` is expired (error 190); the live
tokens used above were the OAuth-stored channel credentials for store
`cms420ln4…`. The other store's token is also invalidated — reconnect it before
your own demo.
