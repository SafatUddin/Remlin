// The AI reply pipeline shared by every channel — Messenger/WhatsApp/Instagram webhooks,
// the website widget, and the merchant's own test-chat sandbox all funnel through
// generateAndStoreAgentReply (and sendOpeningGreetingIfNew for a customer's first message).
// None of it is channel-specific except the final "push it out" branches at the bottom of
// generateAndStoreAgentReply, which simply don't match for channels with no push API (WIDGET).
import { prisma } from './db';
import { decryptSecret } from './crypto';
import { generateAgentReply, DEFAULT_REPLY_TEXT } from './agent';
import { resolveProductImageUrl } from '../shared/productImage';
import { formatPrice, getCatalogCurrency, getProductCurrency } from '../shared/currency';
import { resolveProductName } from '../shared/catalogColumns';
import {
  sendMessengerMessage,
  sendMessengerImage,
  sendWhatsAppMessage,
  sendWhatsAppImage,
  sendInstagramMessage,
  sendInstagramImage,
} from './meta';
import { deliverChannelMessage } from './channels/outbound';
import {
  parseAwaitingQuantityFor,
  sanitizeAskQuantityForSku,
  validateSkuAndQuantity,
  encodeConfirm,
  encodeCancelPending,
  isAffirmativeMessage,
  isCancelDeclineMessage,
  isCheckoutAffirmative,
  isCheckoutCancelIntent,
  isOngoingOrderCancelIntent,
  normalizeCheckoutQuantity,
  MAX_CHECKOUT_QUANTITY,
  CONTACT_DETAILS_STATE,
  CONTACT_CONFIRM_STATE,
} from './checkoutSecurity';
import { createOrderForConversation } from './orderCreation';
import { extractPhone, splitContactDetails } from './contactDetails';
import { detectReplyLanguage, replyTexts } from './replyLanguage';
import { matchCatalogImage, recognizeCatalogImage, type ImageRecognitionResult, type VisualMatch } from './imageRecognition';
import { headerTokens } from '../shared/catalogColumns';
import { formatKnowledgeForPrompt, selectRelevantKnowledge } from './knowledgeBase';

const isProduction = process.env.NODE_ENV === 'production';

/** Text the webhooks store for a customer message that is only a photo. */
export const IMAGE_PLACEHOLDER_TEXT = 'Customer sent an image.';

const asAttributeRecord = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};

/** The product's color from a "Color"/"colour"/"color_name" column, if any. */
function productColor(raw: unknown): string | undefined {
  const entry = Object.entries(asAttributeRecord(raw)).find(([key, value]) =>
    headerTokens(key).some((t) => t === 'color' || t === 'colour' || t === 'colors' || t === 'colours') && value != null && String(value).trim());
  return entry ? String(entry[1]).trim().slice(0, 60) : undefined;
}

function buildRecognitionCatalog(products: { name: string; sku: string; price: unknown; description: string | null; imageUrl: string | null; rawAttributes: unknown }[]) {
  return products.map((p) => ({
    name: p.name,
    sku: p.sku,
    price: Number(p.price),
    description: p.description,
    imageUrl: resolveProductImageUrl(p),
    attributes: summarizeAttributes(p.rawAttributes),
  }));
}

/** Starts comparing a customer's photo with the store catalog right away (used during the reply wait). */
export async function startCatalogImageMatch(storeId: string, image: Buffer): Promise<VisualMatch> {
  const products = (await prisma.product.findMany({ where: { storeId } })).map((p) => ({ ...p, name: resolveProductName(p) }));
  return matchCatalogImage(image, buildRecognitionCatalog(products));
}

/** Short "key: value" summary of a product's extra columns for image matching (no links/long text). */
function summarizeAttributes(raw: unknown): string | undefined {
  const parts = Object.entries(asAttributeRecord(raw))
    .filter(([, value]) => value != null && typeof value !== 'object')
    .map(([key, value]) => [key, String(value).trim()] as const)
    .filter(([, value]) => value && value.length <= 120 && !/^https?:\/\//i.test(value))
    .slice(0, 15)
    .map(([key, value]) => `${key}: ${value}`);
  return parts.length ? parts.join('; ') : undefined;
}

// Short customer-facing order reference (#XXXXXXXX), also used by the agent's cancel_order tool.
const orderRef = (id: string) => id.slice(-8).toUpperCase();

async function loadEnabledKnowledgeDocuments(storeId: string) {
  try {
    return await prisma.knowledgeDocument.findMany({
      where: { storeId, enabled: true },
      orderBy: { updatedAt: 'desc' },
    });
  } catch (err) {
    // Knowledge migrations may be deployed after the application code on a shared
    // database. Keep the core agent usable without unconfigured knowledge context.
    if (!isProduction) console.warn('[AGENT] Knowledge base unavailable; continuing without it');
    return [];
  }
}

// Only the real self-serve OAuth connection's per-store token is used — there is no
// manual/env-var fallback, so a store with no completed Facebook connection simply
// can't send or fetch anything via Messenger.
export async function getPageAccessTokenForStore(storeId: string): Promise<string | null> {
  const channel = await prisma.channel.findUnique({ where: { storeId_type: { storeId, type: 'FACEBOOK' } } });
  if (channel?.connected && channel.credentials) {
    try {
      const { token } = channel.credentials as { token: string };
      return decryptSecret(token);
    } catch (err) {
      console.error('Failed to decrypt stored Facebook token:', err);
    }
  }
  return null;
}

export async function getWhatsAppCredentialsForStore(storeId: string): Promise<{ phoneNumberId: string; accessToken: string } | null> {
  const channel = await prisma.channel.findUnique({ where: { storeId_type: { storeId, type: 'WHATSAPP' } } });
  if (channel?.connected && channel.credentials) {
    try {
      const { token, phoneNumberId } = channel.credentials as { token: string; phoneNumberId: string };
      return { phoneNumberId, accessToken: decryptSecret(token) };
    } catch (err) {
      console.error('Failed to decrypt stored WhatsApp credentials:', err);
    }
  }
  return null;
}

export async function getInstagramCredentialsForStore(storeId: string): Promise<{ igAccountId: string; accessToken: string } | null> {
  const channel = await prisma.channel.findUnique({ where: { storeId_type: { storeId, type: 'INSTAGRAM' } } });
  if (channel?.connected && channel.credentials && channel.externalId) {
    try {
      const { token } = channel.credentials as { token: string };
      return { igAccountId: channel.externalId, accessToken: decryptSecret(token) };
    } catch (err) {
      console.error('Failed to decrypt stored Instagram credentials:', err);
    }
  }
  return null;
}

// Below this many products, the full catalog is small enough that filtering it isn't
// worth the risk of ever omitting something relevant — send it as-is.
const CATALOG_LEXICAL_FILTER_THRESHOLD = 15;

const CATALOG_FILTER_STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'do', 'does', 'you', 'have', 'has', 'i', 'want', 'to',
  'buy', 'of', 'for', 'and', 'in', 'on', 'it', 'this', 'that', 'what', 'how', 'much',
  'price', 'can', 'please', 'me', 'my', 'with', 'pcs', 'piece', 'pieces', 'item', 'items',
  'order', 'get', 'like', 'any', 'your', 'there', 'hello', 'hi', 'hey',
]);

