# Remlin

An AI sales agent for merchants — connects to Messenger, Instagram, WhatsApp, and a
website chat widget, answers customers using a real product catalog, and manages
carts and orders end to end. Built as a CSE499 capstone project.

## Live Site

The deployed app is live on Railway: [remlin.up.railway.app](https://remlin.up.railway.app)

Demo login: `merchant@shopmate.ai` / `password1234`

## Tech Stack

- **Frontend:** React + TypeScript, Vite, Tailwind CSS
- **Backend:** Node.js + Express, TypeScript
- **Database:** PostgreSQL (Supabase) via Prisma ORM
- **AI:** Google Gemini
- **Hosting:** Railway

## What It Does

A merchant signs up, connects one or more sales channels (Facebook Messenger,
Instagram, WhatsApp, or a chat widget embedded on their own website), uploads a
product catalog, and configures an AI persona (tone, style, custom instructions,
opening greeting). From then on, every customer message on any connected channel is
answered by Gemini using that store's real catalog and persona — the same reply
engine handles all four channels identically, with only the final "send it out"
step differing per channel. The AI can build a cart, extract a shipping address, and
either hand a draft to the merchant for approval or auto-finalize a real order,
depending on the store's Copilot settings.

## Architecture

```mermaid
flowchart TB
    subgraph Client["Customer-facing"]
        FB[Facebook Messenger]
        IG[Instagram]
        WA[WhatsApp]
        WD["Website Widget<br/>(any merchant's own site)"]
    end

    subgraph App["Remlin (Express + React, on Railway)"]
        direction TB
        WH["Webhook routes<br/>server/routes/webhooks.ts"]
        WDR["Widget routes<br/>server/routes/widget.ts"]
        ENGINE["Conversation Engine<br/>server/conversationEngine.ts<br/><i>shared AI reply logic for every channel</i>"]
        API["Merchant API routes<br/>auth · products · persona ·<br/>orders · analytics · channels"]
        SPA["React SPA<br/>Inbox · Catalog · Persona ·<br/>Orders · Analytics · Integrations"]
    end

    subgraph Data["Data & AI"]
        DB[(PostgreSQL<br/>via Prisma)]
        GEMINI["Google Gemini"]
    end

    subgraph Merchant["Merchant-facing"]
        DASH["Merchant's browser"]
    end

    FB --> WH
    IG --> WH
    WA --> WH
    WD --> WDR

    WH --> ENGINE
    WDR --> ENGINE
    ENGINE --> GEMINI
    ENGINE --> DB
    ENGINE -- "reply (push)" --> FB
    ENGINE -- "reply (push)" --> IG
    ENGINE -- "reply (push)" --> WA
    ENGINE -- "reply (poll response)" --> WDR

    DASH <--> SPA
    SPA <--> API
    API <--> DB
```

Every route lives in its own file under `server/routes/` (auth, profile, products,
orders, persona, conversations, channels, analytics, legal, webhooks, widget) — see
[`docs/CO2_Design_Report_ShopMate_AI.pdf`](./docs/) for the full design rationale.
The AI reply pipeline itself is channel-agnostic: `generateAndStoreAgentReply()` in
`server/conversationEngine.ts` doesn't know or care whether it's replying to a
Messenger PSID, an Instagram user, a WhatsApp number, or an anonymous website
visitor — channel-specific code only exists in the last step, delivering the reply
back out.

## App Flow — how one customer message gets answered

```mermaid
sequenceDiagram
    participant C as Customer
    participant Ch as Channel<br/>(Messenger/IG/WhatsApp/Widget)
    participant R as Route handler
    participant E as Conversation Engine
    participant AI as Gemini
    participant DB as Database

    C->>Ch: Sends a message
    Ch->>R: Webhook event / widget POST
    R->>DB: Find or create Conversation
    alt First message ever in this conversation
        R->>DB: Send store's configured opening greeting
    else Ongoing conversation
        R->>E: generateAndStoreAgentReply(conversation, text)
        E->>DB: Load store persona + product catalog + recent history
        E->>AI: Prompt with persona, catalog, history, message
        AI-->>E: Reply text + cart action + order signals
        E->>DB: Validate & persist cart / address / order state
        opt Customer confirmed a purchase
            E->>DB: Atomically decrement inventory, create Order
        end
        E->>DB: Save AI reply as a Message
    end
    E-->>R: Done
    R-->>Ch: Deliver reply (Graph API push, or HTTP response for the widget)
    Ch-->>C: Customer sees the reply
```

If the merchant has **Copilot** off for that conversation, the AI's reply is saved
as a *pending draft* instead of being sent — the merchant reviews and approves it
from the Inbox before the customer ever sees it.

## User Flow — merchant journey

```mermaid
flowchart LR
    A[Sign up / Google login] --> B[Complete onboarding<br/>business details]
    B --> C{Connect a channel}
    C --> C1[Facebook Messenger]
    C --> C2[Instagram]
    C --> C3[WhatsApp]
    C --> C4[Website Widget]
    C --> C5[Shopify / WooCommerce<br/>catalog sync]
    B --> D[Add products<br/>manually or via sync]
    B --> E[Configure AI Persona<br/>tone, style, opening greeting]
    C1 --> F[Inbox]
    C2 --> F
    C3 --> F
    C4 --> F
    F --> G{Copilot mode<br/>per conversation}
    G -->|AI Managed| H[AI replies automatically]
    G -->|Active| I[AI drafts, merchant approves]
    H --> J[Orders]
    I --> J
    J --> K[Analytics dashboard]
```

## Local Development

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` and fill in the required values.
3. Run the app:
   `npm run dev`

**Channels:** WhatsApp connects by scanning a QR code from the Integrations page (the pairing is stored in the database, so it survives restarts and redeploys; run a single instance). Facebook and Instagram connect through the official Meta login (see `.env.example`). On Railway: push the repo, paste your `.env` into the service variables and deploy; the Dockerfile and `railway.json` handle the rest.

## Documentation

Project docs live in [`docs/`](./docs/) — architecture notes, the AI agent's
order-management rules, the UI design spec, per-channel setup guides (Shopify,
WooCommerce, WhatsApp, Facebook), and the capstone course-outcome submission
documents.

## License

MIT — see [LICENSE](./LICENSE).
