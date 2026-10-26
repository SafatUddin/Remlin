import { Type, FunctionDeclaration, FunctionCallingConfigMode, type Content } from '@google/genai';
import { ai } from './gemini';
import { detectReplyLanguage, replyTexts, type ReplyLanguage } from './replyLanguage';
import { formatPrice, mostCommonCurrency } from '../shared/currency';

const catalogCurrency = (catalog: AgentCatalogItem[]) => mostCommonCurrency(catalog.map((p) => p.currency));
const productPriceLabel = (product: AgentCatalogItem, catalog: AgentCatalogItem[]) =>
  formatPrice(product.price, product.currency || catalogCurrency(catalog));

export interface AgentPersona {
  storeName?: string;
  tone?: string;
  style?: string;
  customInstructions?: string;
  knowledgeContext?: string;
  merchantBusinessInfo?: {
    businessPhone?: string;
    businessType?: string;
    website?: string;
    streetAddress?: string;
    city?: string;
    country?: string;
  };
  shareBusinessInfo?: boolean;
}

export interface AgentCatalogItem {
  name: string;
  sku: string;
  price: number;
  inventory: number;
  status: string;
  imageUrl?: string;
  currency?: string;
}

export interface AgentHistoryItem {
  sender: string;
  text: string;
}

export interface AgentReply {
  replyText: string;
  isComplaint: boolean;
  cartAction: { action: string; sku: string; quantity: number };
  suggestedProductsSKUs: string[];
  extractedAddress: string;
  extractedPhone: string;
  askQuantityForSku: string;
  orderConfirmationRequested: boolean;
  orderConfirmed: boolean;
  orderCancelled: boolean;
  // #REF codes (last 8 chars of the order id) of ongoing orders the customer asked to cancel.
  cancelOrderRefs: string[];
  showImageForSku?: string;
  model?: string;
  latencyMs?: number;
  responseTokens?: number;
  promptTokens?: number;
  fallback?: boolean;
  fallbackReason?: string;
}

export interface AiMetaSummary {
  model: string;
  latencyMs: number;
  responseTokens: number;
  promptTokens: number;
  fallback: boolean;
  fallbackReason?: string;
}

export function normalizeAiMeta(raw: Record<string, any> | null | undefined): AiMetaSummary {
  const model = typeof raw?.model === 'string' && raw.model.trim() ? raw.model.trim() : 'unknown';
  const fallback = !!raw?.fallback || model === 'fallback';
  const latencyMs = Number.isFinite(Number(raw?.latencyMs)) ? Number(raw?.latencyMs) : 0;
  const responseTokens = Number.isFinite(Number(raw?.responseTokens)) ? Number(raw?.responseTokens) : 0;
  const promptTokens = Number.isFinite(Number(raw?.promptTokens)) ? Number(raw?.promptTokens) : 0;
  const fallbackReason = typeof raw?.fallbackReason === 'string' && raw.fallbackReason.trim()
    ? raw.fallbackReason.trim()
    : undefined;

  return {
    model,
    latencyMs,
    responseTokens,
    promptTokens,
    fallback,
    fallbackReason,
  };
}

export interface AgentOrderState {
  awaitingQuantityFor?: string | null;
  orderConfirmationRequested?: boolean;
  hasCartItems?: boolean;
  hasAddress?: boolean;
  hasPhone?: boolean;
  cartItems?: { sku: string; name: string; quantity: number }[];
  pendingItem?: { sku: string; name: string; quantity: number; unitPrice: number; lineTotal: number };
  awaitingContactDetails?: boolean;
  awaitingContactConfirmation?: boolean;
  contactOnFile?: { phone: string; address: string };
  pendingCancelOrders?: { id: string; status: string; total: number }[];
  ongoingOrders?: { id: string; items: { name: string; quantity: number; price: number }[]; status: string; createdAt: string; total: number }[];
}

// Used when the model returns only tool calls with no text — callers may replace it
// with a more specific, state-aware reply.
export const DEFAULT_REPLY_TEXT = 'How can I help you?';

