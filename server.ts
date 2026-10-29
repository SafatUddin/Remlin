import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { MulterError } from 'multer';
import { prisma } from './server/db';
import {
  requireAuth,
  AuthedRequest,
  signState,
  verifyState,
  isPasswordStrongEnough,
  establishMerchantSession,
  clearSessionCookie,
  requireTrustedOrigin,
} from './server/auth';
import { ai } from './server/gemini';
import { generateAgentReply, isQuestionOrPriceInquiry } from './server/agent';
import {
  verifyMetaSignature,
  sendMessengerMessage,
  sendMessengerImage,
  sendWhatsAppMessage,
  sendWhatsAppImage,
  sendInstagramMessage,
  sendInstagramImage,
  fetchMessengerProfile,
  fetchInstagramProfile,
  replyToFacebookComment,
  sendFacebookPrivateReply,
  replyToInstagramComment,
  sendInstagramPrivateReply,
  getFacebookOAuthUrl,
  exchangeCodeForUserToken,
  listManagedPages,
  listWhatsAppPhoneNumbers,
  subscribePageWebhook,
  ManagedPage,
} from './server/meta';
import { encryptSecret, decryptSecret } from './server/crypto';
import { buildGoogleAuthUrl, exchangeCodeForProfile } from './server/google';
import { verifyShopifyStore, fetchShopifyProducts, getShopifyOAuthUrl, verifyShopifyCallbackHmac, exchangeShopifyCodeForToken } from './server/shopify';
import { verifyWooCommerceStore, fetchWooCommerceProducts, normalizeWooUrl } from './server/woocommerce';
import {
  parseAwaitingQuantityFor,
  sanitizeAskQuantityForSku,
  validateSkuAndQuantity,
  encodeConfirm,
  encodeDetails,
  encodeCancelPending,
  isAffirmativeMessage,
  isCancelDeclineMessage,
  isOngoingOrderCancelIntent,
  normalizeCheckoutQuantity,
  MAX_CHECKOUT_QUANTITY,
} from './server/checkoutSecurity';
import {
  createOAuthHandoff,
  consumeOAuthHandoff,
  peekOAuthHandoff,
  OAuthHandoffError,
  purgeExpiredOAuthHandoffs,
} from './server/oauthHandoff';
import {
  assertChannelExternalIdAvailable,
  resolveConnectedChannelByExternalId,
  ChannelOwnershipError,
  isChannelOwnershipError,
  isUniqueConstraintError,
  CHANNEL_ALREADY_CONNECTED_MESSAGE,
} from './server/channelSecurity';
import { claimWebhookEvent } from './server/webhookIdempotency';
import {
  JSON_BODY_LIMIT,
  validateProductInput,
  sanitizeCartInput,
  validateCartSkusInStore,
  conversationPatchHasOnlyAllowedKeys,
  validatePersonaInput,
  validateStoreBusinessInput,
  validatePhone,
  validateMerchantName,
  validateOnboardingInput,
} from './server/inputValidation';
import {
  getProfileCompletionStatus,
  requireProfileComplete,
} from './server/profileCompletion';
import {
  avatarUpload,
  saveAvatarFile,
  deleteLocalAvatarFile,
  isLocalAvatarUrl,
  MAX_AVATAR_BYTES,
  productImageUpload,
  saveProductImageFile,
  deleteProductImageFile,
  MAX_PRODUCT_IMAGE_BYTES,
  openingImageUpload,
  saveOpeningImageFile,
  deleteOpeningImageFile,
  MAX_OPENING_IMAGE_BYTES,
  ensureStorageBuckets,
} from './server/mediaStorage';
import { authLimiter, aiLimiter, widgetLimiter } from './server/rateLimiters';
import {
  CHANNEL_TYPE_TO_FRONTEND,
  CHANNEL_TO_PLATFORM,
  STATUS_TO_FRONTEND,
  FRONTEND_TO_STATUS,
  SENDER_TO_FRONTEND,
  toPublicMerchant,
  toPublicStore,
  toPublicConversation,
  toPublicWidgetConversation,
} from './server/publicViews';
import { createOrderForConversation } from './server/orderCreation';
import { createLegalRouter } from './server/routes/legal';
import { createWidgetRouter } from './server/routes/widget';
import type { RequestWithRawBody } from './server/types';
import { createWebhooksRouter } from './server/routes/webhooks';
import { createAnalyticsRouter } from './server/routes/analytics';
import { createPersonaRouter } from './server/routes/persona';
import { createProductsRouter } from './server/routes/products';
import { createOrdersRouter } from './server/routes/orders';
import { createConversationsRouter } from './server/routes/conversations';
import { createProfileRouter } from './server/routes/profile';
import { createAuthRouter } from './server/routes/auth';
import { createChannelsRouter } from './server/routes/channels';
import { createLocalChannelsRouter } from './server/routes/localChannels';
import { startChannelAdapters } from './server/channels';
import { createAdminRouter } from './server/routes/admin';
import { createKnowledgeRouter } from './server/routes/knowledge';
import { createAppointmentsRouter } from './server/routes/appointments';
import {
  getPageAccessTokenForStore,
  getWhatsAppCredentialsForStore,
  getInstagramCredentialsForStore,
  selectRelevantCatalog,
  generateAndStoreAgentReply,
  sendOpeningGreetingIfNew,
} from './server/conversationEngine';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();

  // Needed so express-rate-limit sees the real client IP behind Railway/other reverse proxies.
  app.set('trust proxy', 1);

  // Security headers. CSP is left off: a strict policy would break the Vite/React SPA,
  // inline styles, and third-party OAuth/asset flows until a full allowlist is designed.
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  // Helmet's default Cross-Origin-Resource-Policy: same-origin would make browsers block
  // widget.js (and its API calls) from loading on any business's own website — the widget's
  // entire purpose. Override it back to cross-origin for exactly the paths that need it.
  app.use((req, res, next) => {
    if (req.path === '/widget.js' || req.path.startsWith('/api/widget/')) {
      res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    next();
  });


  app.use(express.json({
    limit: JSON_BODY_LIMIT,
    verify: (req: RequestWithRawBody, _res, buf) => {
      req.rawBody = buf;
    },
  }));

  // Cookie session CSRF: validate Origin/Referer on state-changing merchant API requests.
  app.use(requireTrustedOrigin);

  const PORT = Number(process.env.PORT) || 3000;

  // Route modules extracted out of this file — see server/routes/*.ts. Each is a
  // self-contained feature area with its own Router, mounted here.
  app.use(createLegalRouter());
  app.use(createWidgetRouter());
  app.use(createWebhooksRouter());
  app.use(createAnalyticsRouter());
  app.use(createPersonaRouter());
  app.use(createProductsRouter());
  app.use(createOrdersRouter());
  app.use(createConversationsRouter());
  app.use(createProfileRouter());
  app.use(createAuthRouter());
  app.use(createLocalChannelsRouter());
  app.use(createChannelsRouter());
  app.use(createAdminRouter());
  app.use(createKnowledgeRouter());
  app.use(createAppointmentsRouter());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', geminiActive: !!ai });
  });


  // Serve public folder for static assets
  const publicPath = path.join(process.cwd(), 'public');
  app.use('/assets', express.static(path.join(publicPath, 'assets')));

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global error handler — catches errors passed via next(err) that no route's own
  // try/catch handled, most notably Multer's upload rejections (oversized file, wrong
  // MIME type), which otherwise bypass every route's JSON error contract and fall
  // through to Express's default HTML error page.
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    if (err instanceof MulterError) {
      const maxBytes = req.path.includes('/products/')
        ? MAX_PRODUCT_IMAGE_BYTES
        : req.path.includes('/persona/')
          ? MAX_OPENING_IMAGE_BYTES
          : MAX_AVATAR_BYTES;
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Image must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller`
          : 'Invalid file upload';
      return res.status(400).json({ error: message });
    }
    if (err?.message === 'Only image files are accepted') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Unhandled request error:', err?.message);
    res.status(500).json({ error: 'Something went wrong' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    void ensureStorageBuckets().catch((err) => console.error('[storage] bucket check failed:', err?.message));
    void startChannelAdapters().catch((err) => console.error('Channel adapters failed to start:', err?.message));
  });
}

startServer();