function tokenizeForCatalogFilter(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
    (w) => w.length > 2 && !CATALOG_FILTER_STOPWORDS.has(w)
  );
}

// Narrows what actually gets listed in the Gemini prompt to the products plausibly
// relevant to the current turn, so a large catalog doesn't inflate every request's
// latency. Pure lexical overlap (no embeddings/vector search needed at this scale —
// worth revisiting as real RAG only once a store's catalog grows much larger than a
// few dozen items). Falls back to the full catalog whenever nothing matches, so the
// model is never worse-informed than before, only faster when it doesn't need to be.
export function selectRelevantCatalog<T extends { name: string; sku: string }>(
  fullCatalog: T[],
  message: string,
  historyTexts: string[],
  pinnedSkus: Set<string>
): T[] {
  if (fullCatalog.length <= CATALOG_LEXICAL_FILTER_THRESHOLD) return fullCatalog;

  const queryTokens = new Set([
    ...tokenizeForCatalogFilter(message),
    ...historyTexts.flatMap(tokenizeForCatalogFilter),
  ]);
  if (queryTokens.size === 0) return fullCatalog;

  const matched = fullCatalog.filter((p) => {
    if (pinnedSkus.has(p.sku)) return true;
    return tokenizeForCatalogFilter(`${p.name} ${p.sku}`).some((t) => queryTokens.has(t));
  });

  return matched.length > 0 ? matched : fullCatalog;
}