// --- Tool Definitions ---
const tools: FunctionDeclaration[] = [
  {
    name: 'add_to_cart',
    description: 'Add a product to the customer\'s shopping cart. Use this when the customer explicitly states a quantity they want to buy (e.g., "I want 2 Coca Cola", "ami 3ta nibo"). Do NOT use this for price inquiries or when quantity is not given.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sku: {
          type: Type.STRING,
          description: 'The exact SKU of the product from the catalog',
        },
        quantity: {
          type: Type.INTEGER,
          description: 'The number of units the customer wants to buy (must be positive and not exceed inventory)',
        },
        productName: {
          type: Type.STRING,
          description: 'The name of the product being added',
        },
      },
      required: ['sku', 'quantity', 'productName'],
    },
  },
  {
    name: 'show_product_image',
    description: 'Display a product image to the customer. Use this when: (1) customer asks to see a product, (2) customer asks what a product looks like, (3) you are recommending a product and it has a photo available. Only use for products that have "Photo available: yes" in the catalog.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sku: {
          type: Type.STRING,
          description: 'The exact SKU of the product to show image for',
        },
      },
      required: ['sku'],
    },
  },
  {
    name: 'capture_contact_details',
    description: 'Capture and save customer contact information for order delivery. Use this when the customer provides their phone number and/or delivery address. Phone and address are SEPARATE fields — never put the phone number inside the address or vice versa.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        phone: {
          type: Type.STRING,
          description: 'ONLY the customer phone number digits (e.g. "01712345678"), if provided. No words, no address.',
        },
        address: {
          type: Type.STRING,
          description: 'ONLY the delivery address (e.g. "House 12, Road 5, Dhanmondi, Dhaka"), if provided. Never include the phone number or filler words like "my address is".',
        },
      },
      required: [],
    },
  },
  {
    name: 'confirm_order',
    description: 'Confirm the customer wants to proceed with their order. Use this when customer explicitly confirms after seeing the order summary (e.g., "yes", "confirm", "ha", "thik ache", "proceed").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        confirmed: {
          type: Type.BOOLEAN,
          description: 'True if customer confirms, false if they want to cancel',
        },
      },
      required: ['confirmed'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Request cancellation of one or more of the customer\'s ongoing orders (in any language, e.g. "cancel my order", "order ta cancel koren", "অর্ডার বাতিল করুন"). The system will ask the customer to confirm before anything is cancelled.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        orderRefs: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'The #REF codes of the orders to cancel, from "Customer\'s Ongoing Orders". Include every order the customer wants cancelled (e.g. "cancel two of the three" → two refs). If they don\'t say which ones, choose the most recently placed matching orders.',
        },
      },
      required: ['orderRefs'],
    },
  },
  {
    name: 'flag_for_human_review',
    description: 'Flag this conversation for human merchant review. Use this when: (1) customer complains or expresses frustration/dissatisfaction (both sharp complaints like "scam" and soft frustration like "ami hotasho"), (2) you genuinely cannot understand the customer\'s message, (3) customer needs help beyond your capabilities.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: {
          type: Type.STRING,
          description: 'Brief explanation of why this needs human review (e.g., "customer complaint", "unclear message", "complex request")',
        },
        isComplaint: {
          type: Type.BOOLEAN,
          description: 'True if this is a customer complaint or frustration',
        },
      },
      required: ['reason', 'isComplaint'],
    },
  },
  {
    name: 'ask_for_quantity',
    description: 'Ask the customer how many units they want to buy. Use this when customer expresses buy intent but hasn\'t specified a quantity (e.g., "I want to buy Coca Cola" without a number).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sku: {
          type: Type.STRING,
          description: 'The SKU of the product to ask quantity for',
        },
        productName: {
          type: Type.STRING,
          description: 'The name of the product',
        },
        price: {
          type: Type.NUMBER,
          description: 'The price of the product',
        },
      },
      required: ['sku', 'productName', 'price'],
    },
  },
  {
    name: 'request_order_confirmation',
    description: 'Show an order summary and request customer confirmation before finalizing. Use this when customer has items in cart and address, and conversation reaches a checkout moment.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
];

