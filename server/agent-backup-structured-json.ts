import { Type, FunctionDeclaration } from '@google/genai';
import { ai } from './gemini';

export interface AgentPersona {
  storeName?: string;
  tone?: string;
  style?: string;
  customInstructions?: string;
  merchantBusinessInfo?: {
    businessPhone?: string;
    businessType?: string;
    streetAddress?: string;
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
  askQuantityForSku: string;
  orderConfirmationRequested: boolean;
  orderConfirmed: boolean;
  orderCancelled: boolean;
  showImageForSku?: string;
}

export interface AgentOrderState {
  awaitingQuantityFor?: string | null;
  orderConfirmationRequested?: boolean;
  hasCartItems?: boolean;
  hasAddress?: boolean;
  cartItems?: { sku: string; name: string; quantity: number }[];
  pendingItem?: { sku: string; name: string; quantity: number; unitPrice: number; lineTotal: number };
  awaitingContactDetails?: boolean;
  pendingCancelOrder?: { id: string; status: string; total: number } | null;
  ongoingOrders?: { id: string; items: { name: string; quantity: number; price: number }[]; status: string; createdAt: string; total: number }[];
}

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
    description: 'Capture and save customer contact information for order delivery. Use this when the customer provides their phone number and/or delivery address.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        phone: {
          type: Type.STRING,
          description: 'Customer phone number (if provided)',
        },
        address: {
          type: Type.STRING,
          description: 'Customer delivery address (if provided)',
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
    description: 'Cancel an ongoing order. Use this only after explicitly confirming with the customer that they want to cancel a specific order.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        orderId: {
          type: Type.STRING,
          description: 'The order ID to cancel (from ongoingOrders)',
        },
      },
      required: ['orderId'],
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
  if (orderState.pendingCancelOrder) add(orderState.pendingCancelOrder.total);
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

// --- Main Agent Function ---
export async function generateAgentReply({
  message,
  history = [],
  persona,
  catalog = [],
  promptCatalog,
  orderState = {},
}: {
  message: string;
  history?: AgentHistoryItem[];
  persona?: AgentPersona;
  catalog?: AgentCatalogItem[];
  promptCatalog?: AgentCatalogItem[];
  orderState?: AgentOrderState;
}): Promise<AgentReply> {
  const catalogText = (promptCatalog ?? catalog)
    .map(
      (p) =>
        `- Name: ${p.name}, SKU: ${p.sku}, Price: $${p.price}, Inventory: ${p.inventory} units, Status: ${p.status}, Photo available: ${p.imageUrl ? 'yes' : 'no'}`
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
    
    // Store location without province/postalCode
    if (businessInfo.streetAddress) {
      parts.push(`Our store location is ${businessInfo.streetAddress}`);
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
            `- Order ID: ${o.id}, Status: ${o.status}, Placed: ${o.createdAt}, Total: $${o.total.toFixed(
              2
            )}, Items: ${o.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}`
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
    orderStateDescription.push(`Customer wants ${orderState.pendingItem.quantity}x "${orderState.pendingItem.name}" at $${orderState.pendingItem.unitPrice.toFixed(2)} each (total $${orderState.pendingItem.lineTotal.toFixed(2)}). Waiting for their confirmation.`);
  }
  if (orderState.awaitingContactDetails) {
    orderStateDescription.push(`Customer confirmed order. Now collect their phone number and delivery address.`);
  }
  if (orderState.pendingCancelOrder) {
    orderStateDescription.push(`Waiting for customer to confirm cancelling order #${orderState.pendingCancelOrder.id.slice(-8).toUpperCase()}.`);
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
- Mention specific details like the address and phone number
- Be helpful and informative about how they can find or contact the physical store`
  : `The merchant operates online only.

When customers ask about physical location or address:
- Explain: "We operate entirely online to bring you the best selection directly to your doorstep"
- Redirect to browsing products and placing orders through chat`
}

CURRENT CONTEXT:
${orderStateDescription.length > 0 ? orderStateDescription.join('\n') : 'No active order flow.'}

Customer's Ongoing Orders:
${ongoingOrdersText}

AVAILABLE TOOLS:
1. add_to_cart - When customer states quantity they want (e.g., "I want 2 Coke", "ami 3ta nibo")
2. ask_for_quantity - When customer wants to buy but didn't give quantity (e.g., "I want Coke" without number)
3. show_product_image - When customer asks to see product or you recommend one with photo
4. capture_contact_details - When customer provides phone/address
5. confirm_order - When customer confirms after seeing summary
6. cancel_order - When customer confirms they want to cancel an order
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
- Respond in the same language the customer uses

TONE: ${toneText}
STYLE: ${styleText}
CUSTOM INSTRUCTIONS: ${customInst}

PRODUCT CATALOG:
${catalogText || 'No products available.'}`;

  if (!ai) {
    // Fallback to simple response if Gemini not available
    return {
      replyText: "I'm currently unable to process your request. A team member will assist you shortly.",
      isComplaint: true,
      cartAction: { action: 'none', sku: '', quantity: 0 },
      suggestedProductsSKUs: [],
      extractedAddress: '',
      askQuantityForSku: '',
      orderConfirmationRequested: false,
      orderConfirmed: false,
      orderCancelled: false,
      showImageForSku: '',
    };
  }

  try {
    const contentsPayload = [
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

    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw new Error('No response candidate from Gemini');
    }

    let replyText = '';
    const toolCalls: any[] = [];

    // Extract text and function calls
    for (const part of candidate.content.parts) {
      if (part.text) {
        replyText += part.text;
      }
      if (part.functionCall) {
        toolCalls.push(part.functionCall);
      }
    }

    // Process tool calls and build AgentReply
    const result: AgentReply = {
      replyText: replyText.trim() || 'How can I help you?',
      isComplaint: false,
      cartAction: { action: 'none', sku: '', quantity: 0 },
      suggestedProductsSKUs: [],
      extractedAddress: '',
      askQuantityForSku: '',
      orderConfirmationRequested: false,
      orderConfirmed: false,
      orderCancelled: false,
      showImageForSku: '',
    };

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
          const parts = [];
          if (args.phone) parts.push(`Phone: ${args.phone}`);
          if (args.address) parts.push(`Address: ${args.address}`);
          if (parts.length > 0) {
            result.extractedAddress = parts.join(' | ');
          }
          break;

        case 'confirm_order':
          if (args.confirmed === true) {
            result.orderConfirmed = true;
          } else if (args.confirmed === false) {
            result.orderCancelled = true;
          }
          break;

        case 'cancel_order':
          result.orderCancelled = true;
          break;

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

    return result;

  } catch (error: any) {
    console.error('Error in generateAgentReply with tools:', error?.message || error);
    
    // Fallback response
    return {
      replyText: "I want to make sure I get this right for you — a team member will follow up shortly.",
      isComplaint: true,
      cartAction: { action: 'none', sku: '', quantity: 0 },
      suggestedProductsSKUs: [],
      extractedAddress: '',
      askQuantityForSku: '',
      orderConfirmationRequested: false,
      orderConfirmed: false,
      orderCancelled: false,
      showImageForSku: '',
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