// Generates an AI reply for a conversation and either delivers it immediately (Copilot
// on / AI_MANAGED) or stores it as a pending draft awaiting merchant approval (Copilot
// off / manual). Only delivers externally (e.g. Messenger) when actually sent.
export async function generateAndStoreAgentReply(
  conversation: { id: string; storeId: string; status: string; channelType: string; externalUserId: string | null; isComplaint: boolean },
  customerText: string,
  customerImage?: Buffer,
  /** Visual catalog match already started when the photo arrived (see inboundBatcher). */
  precomputedMatch?: Promise<VisualMatch>,
) {
  if (!isProduction) {
    console.log('[AGENT REPLY] generateAndStoreAgentReply — conversationId:', conversation.id, '| storeId:', conversation.storeId);
  }
  const [store, storedProducts, knowledgeDocuments, recentMessages, currentConversation, conversationOrders, lastOrder] = await Promise.all([
    prisma.store.findUnique({ where: { id: conversation.storeId } }),
    prisma.product.findMany({ where: { storeId: conversation.storeId } }),
    loadEnabledKnowledgeDocuments(conversation.storeId),
    // Only the last 11 are ever used below (10 for history + the just-inserted customer
    // message that gets dropped) — fetching the whole thread wastes DB work on long-running
    // conversations. desc + take, then reversed in JS, to get "last N in chronological order".
    prisma.message.findMany({
      where: { conversationId: conversation.id },
      select: { id: true, sender: true, text: true, createdAt: true, pending: true },
      orderBy: { createdAt: 'desc' },
      take: 11,
    }),
    prisma.conversation.findUnique({ where: { id: conversation.id } }),
    prisma.order.findMany({
      where: {
        storeId: conversation.storeId,
        conversationId: conversation.id,
        status: { in: ['PROCESSING', 'ON_THE_WAY'] },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.order.findFirst({
      where: { storeId: conversation.storeId, conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      select: { address: true, customerPhone: true },
    }),
  ]);
  const products = storedProducts.map((p) => ({ ...p, name: resolveProductName(p) }));
  if (!store || !currentConversation) return;

  const persona = {
    storeName: store.name,
    tone: store.tone,
    style: store.style,
    customInstructions: store.customInstructions,
    knowledgeContext: '',
    merchantBusinessInfo: {
      businessPhone: store.businessPhone || undefined,
      businessType: store.businessType || undefined,
      website: store.website || undefined,
      streetAddress: store.streetAddress || undefined,
      city: store.city || undefined,
      country: store.country || undefined,
    },
    shareBusinessInfo: store.shareBusinessInfo,
  };
  const storeCurrency = getCatalogCurrency(products);
  const money = (amount: number, currency?: string) => formatPrice(amount, currency || storeCurrency);
  const catalog = products.map((p) => ({
    name: p.name,
    sku: p.sku,
    price: Number(p.price),
    inventory: p.inventory,
    status: p.status === 'TRAINED' ? 'Trained' : 'Pending',
    imageUrl: resolveProductImageUrl(p),
    currency: getProductCurrency(p.rawAttributes),
  }));
  const knowledge = selectRelevantKnowledge(
    knowledgeDocuments,
    customerText,
    recentMessages.slice().reverse().map((message) => message.text),
  );
  persona.knowledgeContext = formatKnowledgeForPrompt(knowledge);
  // The webhook stores "Customer sent an image." when a photo arrives without any words.
  const hasCustomerWords = !!customerText.trim() && customerText.trim() !== IMAGE_PLACEHOLDER_TEXT;
  let agentCustomerText = customerText;
  let imageMatch: ImageRecognitionResult | null = null;
  let imageContext: string | undefined;
  let imageMatchedProduct: (typeof products)[number] | undefined;
  const describeProduct = (p: (typeof products)[number]) => {
    const color = productColor(p.rawAttributes);
    return `SKU ${p.sku}, name "${p.name}", price ${money(Number(p.price), getProductCurrency(p.rawAttributes))}${color ? `, color ${color}` : ''}, ${p.inventory > 0 ? `${p.inventory} in stock` : 'out of stock'}`;
  };
  if (customerImage) {
    imageMatch = await recognizeCatalogImage(customerImage, buildRecognitionCatalog(products), hasCustomerWords ? customerText : '', precomputedMatch);
    imageMatchedProduct = imageMatch.sku ? products.find((p) => p.sku === imageMatch!.sku) : undefined;
    if (!isProduction) {
      console.log('[IMAGE MATCH]', JSON.stringify({ match: imageMatch.match, sku: imageMatch.sku, confidence: imageMatch.confidence, intent: imageMatch.intent }));
    }
    if (imageMatch.match === 'exact' && imageMatchedProduct) {
      imageContext = `The photo is an EXACT match for: ${describeProduct(imageMatchedProduct)}. Answer the customer's request about this product; its photo is sent automatically.`;
    } else if (imageMatch.match === 'similar' && imageMatchedProduct) {
      imageContext = `We do NOT have the exact product in the photo. The closest similar product is: ${describeProduct(imageMatchedProduct)}. Tell the customer we don't have that exact item, offer this similar one (name, price, color) and answer their request about it; its photo is sent automatically.`;
    } else {
      imageContext = 'No product in the catalog resembles the photo. Tell the customer we don\'t have it and ask what they are looking for. Never invent a product.';
    }
    agentCustomerText += imageMatchedProduct ? ` ${imageMatchedProduct.name}` : '';
  }
  // Cap history sent to the model — an unbounded prompt grows with every message in a
  // long-running conversation, which slows down local LLM inference noticeably.
  const history = recentMessages.slice().reverse().slice(0, -1).map((m) => ({ sender: m.sender.toLowerCase(), text: m.text }));
  // Server-written replies follow the customer's language: Bangla script, Banglish, or English.
  const texts = replyTexts(detectReplyLanguage(hasCustomerWords ? customerText : '', history.filter((h) => h.sender === 'customer' && h.text !== IMAGE_PLACEHOLDER_TEXT).map((h) => h.text)));

  const existingCart: { sku: string; quantity: number }[] = (currentConversation.cart as any) || [];

  // Decode + validate the prefix-encoded state stored in awaitingQuantityFor.
  // LLM never authoritatively sets business state — invalid encodings are cleared.
  const rawAWQ = currentConversation.awaitingQuantityFor;
  const parsedAWQ = parseAwaitingQuantityFor(rawAWQ);
  const isConfirmState = parsedAWQ.kind === 'confirm';
  const isDetailsState = parsedAWQ.kind === 'details';
  const isCancelPendingState = parsedAWQ.kind === 'cancel_pending';

  let pendingEncodedSku: string | null = null;
  let pendingEncodedQty = 0;
  let pendingCancelOrders: typeof conversationOrders = [];

  if (parsedAWQ.kind === 'confirm' || parsedAWQ.kind === 'details') {
    const validated = validateSkuAndQuantity(products, parsedAWQ.sku, parsedAWQ.qty);
    if (validated.ok) {
      pendingEncodedSku = validated.sku;
      pendingEncodedQty = validated.qty;
    }
  } else if (parsedAWQ.kind === 'cancel_pending') {
    // Only orders that really belong to this conversation and are still active.
    pendingCancelOrders = conversationOrders.filter((o) => parsedAWQ.orderIds.includes(o.id));
  }

  // Drop corrupt / cross-SKU / over-inventory encodings so they cannot drive checkout.
  const pendingProduct = pendingEncodedSku ? products.find((p) => p.sku === pendingEncodedSku) : null;
  const confirmDetailsValid =
    (isConfirmState || isDetailsState) && !!pendingProduct && pendingEncodedQty > 0;
  const cancelPendingValid = isCancelPendingState && pendingCancelOrders.length > 0;

  // Phone + address collection and re-confirmation operate on the server-side cart. A
  // legacy DETAILS:SKU:QTY encoding (in flight before this step existed) counts as collection.
  const contactFlowCart: { sku: string; quantity: number }[] =
    isDetailsState && confirmDetailsValid ? [{ sku: pendingEncodedSku!, quantity: pendingEncodedQty }] : existingCart;
  const isContactDetailsState =
    (isDetailsState && confirmDetailsValid) || (parsedAWQ.kind === 'contact_details' && existingCart.length > 0);
  const isContactConfirmState = parsedAWQ.kind === 'contact_confirm' && existingCart.length > 0;
  const inContactFlow = isContactDetailsState || isContactConfirmState;
  const inCheckoutFlow = isConfirmState || isDetailsState || inContactFlow;

  // Contact details on file: this conversation's saved phone/address, falling back to the
  // customer's most recent order. Never used to order silently — always re-confirmed first.
  const conversationContact = splitContactDetails({ phone: currentConversation.detectedPhone, address: currentConversation.detectedAddress });
  const lastOrderContact = lastOrder
    ? splitContactDetails({ phone: lastOrder.customerPhone, address: lastOrder.address })
    : { phone: '', address: '' };
  const storedContact = {
    phone: conversationContact.phone || lastOrderContact.phone,
    address: conversationContact.address || lastOrderContact.address,
  };

  // === CUSTOMER PHOTO — server-written reply for the common cases ===
  // "Do you have this?" / price / photo alone → matched product's info + its catalog photo.
  // Requests to stock the item → thank them; nothing is ever added to the catalog.
  // Purchases and specific questions fall through to the model with the verified match.
  if (imageMatch) {
    const isAutopilot = conversation.status === 'AI_MANAGED';
    let direct: { text: string; product?: (typeof products)[number] } | null = null;
    if (imageMatch.match === 'unavailable') {
      direct = { text: texts.imageReviewLater() };
    } else if (imageMatch.intent === 'inventory_request' && imageMatch.match !== 'exact') {
      direct = { text: texts.inventorySuggestion() };
    } else if (imageMatch.match === 'none' || !imageMatchedProduct) {
      direct = { text: texts.imageNoMatch() };
    } else if (imageMatch.intent === 'inquiry' || imageMatch.intent === 'inventory_request') {
      const p = imageMatchedProduct;
      const price = money(Number(p.price), getProductCurrency(p.rawAttributes));
      const color = productColor(p.rawAttributes);
      direct = {
        text: imageMatch.match === 'exact' ? texts.imageExactMatch(p.name, price, color) : texts.imageSimilarMatch(p.name, price, color),
        product: p,
      };
    }

    if (direct) {
      const imageUrl = direct.product ? resolveProductImageUrl(direct.product) : undefined;
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          sender: 'AI',
          text: direct.text,
          imageUrl,
          meta: { model: 'image-match', latencyMs: 0, responseTokens: 0, promptTokens: 0, fallback: false, imageMatch } as any,
          pending: !isAutopilot,
        },
      });
      // Remember the offered product so a "yes" next turn continues with it — unless a
      // checkout/cancel step is in progress, which must not be overwritten.
      const canPinProduct = direct.product && (parsedAWQ.kind === 'none' || parsedAWQ.kind === 'ask_qty');
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date(), ...(canPinProduct ? { awaitingQuantityFor: direct.product!.sku } : {}) },
      });
      if (isAutopilot) await deliverAgentReply(conversation, direct.text, imageUrl);
      return;
    }
  }

  const orderState = {
    // Pass null to the model when in CONFIRM/DETAILS/CANCEL_PENDING so it doesn't think
    // we're still waiting for a plain quantity answer.
    awaitingQuantityFor:
      isConfirmState || isDetailsState || isCancelPendingState
        ? null
        : parsedAWQ.kind === 'ask_qty'
          ? parsedAWQ.sku
          : null,
    orderConfirmationRequested: currentConversation.orderConfirmationRequested,
    hasCartItems: existingCart.length > 0,
    hasAddress: !!storedContact.address,
    hasPhone: !!storedContact.phone,
    cartItems: existingCart.map((item) => ({
      sku: item.sku,
      name: products.find((p) => p.sku === item.sku)?.name || item.sku,
      quantity: item.quantity,
    })),
    pendingItem:
      isConfirmState && confirmDetailsValid && pendingProduct
        ? {
            sku: pendingEncodedSku!,
            name: pendingProduct.name,
            quantity: pendingEncodedQty,
            unitPrice: Number(pendingProduct.price),
            lineTotal: Number(pendingProduct.price) * pendingEncodedQty,
          }
        : undefined,
    awaitingContactDetails: isContactDetailsState,
    awaitingContactConfirmation: isContactConfirmState,
    contactOnFile: storedContact.phone || storedContact.address ? storedContact : undefined,
    pendingCancelOrders: pendingCancelOrders.map((o) => ({
      id: o.id,
      status: o.status === 'ON_THE_WAY' ? 'On the Way' : 'Processing',
      total: Number(o.total),
    })),
    ongoingOrders: conversationOrders.map((o) => ({
      id: o.id,
      items: ((o.items as any[]) || []).map((i) => ({ name: i.name, quantity: i.quantity, price: Number(i.price) })),
      status: o.status === 'ON_THE_WAY' ? 'On the Way' : 'Processing',
      createdAt: o.createdAt.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
      total: Number(o.total),
    })),
  };

  const pinnedCatalogSkus = new Set(existingCart.map((c) => c.sku));
  if (pendingEncodedSku) pinnedCatalogSkus.add(pendingEncodedSku);
  if (imageMatchedProduct) pinnedCatalogSkus.add(imageMatchedProduct.sku);
  const promptCatalog = selectRelevantCatalog(
    catalog,
    agentCustomerText,
    history.map((h) => h.text),
    pinnedCatalogSkus
  );

  const result = await generateAgentReply({ message: customerText, history, persona, catalog, promptCatalog, orderState, imageContext });
  // The customer asked about their photo: always show the matched catalog product's photo.
  if (imageMatchedProduct && !result.showImageForSku) result.showImageForSku = imageMatchedProduct.sku;
  // Orders the model asked to cancel, resolved by #REF against this conversation's active orders only.
  const requestedCancelOrders = conversationOrders.filter((o) => result.cancelOrderRefs.includes(orderRef(o.id)));
  const isAutopilot = conversation.status === 'AI_MANAGED';
  const autoFinalizeEligible = isAutopilot || !!store.autoFinalizeOrdersAlways;

  // Every server-side override of the model's reply goes through setReply. The final text
  // is written to the inbox message and delivered to the customer from the same variable,
  // so what the merchant sees in the Unified Inbox always matches what the customer got.
  const setReply = (text: string) => {
    result.replyText = text;
  };

  // CART-ADD INTERCEPTION: If the agent returned cartAction='add', redirect through the
  // confirmation-first flow after validating SKU/qty against this store's catalog.
  if (
    result.cartAction?.action === 'add' &&
    result.cartAction.sku &&
    !inCheckoutFlow &&
    !isCancelPendingState &&
    !currentConversation.orderConfirmationRequested
  ) {
    const requestedSku = result.cartAction.sku;
    const validated = validateSkuAndQuantity(products, requestedSku, result.cartAction.quantity);
    if (validated.ok) {
      const price = Number(validated.product.price);
      const total = price * validated.qty;
      const productCurrency = getProductCurrency(products.find((p) => p.sku === validated.sku)?.rawAttributes);
      setReply(texts.cartAddConfirm(validated.qty, validated.product.name, money(price, productCurrency), money(total, productCurrency)));
      result.cartAction = { action: 'none', sku: '', quantity: 0 };
      result.askQuantityForSku = encodeConfirm(validated.sku, validated.qty);
      result.orderConfirmationRequested = false;
      result.orderConfirmed = false;
      result.orderCancelled = false;
    } else {
      // Reject invalid LLM cartAction — never write cross-store or overselling qty.
      const failReason = (validated as { ok: false; reason: 'invalid_sku' | 'invalid_qty' | 'insufficient_inventory' }).reason;
      result.cartAction = { action: 'none', sku: '', quantity: 0 };
      if (failReason === 'insufficient_inventory') {
        const p = products.find((x) => x.sku === requestedSku);
        setReply(
          p
            ? texts.onlyAvailable(p.inventory, p.name, Math.min(p.inventory, MAX_CHECKOUT_QUANTITY))
            : texts.quantityUnavailable(),
        );
        if (p && p.inventory > 0) result.askQuantityForSku = p.sku;
      } else if (failReason === 'invalid_qty') {
        setReply(texts.quantityRange(MAX_CHECKOUT_QUANTITY));
      } else {
        setReply(texts.productNotFound());
        result.askQuantityForSku = '';
      }
    }
  }

  const imageProduct = result.showImageForSku ? products.find((p) => p.sku === result.showImageForSku) : undefined;
  let resolvedImageUrl = imageProduct ? resolveProductImageUrl(imageProduct) : undefined;

  // Captured by id (not by text) so every later correction below targets exactly this
  // message — matching by {conversationId, sender, text} instead would silently rewrite
  // every earlier AI message with the same (often boilerplate/repeated) text.
  const aiMessage = await prisma.message.create({
    data: { conversationId: conversation.id, sender: 'AI', text: result.replyText, imageUrl: resolvedImageUrl, meta: result as any, pending: !isAutopilot },
  });

  // Build the cart from the AI's detected intent — only ever adds a real, in-stock
  // catalog item, never invents one. This is separate from actually placing an order,
  // which either the merchant confirms explicitly (Generate Order) or the AI
  // auto-finalizes once the customer confirms, if the store allows it (see below).
  const conversationData: any = { lastMessageAt: new Date(), isComplaint: result.isComplaint || conversation.isComplaint };

  // Detect "start fresh" / "clear cart" / "remove everything" intent — reset cart and all order state.
  const lowerCustomerText = customerText.toLowerCase();
  const isStartFresh =
    lowerCustomerText.includes('start fresh') ||
    lowerCustomerText.includes('start over') ||
    lowerCustomerText.includes('clear cart') ||
    lowerCustomerText.includes('empty my cart') ||
    lowerCustomerText.includes('empty the cart') ||
    lowerCustomerText.includes('reset cart') ||
    lowerCustomerText.includes('shuru theke') ||
    lowerCustomerText.includes('cancel everything') ||
    lowerCustomerText.includes('remove everything') ||
    lowerCustomerText.includes('remove all') ||
    lowerCustomerText.includes('delete everything') ||
    lowerCustomerText.includes('shob delete') ||
    lowerCustomerText.includes('shob remove') ||
    lowerCustomerText.includes('naya shuru') ||
    lowerCustomerText.includes('notun kore');
  if (isStartFresh) {
    conversationData.cart = [];
    conversationData.awaitingQuantityFor = null;
    conversationData.detectedAddress = null;
    conversationData.detectedPhone = null;
    conversationData.orderConfirmationRequested = false;
    conversationData.orderConfirmed = false;
    conversationData.orderSummaryShown = false;
    await prisma.conversation.update({ where: { id: conversation.id }, data: conversationData });
    // The model's own reply (generated before this reset was detected) doesn't know the
    // cart/address/confirmation state just got wiped — replace it so the customer sees an
    // acknowledgment of the reset instead of a stale, unrelated reply.
    setReply(texts.startFresh());
    await prisma.message.update({ where: { id: aiMessage.id }, data: { text: result.replyText, imageUrl: null } });
    if (isAutopilot) await deliverAgentReply(conversation, result.replyText);
    return;
  }

  let updatedCart = existingCart;

  // SERVER-SIDE CART GUARD: legacy direct-cart-add paths only; checkout states write cart server-side.
  const cartAddQty = normalizeCheckoutQuantity(result.cartAction?.quantity);
  const cartAddAllowed =
    result.cartAction?.action === 'add' &&
    !!result.cartAction.sku &&
    cartAddQty !== null &&
    !inCheckoutFlow &&
    !isCancelPendingState &&
    (currentConversation.awaitingQuantityFor === result.cartAction.sku ||
      (currentConversation.awaitingQuantityFor === null && !currentConversation.orderConfirmationRequested));

  if (cartAddAllowed) {
    const validated = validateSkuAndQuantity(products, result.cartAction.sku, cartAddQty);
    if (validated.ok) {
      const existingItem = existingCart.find((item) => item.sku === validated.sku);
      updatedCart = existingItem
        ? existingCart.map((item) => (item.sku === validated.sku ? { ...item, quantity: validated.qty } : item))
        : [...existingCart, { sku: validated.sku, quantity: validated.qty }];
      conversationData.cart = updatedCart;
      conversationData.awaitingQuantityFor = null;
    }
  }

  // Never trust raw LLM askQuantityForSku — sanitize to catalog SKU or CONFIRM:SKU:QTY.
  const sanitizedAsk = sanitizeAskQuantityForSku(result.askQuantityForSku, products);
  if (sanitizedAsk) {
    conversationData.awaitingQuantityFor = sanitizedAsk;
  } else if (result.askQuantityForSku) {
    // Invalid LLM encoding — ignore transition.
    conversationData.awaitingQuantityFor = currentConversation.awaitingQuantityFor;
  }

  // Contact details shared this turn. Phone and address are always stored separately, even
  // if the model packed both into one field; while collecting details, a phone number typed
  // in the customer's own message is picked up even if the model missed it.
  // A plain "yes" to the confirmation can't carry new details — ignore any the model
  // re-captured from history, so the confirmed phone/address are exactly what was shown.
  const plainYesToContactConfirm = isContactConfirmState && isCheckoutAffirmative(customerText);
  const extractedContact = plainYesToContactConfirm
    ? { phone: '', address: '' }
    : splitContactDetails({ phone: result.extractedPhone, address: result.extractedAddress });
  if (!extractedContact.phone && inContactFlow) extractedContact.phone = extractPhone(customerText);
  if (extractedContact.phone) conversationData.detectedPhone = extractedContact.phone;
  if (extractedContact.address) conversationData.detectedAddress = extractedContact.address;
  const contact = {
    phone: extractedContact.phone || storedContact.phone,
    address: extractedContact.address || storedContact.address,
  };
  const sharedContactThisTurn = !!(extractedContact.phone || extractedContact.address);
  const contactChanged =
    (!!extractedContact.phone && extractedContact.phone !== storedContact.phone) ||
    (!!extractedContact.address && extractedContact.address !== storedContact.address);

  if (result.orderConfirmationRequested) {
    conversationData.orderConfirmationRequested = true;
    conversationData.orderSummaryShown = true;
  }

  // Only trust a customer's "yes" as a real confirmation if the AI actually asked for
  // one in a previous turn (legacy order-summary flow, outside the checkout state machine).
  const customerConfirmedForReal =
    result.orderConfirmed && currentConversation.orderConfirmationRequested && !inCheckoutFlow && !isCancelPendingState;
  if (customerConfirmedForReal) {
    conversationData.orderConfirmed = true;
  }

  // When the customer explicitly cancels a pending checkout confirmation, reset flags.
  const customerCancelledForReal = result.orderCancelled && currentConversation.orderConfirmationRequested;
  if (customerCancelledForReal) {
    conversationData.orderConfirmationRequested = false;
    conversationData.orderConfirmed = false;
  }

  // === H3: Ongoing order cancellation requires explicit confirmation ===
  // The model's cancel_order call (or a cancel keyword) only ever leads to a confirmation
  // question listing the exact orders; nothing is cancelled until the customer says yes.
  const describeOrders = (orders: typeof conversationOrders) =>
    orders
      .map((o) => {
        const items = ((o.items as any[]) || []).map((i: any) => `${i.quantity}x ${i.name}`).join(', ');
        return `• #${orderRef(o.id)} — ${items || '-'} (${money(Number(o.total))})`;
      })
      .join('\n');
  const askToCancel = (orders: typeof conversationOrders) => {
    conversationData.awaitingQuantityFor = encodeCancelPending(orders.map((o) => o.id));
    setReply(texts.cancelAsk(describeOrders(orders), orders.length));
    result.orderCancelled = false;
  };

  if (cancelPendingValid) {
    const sameOrders =
      requestedCancelOrders.length === pendingCancelOrders.length &&
      requestedCancelOrders.every((o) => pendingCancelOrders.some((p) => p.id === o.id));
    const declined = isCancelDeclineMessage(customerText) || (result.orderCancelled && requestedCancelOrders.length === 0) ||
      /^(?:no|na|naa|nah|nope|না)(?![\p{L}])/iu.test(customerText.trim());
    const agreed =
      !declined &&
      (isAffirmativeMessage(customerText) || isCheckoutAffirmative(customerText) || (result.orderConfirmed && !result.orderCancelled) || sameOrders);

    if (requestedCancelOrders.length > 0 && !sameOrders) {
      askToCancel(requestedCancelOrders);
    } else if (agreed) {
      const cancelled: string[] = [];
      try {
        await prisma.$transaction(async (tx) => {
          for (const order of pendingCancelOrders) {
            // Status predicate guards against double-cancel / cancelling a delivered order.
            const updated = await tx.order.updateMany({
              where: { id: order.id, storeId: conversation.storeId, conversationId: conversation.id, status: { in: ['PROCESSING', 'ON_THE_WAY'] } },
              data: { status: 'CANCELLED' },
            });
            if (updated.count !== 1) continue;
            for (const item of (order.items as any[]) || []) {
              const qty = Math.floor(Number(item.quantity));
              if (item.sku && Number.isFinite(qty) && qty > 0) {
                await tx.product.updateMany({
                  where: { storeId: order.storeId, sku: item.sku },
                  data: { inventory: { increment: qty } },
                });
              }
            }
            cancelled.push(`#${orderRef(order.id)}`);
          }
        });
        conversationData.awaitingQuantityFor = null;
        setReply(cancelled.length > 0 ? texts.cancelOk(cancelled) : texts.cancelFail());
      } catch {
        console.error('[ORDER CANCEL] Failed to cancel confirmed orders');
        conversationData.awaitingQuantityFor = encodeCancelPending(pendingCancelOrders.map((o) => o.id));
        setReply(texts.cancelFail());
      }
    } else if (declined) {
      conversationData.awaitingQuantityFor = null;
      setReply(texts.cancelKept(pendingCancelOrders.length));
    } else {
      // Stay in pending-cancel until a clear yes/no.
      conversationData.awaitingQuantityFor = encodeCancelPending(pendingCancelOrders.map((o) => o.id));
      if (result.replyText === DEFAULT_REPLY_TEXT) setReply(texts.cancelAsk(describeOrders(pendingCancelOrders), pendingCancelOrders.length));
    }
  } else if (
    !inCheckoutFlow &&
    !currentConversation.orderConfirmationRequested &&
    (requestedCancelOrders.length > 0 || result.cancelOrderRefs.length > 0 || isOngoingOrderCancelIntent(customerText))
  ) {
    // Model-requested orders when it named valid ones; otherwise the most recent active order.
    const ordersToAsk = requestedCancelOrders.length > 0 ? requestedCancelOrders : conversationOrders.slice(0, 1);
    if (ordersToAsk.length > 0) askToCancel(ordersToAsk);
    else {
      setReply(texts.noOrderToCancel());
      result.orderCancelled = false;
    }
  } else if (isCancelPendingState && !cancelPendingValid) {
    // Spoofed / foreign / unknown CANCEL_PENDING encoding — drop it.
    conversationData.awaitingQuantityFor = null;
  }

  // === CHECKOUT STATE MACHINE — server-validated only ===
  // CONFIRM (items) → CONTACT_DETAILS (collect phone + address) → CONTACT_CONFIRM (customer
  // re-confirms phone + address, even when they were already on file) → order.
  const cartSummary = (cart: { sku: string; quantity: number }[]) => {
    const lines = cart
      .map((line) => ({ line, product: products.find((p) => p.sku === line.sku) }))
      .filter((x) => !!x.product);
    if (lines.length === 0) return '';
    const total = lines.reduce((sum, x) => sum + Number(x.product!.price) * x.line.quantity, 0);
    return `${lines.map((x) => `${x.line.quantity}x ${x.product!.name}`).join(', ')} — ${money(total)}`;
  };
  const contactConfirmText = (cart: { sku: string; quantity: number }[]) => {
    return texts.contactConfirm(cartSummary(cart), contact.phone, contact.address);
  };
  const contactMissingText = () => {
    if (!contact.phone && !contact.address) return texts.askPhoneAndAddress();
    if (!contact.phone) return texts.askPhone(contact.address);
    if (!contact.address) return texts.askAddress(contact.phone);
    return texts.askCorrectContact();
  };
  const promptForContact = (cart: { sku: string; quantity: number }[]) => {
    if (contact.phone && contact.address) {
      conversationData.awaitingQuantityFor = CONTACT_CONFIRM_STATE;
      setReply(contactConfirmText(cart));
    } else {
      conversationData.awaitingQuantityFor = CONTACT_DETAILS_STATE;
      setReply(contactMissingText());
    }
  };
  const customerSaidYes = (result.orderConfirmed && !result.orderCancelled) || isCheckoutAffirmative(customerText);
  const customerSaidNo = result.orderCancelled || /^(?:no|na|naa|nah|nope|wrong|incorrect|vul|bhul|thik na|না|ভুল)(?![\p{L}])/iu.test(customerText.trim());
  let finalizeCart: { sku: string; quantity: number }[] | null = null;

  if (isConfirmState && confirmDetailsValid) {
    if (customerSaidYes && pendingEncodedSku && pendingEncodedQty > 0) {
      // Re-validate inventory at transition time.
      const recheck = validateSkuAndQuantity(products, pendingEncodedSku, pendingEncodedQty);
      if (recheck.ok) {
        conversationData.cart = [{ sku: recheck.sku, quantity: recheck.qty }];
        updatedCart = conversationData.cart;
        promptForContact(updatedCart);
      } else {
        const failReason = (recheck as { ok: false; reason: 'invalid_sku' | 'invalid_qty' | 'insufficient_inventory' }).reason;
        conversationData.awaitingQuantityFor = null;
        conversationData.cart = [];
        setReply(
          failReason === 'insufficient_inventory'
            ? texts.quantityNoLongerAvailable()
            : texts.checkoutContinueFailed(),
        );
      }
    } else if (result.orderCancelled) {
      conversationData.awaitingQuantityFor = null;
      conversationData.cart = [];
    } else {
      conversationData.awaitingQuantityFor = encodeConfirm(pendingEncodedSku!, pendingEncodedQty);
    }
  } else if (inContactFlow) {
    conversationData.cart = contactFlowCart;
    updatedCart = contactFlowCart;
    if (isCheckoutCancelIntent(customerText) && !sharedContactThisTurn) {
      conversationData.awaitingQuantityFor = null;
      conversationData.cart = [];
      conversationData.orderConfirmationRequested = false;
      setReply(texts.checkoutCancelled());
    } else if (isContactDetailsState) {
      if (contact.phone && contact.address && (sharedContactThisTurn || customerSaidYes)) {
        conversationData.awaitingQuantityFor = CONTACT_CONFIRM_STATE;
        setReply(contactConfirmText(contactFlowCart));
      } else {
        conversationData.awaitingQuantityFor = CONTACT_DETAILS_STATE;
        if (sharedContactThisTurn || result.replyText === DEFAULT_REPLY_TEXT) setReply(contactMissingText());
      }
    } else if (contactChanged) {
      promptForContact(contactFlowCart);
    } else if (customerSaidYes) {
      if (contact.phone && contact.address) finalizeCart = contactFlowCart;
      else promptForContact(contactFlowCart);
    } else if (customerSaidNo) {
      conversationData.awaitingQuantityFor = CONTACT_DETAILS_STATE;
      setReply(texts.askCorrectContact());
    } else {
      conversationData.awaitingQuantityFor = CONTACT_CONFIRM_STATE;
      if (result.replyText === DEFAULT_REPLY_TEXT) setReply(contactConfirmText(contactFlowCart));
    }
  } else if ((isConfirmState || isDetailsState) && !confirmDetailsValid) {
    // Corrupt encoded state — clear rather than acting on it.
    conversationData.awaitingQuantityFor = null;
  } else if (parsedAWQ.kind === 'contact_details' || parsedAWQ.kind === 'contact_confirm') {
    // Contact step with an empty cart (e.g. merchant cleared it) — nothing left to order.
    conversationData.awaitingQuantityFor = null;
  } else if (customerConfirmedForReal && updatedCart.length > 0) {
    // Legacy order-summary confirmation — still route through phone/address confirmation.
    conversationData.orderConfirmationRequested = false;
    promptForContact(updatedCart);
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: conversationData,
  });

  // Auto-finalize (H1): only after the customer re-confirmed phone + address. Creates a real
  // Order only when the merchant is eligible (AI Managed, or autoFinalizeOrdersAlways).
  // Otherwise preserve cart + contact details for the merchant "Generate Order" workflow.
  if (finalizeCart) {
    const cartValid =
      finalizeCart.length > 0 &&
      finalizeCart.every((line) => validateSkuAndQuantity(products, line.sku, line.quantity).ok);

    if (!cartValid) {
      setReply(texts.orderInvalidItems());
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { awaitingQuantityFor: null },
      });
    } else if (!autoFinalizeEligible) {
      // H1: not eligible — keep cart/contact for merchant review; do not create Order / decrement stock.
      setReply(texts.savedForMerchant(contact.phone, contact.address));
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          cart: finalizeCart,
          detectedAddress: contact.address,
          detectedPhone: contact.phone,
          awaitingQuantityFor: null,
          orderConfirmed: true,
          orderConfirmationRequested: false,
        },
      });
    } else {
      try {
        await createOrderForConversation(
          { id: conversation.id, storeId: conversation.storeId, customerName: currentConversation.customerName },
          finalizeCart,
          contact,
        );
        setReply(texts.orderPlaced(contact.phone, contact.address));
      } catch (err: any) {
        console.error('Auto-finalize order failed for conversation:', conversation.id);
        if (err?.code === 'INSUFFICIENT_STOCK') {
          setReply(texts.outOfStock());
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { awaitingQuantityFor: null },
          });
        } else {
          setReply(texts.orderPlaceError());
        }
      }
    }
  }

  // A server-side override replaced the model's reply — the product photo it chose no
  // longer belongs with this text, so it isn't sent or shown either.
  if (result.replyText !== aiMessage.text) {
    resolvedImageUrl = undefined;
    await prisma.message.update({
      where: { id: aiMessage.id },
      data: { text: result.replyText, imageUrl: resolvedImageUrl ?? null },
    });
  }

  if (isAutopilot) await deliverAgentReply(conversation, result.replyText, resolvedImageUrl);
}