// --- Helper Functions ---
export function extractDollarAmounts(text: string): number[] {
  const matches = text.match(/\$\s?\d+(?:,\d{3})*(?:\.\d{1,2})?/g) || [];
  return matches.map((m) => parseFloat(m.replace(/[$,\s]/g, '')));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function collectGroundedAmounts(catalog: AgentCatalogItem[], orderState: AgentOrderState): Set<number> {
  const allowed = new Set<number>();
  const add = (n: number | undefined | null) => {
    if (typeof n === 'number' && Number.isFinite(n)) allowed.add(round2(n));
  };
  for (const p of catalog) add(p.price);
  if (orderState.pendingItem) {
    add(orderState.pendingItem.unitPrice);
    add(orderState.pendingItem.lineTotal);
  }
  if (orderState.cartItems) {
    let subtotal = 0;
    for (const item of orderState.cartItems) {
      const p = catalog.find((c) => c.sku === item.sku);
      if (p) {
        add(p.price);
        add(round2(p.price * item.quantity));
        subtotal += p.price * item.quantity;
      }
    }
    if (orderState.cartItems.length > 0) add(subtotal);
  }
  for (const o of orderState.pendingCancelOrders || []) add(o.total);
  if (orderState.ongoingOrders) {
    for (const o of orderState.ongoingOrders) {
      add(o.total);
      for (const item of o.items) add(item.price);
    }
  }
  return allowed;
}

export function findUngroundedAmounts(replyText: string, allowed: Set<number>): number[] {
  const stated = extractDollarAmounts(replyText);
  return stated.filter((amount) => !allowed.has(round2(amount)));
}

// Tool results handed back to the model so it can write the customer-facing reply.
function describeToolResult(call: { name?: string; args?: Record<string, any> }, catalog: AgentCatalogItem[]): Record<string, unknown> {
  const args = call.args || {};
  const product = args.sku ? catalog.find((p) => p.sku === args.sku) : undefined;
  const productInfo = product ? { productName: product.name, price: productPriceLabel(product, catalog), inStock: product.inventory } : {};
  switch (call.name) {
    case 'ask_for_quantity':
      return { status: 'ok', ...productInfo, instruction: 'Tell the customer the price and ask how many units they want.' };
    case 'add_to_cart':
      return { status: 'ok', ...productInfo, quantity: args.quantity, instruction: 'The system will show the order summary and ask the customer to confirm.' };
    case 'show_product_image':
      return { status: 'ok', ...productInfo, instruction: 'The product photo is being sent. Briefly describe the product.' };
    case 'cancel_order':
      return { status: 'awaiting_customer_confirmation', instruction: 'The system will list the orders and ask the customer to confirm. Do not say anything was cancelled.' };
    case 'capture_contact_details':
      return { status: 'saved', instruction: 'Thank the customer for the details. Do not say the order is placed.' };
    case 'flag_for_human_review':
      return { status: 'flagged', instruction: 'Respond empathetically and tell the customer a team member will help shortly.' };
    default:
      return { status: 'ok', instruction: 'Reply to the customer naturally. Do not say the order is placed.' };
  }
}

// Last-resort reply if the model still returns no text after the tool round trip.
function toolFallbackText(
  toolCalls: { name?: string; args?: Record<string, any> }[],
  catalog: AgentCatalogItem[],
  lang: ReplyLanguage,
): string {
  const texts = replyTexts(lang);
  for (const call of toolCalls) {
    const product = call.args?.sku ? catalog.find((p) => p.sku === call.args!.sku) : undefined;
    if (call.name === 'ask_for_quantity' && product) return texts.askQuantity(product.name, productPriceLabel(product, catalog));
    if (call.name === 'show_product_image' && product) return texts.showProduct(product.name, productPriceLabel(product, catalog));
    if (call.name === 'flag_for_human_review') return texts.flaggedForReview();
  }
  return DEFAULT_REPLY_TEXT;
}

// --- Main Agent Function ---
export async function generateAgentReply({
  message,
  history = [],
  persona,
  catalog = [],
  promptCatalog,
  orderState = {},
  imageContext,
}: {
  message: string;
  history?: AgentHistoryItem[];
  persona?: AgentPersona;
  catalog?: AgentCatalogItem[];
  promptCatalog?: AgentCatalogItem[];
  orderState?: AgentOrderState;
  /** Server-verified result of matching the customer's photo against the catalog. */
  imageContext?: string;
}): Promise<AgentReply> {
  const startedAt = Date.now();
  const storeCurrency = catalogCurrency(catalog);
  const money = (amount: number) => formatPrice(amount, storeCurrency);
  const catalogText = (promptCatalog ?? catalog)
    .map(
      (p) =>
        `- Name: ${p.name}, SKU: ${p.sku}, Price: ${productPriceLabel(p, catalog)}, Inventory: ${p.inventory} units, Status: ${p.status}, Photo available: ${p.imageUrl ? 'yes' : 'no'}`
    )
    .join('\n');

  const storeName = persona?.storeName?.trim() || 'this store';
  const toneText = persona?.tone || 'Direct, helpful, and highly sophisticated.';
  const styleText =
    persona?.style === 'bullets'
      ? 'Use bullet points for lists, specifications, or pricing whenever possible.'
      : 'Use a fluid, warm, conversational narrative style. Do not use bullets.';
  const customInst = persona?.customInstructions || '';

  // Format merchant business information
  const businessInfo = persona?.merchantBusinessInfo;
  const shareBusinessInfo = persona?.shareBusinessInfo ?? true;
  
  let merchantBusinessInfoText = '';
  if (shareBusinessInfo && businessInfo) {
    const parts = [];
    
    // Natural business description with businessType
    if (businessInfo.businessType) {
      const storeName = persona?.storeName || 'We';
      parts.push(`We are ${storeName}, our business is ${businessInfo.businessType}.`);
    }
    
    if (businessInfo.businessPhone) parts.push(`Phone: ${businessInfo.businessPhone}`);
    if (businessInfo.website) parts.push(`Website: ${businessInfo.website}`);
    
    // Store location without province/postalCode
    if (businessInfo.streetAddress) {
      const addressParts = [
        businessInfo.streetAddress,
        businessInfo.city,
        businessInfo.country,
      ].filter(Boolean);
      parts.push(`Our store location is ${addressParts.join(', ')}`);
    }
    
    merchantBusinessInfoText = parts.join('\n');
  }

  const cartText = orderState.cartItems && orderState.cartItems.length > 0
    ? orderState.cartItems.map((item) => `${item.quantity}x ${item.name} (SKU: ${item.sku})`).join(', ')
    : 'empty';

  const ongoingOrdersText = orderState.ongoingOrders && orderState.ongoingOrders.length > 0
    ? orderState.ongoingOrders
        .map(
          (o) =>
            `- Order #${o.id.slice(-8).toUpperCase()}, Status: ${o.status}, Placed: ${o.createdAt}, Total: ${money(o.total)}, Items: ${o.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}`
        )
        .join('\n')
    : 'No active ongoing orders.';

  const orderStateDescription = [];
  if (orderState.cartItems && orderState.cartItems.length > 0) {
    orderStateDescription.push(`Customer's cart: ${cartText}`);
  }
  if (orderState.awaitingQuantityFor) {
    orderStateDescription.push(`You just asked how many units of SKU "${orderState.awaitingQuantityFor}" they want. If their message contains a number, treat it as the quantity for that product.`);
  }
  if (orderState.pendingItem) {
    orderStateDescription.push(`Customer wants ${orderState.pendingItem.quantity}x "${orderState.pendingItem.name}" at ${money(orderState.pendingItem.unitPrice)} each (total ${money(orderState.pendingItem.lineTotal)}). Waiting for their confirmation.`);
  }
  if (orderState.awaitingContactDetails) {
    orderStateDescription.push(`Customer confirmed the items. Now collect BOTH their phone number and delivery address (both are required). When they share either, call capture_contact_details with the phone and address in their separate fields. Do NOT say the order is placed.`);
  }
  if (orderState.awaitingContactConfirmation && orderState.contactOnFile) {
    orderStateDescription.push(`Waiting for the customer to confirm the delivery details — Phone: ${orderState.contactOnFile.phone}, Address: ${orderState.contactOnFile.address}. If they say yes, call confirm_order(true). If they give a different phone number or address, call capture_contact_details. Do NOT say the order is placed — the system confirms that.`);
  }
  if (orderState.pendingCancelOrders && orderState.pendingCancelOrders.length > 0) {
    orderStateDescription.push(`Waiting for the customer to confirm cancelling order(s) ${orderState.pendingCancelOrders.map((o) => `#${o.id.slice(-8).toUpperCase()}`).join(', ')}. If they agree, call confirm_order(true). If they decline, call confirm_order(false). If they want different orders cancelled, call cancel_order with those refs. Do NOT say anything has been cancelled — the system confirms that.`);
  }
  if (orderState.orderConfirmationRequested) {
    orderStateDescription.push(`You showed an order summary. Waiting for customer to confirm or cancel.`);
  }

  const systemInstruction = `You are ShopMate AI, an elite autonomous sales agent for ${storeName}.

Your goal: Answer customer questions naturally, understand their intent (in English, Bangla, or Banglish), and use the available tools to execute actions.

IMPORTANT - TOOL CALLING PHILOSOPHY:
- Focus on understanding customer INTENT, not just keyword matching
- Let the AI understand what the customer means in their language (English/Bangla/Banglish)
- Use tools to execute actions - don't try to set fields manually
- When in doubt about customer intent, ask for clarification

MERCHANT INFORMATION:
${merchantBusinessInfoText
  ? `${merchantBusinessInfoText}

When customers ask about the shop location, address, contact details, or "where is your shop":
- Share the Store Location information above
- Mention specific details like street address, city, phone number
- Be helpful and informative about how they can find or contact the physical store`
  : `The merchant operates online only.

When customers ask about physical location or address:
- Explain, in the customer's language/script, that we operate entirely online and deliver directly to their doorstep
- Redirect to browsing products and placing orders through chat`
}

CURRENT CONTEXT:
${orderStateDescription.length > 0 ? orderStateDescription.join('\n') : 'No active order flow.'}

Customer's Ongoing Orders (refer to orders only by their short #REF code; never show any other internal ID):
${ongoingOrdersText}

AVAILABLE TOOLS:
1. add_to_cart - When customer states quantity they want (e.g., "I want 2 Coke", "ami 3ta nibo")
2. ask_for_quantity - When customer wants to buy but didn't give quantity (e.g., "I want Coke" without number)
3. show_product_image - When customer asks to see product or you recommend one with photo
4. capture_contact_details - When customer provides phone/address
5. confirm_order - When customer confirms after seeing summary
6. cancel_order - When the customer wants to cancel one or more ongoing orders (the system asks them to confirm)
7. flag_for_human_review - For complaints, frustration, or unclear messages
8. request_order_confirmation - When ready to show checkout summary

INTERACTION GUIDELINES:

UNDERSTANDING INTENT (Most Important):
- "dam koto?" / "price koto?" / "কত টাকা?" = asking price → tell price + ask if they want to buy
- "nibo" / "kinbo" / "lagbe" / "chai" / "want to buy" = buy intent
  - WITH number: use add_to_cart tool
  - WITHOUT number: use ask_for_quantity tool
- "yes" / "ha" / "haa" / "thik ache" / "confirm" after summary = use confirm_order(true)
- "no" / "na" / "cancel" / "dorkar nai" after summary = use confirm_order(false)
- "দোকান কোথায়?" / "shop kothay?" / "where is shop?" = asking for location → share Store Location
- Simple greetings ("hi", "hello", "hey", "আসসালামু আলাইকুম") = respond warmly, DO NOT flag
- Frustration words ("hotasho", "deri hoyeche", "birokto", complaints) = use flag_for_human_review

CHECKOUT RULES:
- Never tell the customer their order has been placed — the system sends that message itself.
- You cannot add, stock, list or change products, prices or inventory. If a customer asks you to add or start selling an item, thank them for the suggestion and say the team will look into it — never promise it will be added.
- Before any order is placed, the customer's phone number and delivery address are always collected and re-confirmed, even if they were shared in an earlier conversation.
- Phone number and address are separate pieces of information — always pass them in separate capture_contact_details fields.

COMPLAINT DETECTION (Be Conservative):
- DO flag: Clear complaints about product quality, service issues, refund requests, anger/frustration
- DO NOT flag: Simple greetings, questions, casual conversation, or unclear messages
- Examples that should NOT be flagged: "hi", "hello", "hey there", "kemon acho?"
- Only use flag_for_human_review when there is GENUINE complaint or frustration

PRICE ACCURACY:
- Only state prices from the catalog below
- Never invent or guess prices
- Calculate totals carefully (price × quantity)

MULTILINGUAL SUPPORT:
- Bangla: দাম, কত, টাকা, নিব, চাই, ঠিক আছে
- Banglish: dam, koto, taka, nibo, kinbo, lagbe, chai, thik ache
- English: price, buy, want, need, okay, confirm
- REPLY LANGUAGE — always mirror the script and language of the customer's latest message:
  - Bangla script (e.g. "দাম কত?") → reply in Bangla script.
  - Banglish = Bangla words typed in English letters (e.g. "ami 2ta nibo", "dam koto?", "snowboard ta kinte chai") → reply in Banglish, written in English letters. Never switch to English or Bangla script for a Banglish customer.
    Example: customer "multi managed snowboard ta nite chai" → "Multi-managed Snowboard er dam ${money(629.95)}. Apni koyta nite chan?"
  - English → reply in English.
- Product names, SKUs and prices stay exactly as written in the catalog in every language. Always quote prices with the same currency symbol/code shown in the catalog — never assume dollars.

TONE: ${toneText}
STYLE: ${styleText}
CUSTOM INSTRUCTIONS: ${customInst}

BUSINESS KNOWLEDGE (use only when relevant; never invent details not present here):
${persona?.knowledgeContext || 'No additional business knowledge is configured.'}

PRODUCT CATALOG:
${catalogText || 'No products available.'}${imageContext ? `

CUSTOMER PHOTO (verified by the system — the customer's latest message refers to this photo):
${imageContext}` : ''}`;

  if (!ai) {
    // Fallback to simple response if Gemini not available
    const fallbackMeta = normalizeAiMeta({
      model: 'fallback',
      latencyMs: Date.now() - startedAt,
      responseTokens: 0,
      promptTokens: 0,
      fallback: true,
      fallbackReason: 'gemini_unavailable',
    });
    return {
      replyText: "I'm currently unable to process your request. A team member will assist you shortly.",
      isComplaint: true,
      cartAction: { action: 'none', sku: '', quantity: 0 },
      suggestedProductsSKUs: [],
      extractedAddress: '',
      extractedPhone: '',
      askQuantityForSku: '',
      orderConfirmationRequested: false,
      orderConfirmed: false,
      orderCancelled: false,
      cancelOrderRefs: [],
      showImageForSku: '',
      ...fallbackMeta,
    };
  }

  try {
    const contentsPayload: Content[] = [
      ...history.map((h) => ({
        role: h.sender === 'customer' ? 'user' : 'model',
        parts: [{ text: h.text }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: contentsPayload,
      config: {
        systemInstruction,
        temperature: 0.4, // Slightly higher for better intent understanding
        tools: [{ functionDeclarations: tools }],
      },
    });

    const candidateContent = response.candidates?.[0]?.content;
    if (!candidateContent) {
      throw new Error('No response candidate from Gemini');
    }

    let replyText = '';
    const toolCalls: any[] = [];

    // Extract text and function calls
    for (const part of candidateContent.parts ?? []) {
      if (part.text) {
        replyText += part.text;
      }
      if (part.functionCall) {
        toolCalls.push(part.functionCall);
      }
    }

    // The model often answers with only a tool call (e.g. ask_for_quantity) and no text.
    // Complete the function-calling round trip — hand it the tool results and ask for the
    // customer-facing reply with tools disabled — instead of falling back to a canned line.
    if (toolCalls.length > 0 && !replyText.trim()) {
      try {
        const followUp = await ai.models.generateContent({
          model: 'gemini-3.5-flash-lite',
          contents: [
            ...contentsPayload,
            candidateContent,
            {
              role: 'user',
              parts: toolCalls.map((call) => ({
                functionResponse: { id: call.id, name: call.name, response: describeToolResult(call, catalog) },
              })),
            },
          ],
          config: {
            systemInstruction,
            temperature: 0.4,
            tools: [{ functionDeclarations: tools }],
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } },
          },
        });
        replyText = followUp.text || '';
      } catch (err: any) {
        console.error('Follow-up reply generation failed:', err?.message || err);
      }
      if (!replyText.trim()) {
        const lang = detectReplyLanguage(message, history.filter((h) => h.sender === 'customer').map((h) => h.text));
        replyText = toolFallbackText(toolCalls, catalog, lang);
      }
    }

    // Process tool calls and build AgentReply
    const result: AgentReply = {
      replyText: replyText.trim() || DEFAULT_REPLY_TEXT,
      isComplaint: false,
      cartAction: { action: 'none', sku: '', quantity: 0 },
      suggestedProductsSKUs: [],
      extractedAddress: '',
      extractedPhone: '',
      askQuantityForSku: '',
      orderConfirmationRequested: false,
      orderConfirmed: false,
      orderCancelled: false,
      cancelOrderRefs: [],
      showImageForSku: '',
      model: 'gemini-3.5-flash-lite',
      latencyMs: 0,
      responseTokens: 0,
      promptTokens: 0,
      fallback: false,
    };

    const usageMetadata = (response as any)?.usageMetadata ?? {};
    const detectedResponseTokens = Number(
      usageMetadata.candidatesTokenCount ?? usageMetadata.outputTokenCount ?? usageMetadata.totalTokenCount ?? 0,
    );
    const detectedPromptTokens = Number(
      usageMetadata.promptTokenCount ?? usageMetadata.inputTokenCount ?? 0,
    );
    result.responseTokens = Number.isFinite(detectedResponseTokens) ? detectedResponseTokens : 0;
    result.promptTokens = Number.isFinite(detectedPromptTokens) ? detectedPromptTokens : 0;
    result.latencyMs = Date.now() - startedAt;

    // Process each tool call
    for (const toolCall of toolCalls) {
      const { name, args } = toolCall;

      switch (name) {
        case 'add_to_cart':
          // Validate SKU exists and has inventory
          const product = catalog.find((p) => p.sku === args.sku);
          if (product && args.quantity > 0 && args.quantity <= product.inventory && args.quantity <= 99) {
            result.cartAction = {
              action: 'add',
              sku: args.sku,
              quantity: args.quantity,
            };
          }
          break;

        case 'show_product_image':
          const imageProduct = catalog.find((p) => p.sku === args.sku && p.imageUrl);
          if (imageProduct) {
            result.showImageForSku = args.sku;
          }
          break;

        case 'capture_contact_details':
          if (typeof args.phone === 'string') result.extractedPhone = args.phone.trim();
          if (typeof args.address === 'string') result.extractedAddress = args.address.trim();
          break;

        case 'confirm_order':
          if (args.confirmed === true) {
            result.orderConfirmed = true;
          } else if (args.confirmed === false) {
            result.orderCancelled = true;
          }
          break;

        case 'cancel_order': {
          const refs: unknown[] = Array.isArray(args.orderRefs) ? args.orderRefs : [args.orderRefs ?? args.orderId];
          result.cancelOrderRefs = refs
            .filter((r): r is string => typeof r === 'string' && !!r.trim())
            .map((r) => r.replace(/^#/, '').trim().slice(-8).toUpperCase());
          break;
        }

        case 'flag_for_human_review':
          result.isComplaint = args.isComplaint || false;
          break;

        case 'ask_for_quantity':
          result.askQuantityForSku = args.sku || '';
          break;

        case 'request_order_confirmation':
          result.orderConfirmationRequested = true;
          break;
      }
    }

    // Grounding check for prices
    const groundedAmounts = collectGroundedAmounts(catalog, orderState);
    const ungrounded = findUngroundedAmounts(result.replyText, groundedAmounts);
    
    if (ungrounded.length > 0) {
      // Price hallucination detected - flag for review
      result.replyText = "Let me double-check that and get back to you shortly — a team member will confirm the exact amount.";
      result.isComplaint = true;
    }

    result.model = 'gemini-3.5-flash-lite';
    result.fallback = false;
    result.fallbackReason = undefined;

    return result;

  } catch (error: any) {
    console.error('Error in generateAgentReply with tools:', error?.message || error);
    const fallbackMeta = normalizeAiMeta({
      model: 'fallback',
      latencyMs: Date.now() - startedAt,
      responseTokens: 0,
      promptTokens: 0,
      fallback: true,
      fallbackReason: 'gemini_error',
    });
    
    // Fallback response
    return {
      replyText: "I want to make sure I get this right for you — a team member will follow up shortly.",
      isComplaint: true,
      cartAction: { action: 'none', sku: '', quantity: 0 },
      suggestedProductsSKUs: [],
      extractedAddress: '',
      extractedPhone: '',
      askQuantityForSku: '',
      orderConfirmationRequested: false,
      orderConfirmed: false,
      orderCancelled: false,
      cancelOrderRefs: [],
      showImageForSku: '',
      ...fallbackMeta,
    };
  }
}

// Keep the isQuestionOrPriceInquiry function for backwards compatibility
export async function isQuestionOrPriceInquiry(text: string): Promise<boolean> {
  if (!text || typeof text !== 'string') return false;

  const lower = text.toLowerCase().trim();

  // Price keywords
  if (
    /\bprice\b/i.test(lower) ||
    lower.includes('dam') ||
    lower.includes('daam') ||
    lower.includes('taka') ||
    lower.includes('rate') ||
    lower.includes('cost') ||
    lower.includes('কত') ||
    lower.includes('দাম') ||
    lower.includes('টাকা')
  ) {
    return true;
  }

  // Question markers
  if (
    lower.includes('?') ||
    lower.startsWith('is ') ||
    lower.startsWith('are ') ||
    lower.startsWith('can ') ||
    lower.startsWith('do ') ||
    lower.startsWith('does ') ||
    lower.startsWith('what') ||
    lower.startsWith('how') ||
    lower.startsWith('where') ||
    lower.startsWith('when') ||
    lower.includes('koto') ||
    lower.includes('koyta') ||
    lower.includes('kene') ||
    lower.includes('keno') ||
    lower.includes('ki ') ||
    lower.includes(' ache') ||
    lower.includes(' hobe') ||
    lower.includes(' naki') ||
    lower.includes(' hobe ki')
  ) {
    return true;
  }

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Analyze the following comment. Is the user asking a question OR inquiring about price/details (in English, Bangla, or Banglish)?\n\nComment: "${text}"\n\nReturn JSON: {"isQuestionOrPrice": true} or {"isQuestionOrPrice": false}`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isQuestionOrPrice: { type: Type.BOOLEAN },
            },
            required: ['isQuestionOrPrice'],
          },
        },
      });

      if (response.text) {
        const parsed = JSON.parse(response.text.trim());
        return !!parsed.isQuestionOrPrice;
      }
    } catch (err: any) {
      console.error('Error classifying comment question/price intent via Gemini');
    }
  }

  return false;
}
