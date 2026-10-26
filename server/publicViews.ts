// Shared response-shaping helpers used across multiple route modules — kept together
// so a frontend-facing field (e.g. a Conversation's `platform` string) only has one
// place to change, rather than being duplicated per route file.

export const CHANNEL_TO_PLATFORM: Record<string, string> = {
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  WHATSAPP: 'whatsapp',
  WIDGET: 'websocket',
};

export const STATUS_TO_FRONTEND: Record<string, string> = {
  AI_MANAGED: 'AI Managed',
  ACTIVE: 'Active',
  CLOSED: 'Closed',
};

export const FRONTEND_TO_STATUS: Record<string, string> = {
  'AI Managed': 'AI_MANAGED',
  'Active': 'ACTIVE',
  'Closed': 'CLOSED',
};

export const SENDER_TO_FRONTEND: Record<string, string> = {
  CUSTOMER: 'customer',
  AI: 'ai',
  MERCHANT: 'merchant',
};

// Also used by the widget/channels-connect flow to map a Channel.type enum value to
// the frontend's lowercase channel identifier (distinct from CHANNEL_TO_PLATFORM, which
// maps a Conversation's channelType to the chat-platform label shown in the Inbox).
export const CHANNEL_TYPE_TO_FRONTEND: Record<string, string> = {
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  WHATSAPP: 'whatsapp',
  WIDGET: 'websocket',
  SHOPIFY: 'shopify',
  WOOCOMMERCE: 'woocommerce',
};

export function toPublicMerchant(merchant: {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  avatarUrl: string | null;
}) {
  return {
    id: merchant.id,
    name: merchant.name,
    email: merchant.email,
    phone: merchant.phone ?? null,
    avatarUrl: merchant.avatarUrl,
  };
}

export function toPublicStore(store: {
  id: string;
  name: string;
  businessPhone?: string | null;
  businessType?: string | null;
  website?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  country?: string | null;
}) {
  return {
    id: store.id,
    name: store.name,
    businessPhone: store.businessPhone ?? null,
    businessType: store.businessType ?? null,
    website: store.website ?? null,
    streetAddress: store.streetAddress ?? null,
    city: store.city ?? null,
    country: store.country ?? null,
  };
}

export function toPublicConversation(c: any) {
  const messages = c.messages.map((m: any) => ({
    id: m.id,
    sender: SENDER_TO_FRONTEND[m.sender] || 'customer',
    text: m.text,
    imageUrl: m.imageUrl || undefined,
    audioUrl: m.audioUrl || undefined,
    transcript: m.transcript || undefined,
    mediaType: m.mediaType || undefined,
    time: m.createdAt.toISOString(), // Send full ISO timestamp so frontend can format and detect day changes
    pending: !!m.pending,
  }));
  const last = messages[messages.length - 1];
  return {
    id: c.id,
    customerName: c.customerName || 'New Customer',
    avatarUrl: c.avatarUrl || undefined,
    platform: CHANNEL_TO_PLATFORM[c.channelType] || 'websocket',
    lastMessage: last?.imageUrl && last.text?.trim() === 'Customer sent an image.' ? 'Sent a photo' : last?.text || '',
    time: last?.time || '',
    unread: !!last && last.sender === 'customer',
    status: STATUS_TO_FRONTEND[c.status] || 'AI Managed',
    messages,
    isComplaint: c.isComplaint,
    isArchived: !!c.isArchived,
    isSpam: !!c.isSpam,
    cart: c.cart || undefined,
    detectedAddress: c.detectedAddress || undefined,
    detectedPhone: c.detectedPhone || undefined,
    orderConfirmed: !!c.orderConfirmed,
    orderConfirmationRequested: !!c.orderConfirmationRequested,
  };
}

// Unlike the merchant Inbox (which must show pending AI drafts awaiting approval),
// the customer-facing widget must never show a message that hasn't actually been
// approved/sent yet — so pending drafts are stripped before toPublicConversation runs.
export function toPublicWidgetConversation(c: any) {
  return toPublicConversation({ ...c, messages: c.messages.filter((m: any) => !m.pending) });
}