// Pushes a finalized AI reply out to the customer's channel. Channels with no push API
// (WIDGET) simply don't match any branch.
async function deliverAgentReply(
  conversation: { storeId: string; channelType: string; externalUserId: string | null },
  text: string,
  imageUrl?: string,
) {
  if (!conversation.externalUserId) return;
  if (await deliverChannelMessage(conversation, text, imageUrl)) return;

  if (conversation.channelType === 'FACEBOOK') {
    const pageAccessToken = await getPageAccessTokenForStore(conversation.storeId);
    if (pageAccessToken) {
      try {
        await sendMessengerMessage(pageAccessToken, conversation.externalUserId, text);
        if (imageUrl) await sendMessengerImage(pageAccessToken, conversation.externalUserId, imageUrl);
      } catch (err) {
        console.error('Failed to deliver AI reply to Messenger:', err);
      }
    }
  }

  if (conversation.channelType === 'WHATSAPP') {
    const waCreds = await getWhatsAppCredentialsForStore(conversation.storeId);
    if (waCreds) {
      try {
        await sendWhatsAppMessage(waCreds.phoneNumberId, waCreds.accessToken, conversation.externalUserId, text);
        if (imageUrl) await sendWhatsAppImage(waCreds.phoneNumberId, waCreds.accessToken, conversation.externalUserId, imageUrl);
      } catch (err) {
        console.error('Failed to deliver AI reply to WhatsApp:', err);
      }
    }
  }

  if (conversation.channelType === 'INSTAGRAM') {
    const igCreds = await getInstagramCredentialsForStore(conversation.storeId);
    if (igCreds) {
      try {
        await sendInstagramMessage(igCreds.igAccountId, igCreds.accessToken, conversation.externalUserId, text);
        if (imageUrl) await sendInstagramImage(igCreds.igAccountId, igCreds.accessToken, conversation.externalUserId, imageUrl);
      } catch (err) {
        console.error('Failed to deliver AI reply to Instagram:', err);
      }
    }
  }
}

