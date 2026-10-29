# Guide: WhatsApp Cloud API Manual Setup & Configuration

This file contains all the manual steps required to set up the **Meta WhatsApp Cloud API** integration for ShopMate AI. Follow these steps to obtain your credentials and connect your WhatsApp Business account.

---

## 🟢 Option 1: 1-Click Meta Login (Recommended for Merchants)

This is the recommended flow. No technical knowledge required.

1. Go to **Integrations Hub** in ShopMate AI Dashboard.
2. Click **"Connect"** on the WhatsApp Business card.
3. In the setup wizard, click **"Continue with Meta"**.
4. A Meta login dialog will open. Sign in with your Facebook account linked to your WhatsApp Business account.
5. Meta will ask you to:
   - Select your **WhatsApp Business Account (WABA)**
   - Select the **phone number** you want to use
6. Click **Allow** to grant ShopMate AI the necessary permissions.
7. You will be redirected back to ShopMate AI with your WhatsApp channel connected automatically.

> **Note:** If you manage multiple WhatsApp phone numbers, ShopMate AI will show you a number picker — just choose the correct one.

---

## 🔧 Option 2: Developer / Test Number Setup

Use this **only** if you are setting up a Meta Developer App test number (e.g., for development or CSE499 project demo).

### Step 1: Access Meta Developers Portal

1. Go to [Meta Developers Portal](https://developers.facebook.com/).
2. Log in with your Meta/Facebook account.
3. Click **My Apps** in the top right corner.

---

### Step 2: Create a Meta Developer App (if needed)

1. Click **Create App**.
2. Select **Business** as the app type.
3. Enter a name (e.g., `ShopMate AI Integration`) and click **Create App**.

---

### Step 3: Add the WhatsApp Product

1. In the App Dashboard, click **Add Product**.
2. Find **WhatsApp** and click **Set Up**.
3. Follow the onboarding flow to link a **WhatsApp Business Account (WABA)**.

---

### Step 4: Get Your Phone Number ID

1. In the left sidebar, go to **WhatsApp → API Setup**.
2. Under **From**, you will see a test phone number (e.g., `+1 555 019 2834`).
3. Copy the **Phone Number ID** shown below the number (it looks like `10528492049102`).

---

### Step 5: Get a Temporary Access Token

1. Still on the **API Setup** page, scroll down to find the **Temporary Access Token**.
2. Click **Generate** or copy the existing token (it starts with `EAAG...`).

> ⚠️ **Important:** Temporary tokens expire after 24 hours. For production, create a **System User** with a permanent token in the [Meta Business Manager](https://business.facebook.com/).

---

### Step 6: Configure the Webhook in Meta App

1. In the sidebar, go to **WhatsApp → Configuration**.
2. Under **Webhook**, click **Edit**.
3. Set the **Callback URL** to:
   ```
   https://your-shopmate-domain.com/webhooks/meta
   ```
4. Set the **Verify Token** to match the value of `META_VERIFY_TOKEN` in your `.env` file.
5. Click **Verify and Save**.
6. Under **Webhook Fields**, subscribe to `messages`.

---

### Step 7: Add a Test Recipient

> Meta requires you to add recipient phone numbers to an allowlist during development.

1. Still on **API Setup**, scroll to **To**.
2. Click **Manage phone number list** and add the phone number you want to test with.

---

### Step 8: Connect via ShopMate AI Dashboard

1. Go to **Integrations Hub** in ShopMate AI.
2. Click **Connect** on the WhatsApp Business card.
3. In the wizard, scroll past **"Continue with Meta"** and use the **Developer / Test Number Setup** section.
4. Paste in:
   - **Phone Number ID** (from Step 4)
   - **Temporary Access Token** (from Step 5)
5. Click **Connect via API Keys**.

---

## Environment Variables Required

Ensure your `.env` file contains:

```env
META_APP_SECRET=your_meta_app_secret
META_VERIFY_TOKEN=your_chosen_verify_token
FACEBOOK_APP_ID=your_meta_app_id
APP_URL=https://your-shopmate-domain.com
```

---

## Testing

Send a WhatsApp message from the registered test recipient number to your test business number. The message should appear in ShopMate AI's **Unified Inbox** within seconds.
