export type Tab =
  | 'landing'
  | 'login'
  | 'signup'
  | 'onboarding'
  | 'inbox'
  | 'catalog'
  | 'persona'
  | 'orders'
  | 'bookings'
  | 'analytics'
  | 'integrations'
  | 'settings'
  | 'support'
  | 'admin';

export interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  inventory: number;
  status: 'Trained' | 'Pending';
  description?: string;
  imageUrl?: string;
  imageSource?: 'stored' | 'attribute';
  rawAttributes?: Record<string, any>;
}

export interface ChatMessage {
  id: string;
  sender: 'customer' | 'ai' | 'merchant';
  text: string;
  time: string;
  isImage?: boolean;
  imageUrl?: string;
  audioUrl?: string;
  transcript?: string;
  mediaType?: string;
  pending?: boolean;
}

export interface Conversation {
  id: string;
  customerName: string;
  avatarUrl?: string;
  platform: 'facebook' | 'instagram' | 'whatsapp' | 'websocket';
  lastMessage: string;
  time: string;
  unread: boolean;
  status: 'Active' | 'AI Managed' | 'Closed';
  messages: ChatMessage[];
  lastProductViewed?: string;
  isComplaint?: boolean;
  isArchived?: boolean;
  isSpam?: boolean;
  cart?: { sku: string; quantity: number }[];
  detectedAddress?: string;
  detectedPhone?: string;
  orderConfirmed?: boolean;
  orderConfirmationRequested?: boolean;
  suggestedProducts?: string[];
}

export interface Integration {
  id: string;
  name: string;
  description: string;
  connected: boolean;
  statusText: string;
  hasAction: boolean;
  actionText?: string;
  logoType: 'facebook' | 'instagram' | 'whatsapp' | 'shopify' | 'woocommerce' | 'websocket';
}

export interface AIPersona {
  tone: string;
  style: 'bullets' | 'narrative';
  customInstructions: string;
  autoFinalizeOrdersAlways?: boolean;
  openingText?: string;
  openingImageUrl?: string;
  shareBusinessInfo: boolean;
  businessInfo: {
    businessPhone: string | null;
    businessType: string | null;
    website: string | null;
    streetAddress: string | null;
    city: string | null;
    country: string | null;
  };
}

export interface DailyMetric {
  date: string;
  conversations: number;
  convertedSales: number;
}

export interface RecentActivity {
  id: string;
  type: 'checkout' | 'inquiry' | 'alert';
  orderId?: string;
  time: string;
  title: string;
  description: string;
  badge?: string;
  price?: number;
  productName?: string;
}