// Sends the merchant's configured opening greeting (text + optional image) the very
// first time a customer messages the business on a real channel — fires once per brand
// new Conversation, and stands in for the AI's reply on that first message (the caller
// skips generateAndStoreAgentReply when this returns true) so the customer doesn't get
// two back-to-back greeting-shaped messages on their very first "hello."
export async function sendOpeningGreetingIfNew(
  isNewConversation: boolean,
  conversation: { id: string; storeId: string; status: string; channelType: string; externalUserId: string | null }
): Promise<boolean> {
  if (!isNewConversation) return false;
  const store = await prisma.store.findUnique({ where: { id: conversation.storeId } });
  if (!store || !store.openingText) return false;

  const isAutopilot = conversation.status === 'AI_MANAGED';
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      sender: 'AI',
      text: store.openingText,
      imageUrl: store.openingImageUrl || undefined,
      pending: !isAutopilot,
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  if (!isAutopilot || !conversation.externalUserId) return true;
  try {
    if (await deliverChannelMessage(conversation, store.openingText, store.openingImageUrl || undefined)) return true;
    if (conversation.channelType === 'FACEBOOK') {
      const pageAccessToken = await getPageAccessTokenForStore(conversation.storeId);
      if (pageAccessToken) {
        await sendMessengerMessage(pageAccessToken, conversation.externalUserId, store.openingText);
        if (store.openingImageUrl) await sendMessengerImage(pageAccessToken, conversation.externalUserId, store.openingImageUrl);
      }
    } else if (conversation.channelType === 'WHATSAPP') {
      const waCreds = await getWhatsAppCredentialsForStore(conversation.storeId);
      if (waCreds) {
        await sendWhatsAppMessage(waCreds.phoneNumberId, waCreds.accessToken, conversation.externalUserId, store.openingText);
        if (store.openingImageUrl) await sendWhatsAppImage(waCreds.phoneNumberId, waCreds.accessToken, conversation.externalUserId, store.openingImageUrl);
      }
    } else if (conversation.channelType === 'INSTAGRAM') {
      const igCreds = await getInstagramCredentialsForStore(conversation.storeId);
      if (igCreds) {
        await sendInstagramMessage(igCreds.igAccountId, igCreds.accessToken, conversation.externalUserId, store.openingText);
        if (store.openingImageUrl) await sendInstagramImage(igCreds.igAccountId, igCreds.accessToken, conversation.externalUserId, store.openingImageUrl);
      }
    }
  } catch (err) {
    console.error(`Failed to deliver opening greeting to ${conversation.channelType}:`, err);
  }
  return true;
}
