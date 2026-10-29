import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Facebook,
  Instagram,
  MessageSquare,
  ShoppingBag,
  RefreshCw,
  CheckCircle2,
  Database,
  ShieldCheck,
  Check,
  Lock,
  Globe,
  X,
  ChevronRight,
  FileSpreadsheet,
  Upload,
  Code2,
  Copy,
} from 'lucide-react';
import { Integration } from '../types';
import { CURRENCY_ATTRIBUTE_KEY, detectCurrencyInHeader, detectCurrencyInText, isCurrencyKey } from '../../shared/currency';
import { detectCatalogColumns } from '../../shared/catalogColumns';
import {
  listChannels,
  disconnectChannel,
  getFacebookConnectUrl,
  getFacebookPendingPages,
  selectFacebookPage,
  FacebookPendingPage,
  getWhatsAppPendingNumbers,
  selectWhatsAppNumber,
  WhatsAppPendingNumber,
  connectWhatsAppChannel,
  connectWidgetChannel,
  connectShopifyChannel,
  syncShopifyChannel,
  getShopifyConnectUrl,
  connectWooCommerceChannel,
  syncWooCommerceChannel,
  getCatalogSource,
  setCatalogSource,
  CatalogSource,
  createProductsBulk,
  BulkProductInput,
} from '../lib/api';
import { WhatsAppQrModal } from './LocalChannelConnect';
import DashboardHeader from './DashboardHeader';
import { readSpreadsheet } from '../lib/spreadsheet';

const IMPORT_BATCH_SIZE = 250;
const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;

// "1,200.50" → 1200.5, "12,50" / "1.234,56" (comma decimals) → 12.5 / 1234.56, "৳ 999" → 999
function parseAmount(text: string): number {
  let value = text.replace(/[^0-9.,]/g, '');
  value = /,\d{1,2}$/.test(value) && !/\.\d{1,2}$/.test(value)
    ? value.replace(/\./g, '').replace(',', '.')
    : value.replace(/,/g, '');
  return parseFloat(value) || 0;
}

type CatalogLoadedInfo = { source: string; total: number; created?: number; updated?: number; skipped?: number };

interface IntegrationsHubProps {
  integrations: Integration[];
  onToggleConnection: (id: string) => void;
  onRefreshAll: () => Promise<void>;
  onReloadProducts: () => Promise<void>;
  onGoToCatalog: () => void;
}

export default function IntegrationsHub({ integrations, onToggleConnection, onRefreshAll, onReloadProducts, onGoToCatalog }: IntegrationsHubProps) {
  const [searchTerm, setSearchTerm] = useState('');
  // "Products loaded" confirmation shown after a catalog connector / file import finishes
  const [catalogLoaded, setCatalogLoaded] = useState<CatalogLoadedInfo | null>(null);

  const announceCatalogLoaded = async (info: CatalogLoadedInfo) => {
    try {
      await onReloadProducts();
    } catch (err) {
      console.error('Failed to reload products:', err);
    }
    setCatalogLoaded(info);
  };
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [catalogSource, setCatalogSourceState] = useState<CatalogSource>('CUSTOM');
  const [catalogSourceError, setCatalogSourceError] = useState('');

  // Setup Wizard states
  const [activeWizardId, setActiveWizardId] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [isSimulatingSync, setIsSimulatingSync] = useState(false);

  // WhatsApp connects by scanning a QR code (linked device)
  const [showWhatsAppQr, setShowWhatsAppQr] = useState(false);

  // Real Facebook, Instagram & WhatsApp connection state
  const [fbConnected, setFbConnected] = useState(false);
  const [fbPageName, setFbPageName] = useState<string | null>(null);
  const [fbPendingToken, setFbPendingToken] = useState<string | null>(null);
  const [fbPendingPages, setFbPendingPages] = useState<FacebookPendingPage[]>([]);
  const [fbError, setFbError] = useState('');
  const [isSelectingPage, setIsSelectingPage] = useState(false);

  const [igConnected, setIgConnected] = useState(false);
  const [igAccountName, setIgAccountName] = useState<string | null>(null);

  const [waConnected, setWaConnected] = useState(false);
  const [waPhoneName, setWaPhoneName] = useState<string | null>(null);
  const [waPhoneNumberId, setWaPhoneNumberId] = useState('');
  const [waAccessToken, setWaAccessToken] = useState('');
  const [waError, setWaError] = useState('');
  const [isConnectingWa, setIsConnectingWa] = useState(false);
  const [waPendingToken, setWaPendingToken] = useState<string | null>(null);
  const [waPendingNumbers, setWaPendingNumbers] = useState<WhatsAppPendingNumber[]>([]);
  const [isSelectingWa, setIsSelectingWa] = useState(false);

  // Real website widget connection state
  const [widgetConnected, setWidgetConnected] = useState(false);
  const [widgetKey, setWidgetKey] = useState<string | null>(null);
  const [widgetError, setWidgetError] = useState('');
  const [isConnectingWidget, setIsConnectingWidget] = useState(false);
  const [widgetCodeCopied, setWidgetCodeCopied] = useState(false);

  // Real Shopify connection state
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyStoreName, setShopifyStoreName] = useState<string | null>(null);
  const [shopifyAccessToken, setShopifyAccessToken] = useState('');
  const [shopifyError, setShopifyError] = useState('');
  const [isConnectingShopify, setIsConnectingShopify] = useState(false);
  const [isSyncingShopify, setIsSyncingShopify] = useState(false);
  const [shopifySyncResult, setShopifySyncResult] = useState<{ created: number; updated: number; total: number } | null>(null);
  // Excel/CSV Catalog Upload state
  const [uploadStep, setUploadStep] = useState<'closed' | 'select' | 'importing'>('closed');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [importProgress, setImportProgress] = useState({ total: 0, processed: 0, created: 0 });
  const [excelErrorMsg, setExcelErrorMsg] = useState('');
  const uploadInputRef = React.useRef<HTMLInputElement>(null);

  const openUploadDialog = () => {
    setUploadFile(null);
    setUploadError('');
    setExcelErrorMsg('');
    setUploadStep('select');
  };

  // Turns sheet rows (first row = headers) into catalog products
  const rowsToProducts = (rows: string[][]): BulkProductInput[] => {
    const [headers, ...dataRows] = rows;
    // Map headers to core fields once, by whole-word priority (e.g. "product_name" → name, "product_id" → SKU)
    const columns = detectCatalogColumns(headers, isCurrencyKey);
    const coreHeaders = new Set(Object.values(columns));
    const importStamp = Date.now();

    return dataRows.map((values, rowIndex) => {
      const i = rowIndex + 1;
      const rowMap: Record<string, string> = {};
      headers.forEach((h, idx) => {
        if (h && values[idx] !== undefined && values[idx] !== '') {
          rowMap[h] = values[idx];
        }
      });
      const valueOf = (header?: string) => (header ? rowMap[header] : undefined);

      const sku = valueOf(columns.sku) || `SKU-${i}-${importStamp}`;
      // Fallback name: first non-core text column that isn't a number or a link
      const fallbackName = headers.find((h) => !coreHeaders.has(h) && rowMap[h] && !/^[\d\s.,-]+$/.test(rowMap[h]) && !/^https?:\/\//i.test(rowMap[h]));
      const name = valueOf(columns.name) || (fallbackName && rowMap[fallbackName]) || `Product ${i}`;
      const priceKey = columns.price;
      const priceStr = valueOf(priceKey) || '0';
      const hasCurrencyColumn = Object.keys(rowMap).some(isCurrencyKey);
      const detectedCurrency = hasCurrencyColumn || !priceKey
        ? undefined
        : detectCurrencyInText(priceStr) || detectCurrencyInHeader(priceKey);
      const price = parseAmount(priceStr);
      const invStr = valueOf(columns.inventory) || '0';
      const inventory = parseInt(invStr.replace(/[^0-9]/g, '')) || 0;
      const description = valueOf(columns.description) || undefined;

      // Collect all remaining (non-core) columns into dynamic rawAttributes
      const rawAttributes: Record<string, any> = {};
      headers.forEach((h, idx) => {
        const val = values[idx];
        if (h && val !== undefined && val !== '' && !coreHeaders.has(h)) {
          rawAttributes[h] = val;
        }
      });
      if (detectedCurrency) rawAttributes[CURRENCY_ATTRIBUTE_KEY] = detectedCurrency;

      return {
        name: name.slice(0, 200),
        sku: sku.slice(0, 100),
        price,
        inventory,
        description: description?.slice(0, 5000),
        rawAttributes: Object.keys(rawAttributes).length > 0 ? rawAttributes : undefined,
        status: 'Trained' as const,
      };
    });
  };

  const handleImportConfirm = async () => {
    const file = uploadFile;
    if (!file) return;
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setUploadError('This file is larger than 20 MB. Split it into smaller files and upload them one by one.');
      return;
    }
    setUploadError('');
    setImportProgress({ total: 0, processed: 0, created: 0 });
    setUploadStep('importing');

    try {
      if (catalogSource === 'CUSTOM') {
        const result = await setCatalogSource('CSV');
        setCatalogSourceState(result.catalogSource);
      }

      const rows = await readSpreadsheet(file);
      if (rows.length < 2) throw new Error('The file has no product rows under the header row.');
      const products = rowsToProducts(rows);
      setImportProgress({ total: products.length, processed: 0, created: 0 });

      // Send in batches so the progress counter moves and each request stays small
      let processed = 0;
      let created = 0;
      let skipped = 0;
      for (let start = 0; start < products.length; start += IMPORT_BATCH_SIZE) {
        const batch = products.slice(start, start + IMPORT_BATCH_SIZE);
        const result = await createProductsBulk(batch, 'CSV');
        processed += batch.length;
        created += result.created;
        skipped += result.skipped + result.invalid;
        setImportProgress({ total: products.length, processed, created });
      }

      await onRefreshAll();
      setUploadStep('closed');
      if (created > 0) {
        await announceCatalogLoaded({ source: file.name, total: created, created, skipped });
      } else {
        setExcelErrorMsg(`No new products were imported from ${file.name} — ${skipped} row(s) already exist or were invalid.`);
      }
    } catch (err: any) {
      setUploadError(err.message || 'Failed to import the product file.');
      setUploadStep('select');
    }
  };

  // Real WooCommerce connection state
  const [wooConnected, setWooConnected] = useState(false);
  const [wooStoreName, setWooStoreName] = useState<string | null>(null);
  const [wooUrl, setWooUrl] = useState('');
  const [wooConsumerKey, setWooConsumerKey] = useState('');
  const [wooConsumerSecret, setWooConsumerSecret] = useState('');
  const [wooError, setWooError] = useState('');
  const [isConnectingWoo, setIsConnectingWoo] = useState(false);
  const [isSyncingWoo, setIsSyncingWoo] = useState(false);
  const [wooSyncResult, setWooSyncResult] = useState<{ created: number; updated: number; total: number } | null>(null);

  const refreshChannelsStatus = () => {
    getCatalogSource()
      .then((result) => setCatalogSourceState(result.catalogSource))
      .catch((err) => console.error('Failed to load catalog source:', err));
    listChannels()
      .then((channels) => {
        const facebook = channels.find((c) => c.type === 'facebook');
        setFbConnected(!!facebook?.connected);
        setFbPageName(facebook?.name || null);

        const instagram = channels.find((c) => c.type === 'instagram');
        setIgConnected(!!instagram?.connected);
        setIgAccountName(instagram?.name || null);

        const whatsapp = channels.find((c) => c.type === 'whatsapp');
        setWaConnected(!!whatsapp?.connected);
        setWaPhoneName(whatsapp?.name || null);

        const shopify = channels.find((c) => c.type === 'shopify');
        setShopifyConnected(!!shopify?.connected);
        setShopifyStoreName(shopify?.name || null);

        const woo = channels.find((c) => c.type === 'woocommerce');
        setWooConnected(!!woo?.connected);
        setWooStoreName(woo?.name || null);

        const widget = channels.find((c) => c.type === 'websocket');
        setWidgetConnected(!!widget?.connected);
      })
      .catch((err) => console.error('Failed to load channel status:', err));
  };

  const handleCatalogSourceSelect = async (source: CatalogSource) => {
    setCatalogSourceError('');
    try {
      const result = await setCatalogSource(source);
      setCatalogSourceState(result.catalogSource);
    } catch (err: any) {
      setCatalogSourceError(err.message || 'Disconnect the current catalog connector before switching.');
    }
  };

  useEffect(() => {
    refreshChannelsStatus();

    const hash = window.location.hash;
    const queryIndex = hash.indexOf('?');
    if (queryIndex === -1) return;
    const params = new URLSearchParams(hash.slice(queryIndex + 1));

    if (params.get('shopifyConnected')) {
      refreshChannelsStatus();
      setActiveWizardId('int-shopify');
      setWizardStep(2);
      window.history.replaceState(null, '', '#integrations');
      handleShopifySync();
    } else if (params.get('waConnected') || params.get('fbConnected')) {
      refreshChannelsStatus();
      window.history.replaceState(null, '', '#integrations');
    } else if (params.get('shopifyError')) {
      const code = params.get('shopifyError');
      setShopifyError(
        code === 'denied'
          ? 'Permissions were not granted. Please try again.'
          : code === 'invalid_signature'
            ? 'Could not verify that request came from Shopify. Please try again.'
            : code === 'already_connected'
              ? 'That channel is already connected to another account.'
              : 'Failed to connect. Please try again.'
      );
      setActiveWizardId('int-shopify');
      window.history.replaceState(null, '', '#integrations');
    } else if (params.get('waPending')) {
      const code = params.get('waPending')!;
      setWaPendingToken(code);
      getWhatsAppPendingNumbers(code)
        .then((res) => setWaPendingNumbers(res.numbers))
        .catch(() => setWaError('That connection attempt expired. Please try connecting again.'));
      window.history.replaceState(null, '', '#integrations');
    } else if (params.get('fbPending')) {
      const code = params.get('fbPending')!;
      setFbPendingToken(code);
      getFacebookPendingPages(code)
        .then((res) => setFbPendingPages(res.pages))
        .catch(() => setFbError('That connection attempt expired. Please try connecting again.'));
      window.history.replaceState(null, '', '#integrations');
    } else if (params.get('fbError')) {
      const code = params.get('fbError');
      setFbError(
        code === 'no_pages'
          ? "We didn't find any Facebook Pages or WhatsApp Business accounts. Make sure your business is verified and try again."
          : code === 'denied'
            ? 'Permissions were not granted. Please try again.'
            : code === 'already_connected'
              ? 'That channel is already connected to another account.'
              : 'Failed to connect. Please try again.'
      );
      window.history.replaceState(null, '', '#integrations');
    }
  }, []);

  const handleFacebookCardClick = async () => {
    if (fbConnected) {
      try {
        await disconnectChannel('facebook');
        setFbConnected(false);
        setFbPageName(null);
        refreshChannelsStatus();
      } catch (err) {
        console.error('Failed to disconnect Facebook:', err);
      }
      return;
    }
    try {
      window.location.href = await getFacebookConnectUrl();
    } catch {
      setFbError('Failed to start Facebook connection. Please try again.');
    }
  };

  const handleSelectFacebookPage = async (pageId: string) => {
    if (!fbPendingToken) return;
    setIsSelectingPage(true);
    try {
      await selectFacebookPage(fbPendingToken, pageId);
      setFbPendingToken(null);
      refreshChannelsStatus();
    } catch (err) {
      setFbError('Failed to select Facebook page. Please try again.');
    } finally {
      setIsSelectingPage(false);
    }
  };

  const handleWhatsAppDisconnect = async () => {
    try {
      await disconnectChannel('whatsapp');
      setWaConnected(false);
      setWaPhoneName(null);
      refreshChannelsStatus();
    } catch (err) {
      console.error('Failed to disconnect WhatsApp:', err);
    }
  };

  const handleSelectWhatsAppNumber = async (phoneNumberId: string) => {
    if (!waPendingToken) return;
    setIsSelectingWa(true);
    try {
      await selectWhatsAppNumber(waPendingToken, phoneNumberId);
      setWaPendingToken(null);
      setWaPendingNumbers([]);
      refreshChannelsStatus();
    } catch (err) {
      setWaError('Failed to select WhatsApp number. Please try again.');
    } finally {
      setIsSelectingWa(false);
    }
  };

  const handleSaveWhatsAppCredentials = async () => {
    if (!waPhoneNumberId.trim() || !waAccessToken.trim()) {
      setWaError('Phone number ID and access token are required');
      return;
    }
    setWaError('');
    setIsConnectingWa(true);
    try {
      await connectWhatsAppChannel({
        phoneNumberId: waPhoneNumberId.trim(),
        accessToken: waAccessToken.trim(),
        phoneNumber: whatsappNumber.trim() || undefined,
      });
      setIsConnectingWa(false);
      setWaConnected(true);
      setWaPhoneName(whatsappNumber.trim() || waPhoneNumberId.trim());
      setWizardStep(2);
      refreshChannelsStatus();
    } catch (err: any) {
      setIsConnectingWa(false);
      setWaError(err.message || 'Failed to connect WhatsApp channel');
    }
  };

  const handleShopifyConnect = async () => {
    if (!shopifyDomain.trim() || !shopifyAccessToken.trim()) {
      setShopifyError('Store domain and Admin API access token are required');
      return;
    }
    setShopifyError('');
    setIsConnectingShopify(true);
    try {
      const res = await connectShopifyChannel({
        domain: shopifyDomain.trim(),
        accessToken: shopifyAccessToken.trim(),
      });
      setShopifyConnected(true);
      setShopifyStoreName(res.name);
      setWizardStep(2);
      refreshChannelsStatus();
      setIsConnectingShopify(false);
      // Pull the products right away so the merchant lands on a populated catalog
      await handleShopifySync();
    } catch (err: any) {
      setShopifyError(err.message || 'Failed to connect Shopify store');
    } finally {
      setIsConnectingShopify(false);
    }
  };

  const handleShopifySync = async () => {
    setShopifyError('');
    setIsSyncingShopify(true);
    try {
      const res = await syncShopifyChannel();
      setShopifySyncResult(res);
      await announceCatalogLoaded({ source: 'Shopify', ...res });
    } catch (err: any) {
      setShopifyError(err.message || 'Failed to sync products');
    } finally {
      setIsSyncingShopify(false);
    }
  };

  const handleShopifyDisconnect = async () => {
    try {
      await disconnectChannel('shopify');
      setShopifyConnected(false);
      setShopifyStoreName(null);
      setShopifySyncResult(null);
      refreshChannelsStatus();
    } catch (err) {
      console.error('Failed to disconnect Shopify:', err);
    }
  };

  const handleWooCommerceConnect = async () => {
    if (!wooUrl.trim() || !wooConsumerKey.trim() || !wooConsumerSecret.trim()) {
      setWooError('Store URL, Consumer Key, and Consumer Secret are required');
      return;
    }
    setWooError('');
    setIsConnectingWoo(true);
    try {
      const res = await connectWooCommerceChannel({
        url: wooUrl.trim(),
        consumerKey: wooConsumerKey.trim(),
        consumerSecret: wooConsumerSecret.trim(),
      });
      setWooConnected(true);
      setWooStoreName(res.name);
      setWizardStep(2);
      refreshChannelsStatus();
      setIsConnectingWoo(false);
      // Pull the products right away so the merchant lands on a populated catalog
      await handleWooCommerceSync();
    } catch (err: any) {
      setWooError(err.message || 'Failed to connect WooCommerce store');
    } finally {
      setIsConnectingWoo(false);
    }
  };

  const handleWooCommerceSync = async () => {
    setWooError('');
    setIsSyncingWoo(true);
    try {
      const res = await syncWooCommerceChannel();
      setWooSyncResult(res);
      await announceCatalogLoaded({ source: 'WooCommerce', ...res });
    } catch (err: any) {
      setWooError(err.message || 'Failed to sync WooCommerce products');
    } finally {
      setIsSyncingWoo(false);
    }
  };

  const handleWooCommerceDisconnect = async () => {
    try {
      await disconnectChannel('woocommerce');
      setWooConnected(false);
      setWooStoreName(null);
      setWooSyncResult(null);
      refreshChannelsStatus();
    } catch (err) {
      console.error('Failed to disconnect WooCommerce:', err);
    }
  };

  const handleWidgetConnect = async () => {
    setWidgetError('');
    setIsConnectingWidget(true);
    try {
      const res = await connectWidgetChannel();
      setWidgetConnected(true);
      setWidgetKey(res.widgetKey);
      setWizardStep(2);
      refreshChannelsStatus();
    } catch (err: any) {
      setWidgetError(err.message || 'Failed to enable the website widget');
    } finally {
      setIsConnectingWidget(false);
    }
  };

  const handleWidgetDisconnect = async () => {
    try {
      await disconnectChannel('widget');
      setWidgetConnected(false);
      setWidgetKey(null);
      refreshChannelsStatus();
    } catch (err) {
      console.error('Failed to disconnect website widget:', err);
    }
  };

  const widgetEmbedSnippet = widgetKey
    ? `<script src="${window.location.origin}/widget.js" data-widget-key="${widgetKey}" async></script>`
    : '';

  const handleCopyWidgetSnippet = async () => {
    try {
      await navigator.clipboard.writeText(widgetEmbedSnippet);
      setWidgetCodeCopied(true);
      setTimeout(() => setWidgetCodeCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy embed snippet:', err);
    }
  };

  const handleInstagramCardClick = async () => {
    if (igConnected) {
      try {
        await disconnectChannel('instagram');
        setIgConnected(false);
        setIgAccountName(null);
        refreshChannelsStatus();
      } catch (err) {
        console.error('Failed to disconnect Instagram:', err);
      }
      return;
    }
    try {
      window.location.href = await getFacebookConnectUrl();
    } catch {
      setFbError('Failed to start Facebook connection. Please try again.');
    }
  };

  const startFacebookOAuth = async () => {
    try {
      window.location.href = await getFacebookConnectUrl();
    } catch {
      setFbError('Failed to start Facebook connection. Please try again.');
    }
  };

  const [shopifyDomain, setShopifyDomain] = useState('');
  const [showShopifyManual, setShowShopifyManual] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState('+1 (555) 019-2834');
  const [selectedFbPage, setSelectedFbPage] = useState('Aether Tech Labs');

  const startShopifyOAuth = async () => {
    const domain = shopifyDomain.trim();
    if (!domain) return;
    try {
      window.location.href = await getShopifyConnectUrl(domain);
    } catch {
      setShopifyError('Failed to start Shopify connection. Please try again.');
    }
  };

  const handleConnectClick = (item: Integration) => {
    setActiveWizardId(item.id);
    const initialStep = (item.id === 'int-shopify' && shopifyConnected) || (item.id === 'int-woo' && wooConnected) || (item.id === 'int-widget' && widgetConnected) ? 2 : 1;
    setWizardStep(initialStep);
    setIsSimulatingSync(false);
    setWaError('');
    setShopifyError('');
    setShopifySyncResult(null);
    setWooError('');
    setWooSyncResult(null);
    setWidgetError('');
    // Already connected: re-fetch the widgetKey (connect is an idempotent upsert) so the
    // embed snippet renders even though widgetKey isn't persisted in this component's state
    // across remounts.
    if (item.id === 'int-widget' && widgetConnected) {
      void handleWidgetConnect();
    }
  };

  const handleCompleteWizard = (id: string) => {
    setIsSimulatingSync(true);
    setTimeout(() => {
      setIsSimulatingSync(false);
      onToggleConnection(id);
      setActiveWizardId(null);
    }, 2000);
  };

  const renderIcon = (type: string, classStyle = "h-5 w-5") => {
    switch (type) {
      case 'facebook':
        return (
          <svg className={classStyle} viewBox="0 0 24 24" fill="none">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2"/>
          </svg>
        );
      case 'instagram':
        return (
          <svg className={classStyle} viewBox="0 0 24 24" fill="none">
            <defs>
              <radialGradient id="ig-grad-full" cx="30%" cy="107%" r="130%">
                <stop offset="0%" stopColor="#fdf497" />
                <stop offset="5%" stopColor="#fdf497" />
                <stop offset="45%" stopColor="#fd5949" />
                <stop offset="60%" stopColor="#d6249f" />
                <stop offset="90%" stopColor="#285AEB" />
              </radialGradient>
            </defs>
            <rect width="24" height="24" rx="6" fill="url(#ig-grad-full)" />
            <rect x="4.5" y="4.5" width="15" height="15" rx="4.5" stroke="#ffffff" strokeWidth="1.8" fill="none" />
            <circle cx="12" cy="12" r="3.6" stroke="#ffffff" strokeWidth="1.8" fill="none" />
            <circle cx="16.3" cy="7.7" r="1.1" fill="#ffffff" />
          </svg>
        );
      case 'whatsapp':
        return (
          <svg className={classStyle} viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="6" fill="#25D366" />
            <path 
              d="M12 4.2a7.8 7.8 0 0 0-6.75 11.7L4 20l4.24-1.21A7.8 7.8 0 1 0 12 4.2zm0 14.1a6.3 6.3 0 0 1-3.21-.88l-.23-.14-2.39.68.68-2.33-.15-.24a6.3 6.3 0 1 1 5.3 2.91zm3.46-4.73c-.19-.09-1.12-.55-1.3-.61-.17-.06-.3-.09-.43.1-.13.19-.5.61-.61.73-.11.13-.23.14-.42.05a5.27 5.27 0 0 1-1.55-.96 5.8 5.8 0 0 1-1.08-1.34c-.11-.19 0-.29.09-.38.08-.08.19-.23.29-.34.1-.11.13-.19.19-.32.06-.13.03-.24-.02-.34-.05-.09-.43-1.03-.59-1.42-.15-.37-.31-.32-.43-.32-.11 0-.24-.01-.37-.01-.13 0-.34.05-.52.24s-.69.67-.69 1.64.71 1.9 0.81 2.03c.1.13 1.39 2.12 3.37 2.97.47.2.84.32 1.13.41.48.15.91.13 1.25.08.38-.06 1.16-.47 1.32-.93.16-.46.16-.85.11-.93-.05-.08-.18-.13-.37-.22z" 
              fill="#ffffff" 
            />
          </svg>
        );
      case 'shopify':
        return (
          <svg className={classStyle} viewBox="0 0 109.5 124.5" fill="none">
            {/* Official Shopify shopping bag logo */}
            <path d="M95.6 28.4c-.1-.7-.7-1.1-1.2-1.1s-9.9-.7-9.9-.7-6.6-6.5-7.4-7.2c-.7-.7-2.2-.5-2.7-.3-.1 0-1.4.4-3.7 1.1-2.2-6.3-6.1-12.1-12.9-12.1h-.6c-1.9-2.5-4.3-3.6-6.3-3.6-15.6 0-23.1 19.5-25.4 29.4-6 1.9-10.3 3.2-10.8 3.3-3.4 1.1-3.5 1.2-3.9 4.4C10.4 44.1 0 124.5 0 124.5l75.6 13 33.9-8.4S95.7 29.1 95.6 28.4zM67.3 21.7l-5.7 1.8c0-3.1-.4-7.6-1.8-11.4 4.4.9 6.6 5.9 7.5 9.6zm-9.7 3l-12.3 3.8c1.2-4.6 3.5-9.1 6.3-12.1 1.1-1.1 2.5-2.3 4.2-3 1.7 3.5 1.9 8.5 1.8 11.3zm-6.8-17.7c1.4 0 2.5.5 3.5 1.3-4 1.9-8.3 6.7-10.1 16.3l-9.8 3c2.7-9.1 9-20.6 16.4-20.6z" fill="#95BF47"/>
            <path d="M94.4 27.3c-.5 0-9.9-.7-9.9-.7s-6.6-6.5-7.4-7.2c-.3-.3-.6-.4-.9-.4l-4.7 95.5 33.9-8.4S95.7 29.1 95.6 28.4c-.1-.7-.7-1.1-1.2-1.1z" fill="#5E8E3E"/>
            <path d="M57.4 43.6l-4.7 13.9s-4.1-2.2-9.1-2.2c-7.4 0-7.7 4.6-7.7 5.8 0 6.3 16.6 8.8 16.6 23.6 0 11.7-7.4 19.2-17.4 19.2-12 0-18.1-7.5-18.1-7.5l3.2-10.6s6.3 5.4 11.6 5.4c3.5 0 4.9-2.7 4.9-4.7 0-8.3-13.6-8.6-13.6-22.2 0-11.4 8.2-22.5 24.7-22.5 6.4 0 9.6 1.8 9.6 1.8z" fill="#FFFFFF"/>
          </svg>
        );
      case 'woocommerce':
        return (
          <svg className={classStyle} viewBox="0 0 24 24" fill="none">
            {/* WooCommerce purple circle with bold white W */}
            <circle cx="12" cy="12" r="12" fill="#7F54B3"/>
            <path d="M5.4 7.8h13.2c.7 0 1.3.4 1.5 1l-3.2 8.6c-.2.5-.7.8-1.2.8H8.3c-.5 0-1-.3-1.2-.8L3.9 8.8c-.2-.5.1-1 .7-1h.8z" fill="#7F54B3" stroke="#fff" strokeWidth="1.2"/>
            <text x="12" y="16" textAnchor="middle" fill="white" fontSize="11" fontWeight="900" fontFamily="Arial, sans-serif">W</text>
          </svg>
        );
      case 'websocket':
        return (
          <svg className={classStyle} viewBox="0 0 24 24" fill="none">
            {/* Green lightning bolt — no background */}
            <path d="M13 2L4.5 13h6l-1.5 9L18 11h-6.5L13 2z" fill="#10B981"/>
          </svg>
        );
      default:
        return <Database className={classStyle} />;
    }
  };

  const displayIntegrations = integrations.map((item) => {
    if (item.id === 'int-fb') {
      return {
        ...item,
        connected: fbConnected,
        statusText: fbConnected ? (fbPageName ? `Connected: ${fbPageName}` : 'Active sync') : 'Not connected',
      };
    }
    if (item.id === 'int-ig') {
      return {
        ...item,
        connected: igConnected,
        statusText: igConnected ? (igAccountName ? `Connected: ${igAccountName}` : 'Active sync') : 'Not connected',
      };
    }
    if (item.id === 'int-wa') {
      return {
        ...item,
        connected: waConnected,
        statusText: waConnected ? (waPhoneName ? `Connected: ${waPhoneName}` : 'Active sync') : 'Token expired',
      };
    }
    if (item.id === 'int-shopify') {
      return {
        ...item,
        connected: shopifyConnected,
        statusText: shopifyConnected ? (shopifyStoreName ? `Connected: ${shopifyStoreName}` : 'Active sync') : 'Not connected',
      };
    }
    if (item.id === 'int-woo') {
      return {
        ...item,
        connected: wooConnected,
        statusText: wooConnected ? (wooStoreName ? `Connected: ${wooStoreName}` : 'Active sync') : 'Not connected',
      };
    }
    if (item.id === 'int-widget') {
      return {
        ...item,
        connected: widgetConnected,
        statusText: widgetConnected ? 'Embed active' : 'Not connected',
      };
    }
    return item;
  });

  const filteredIntegrations = displayIntegrations.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="w-full flex-grow flex flex-col text-left">
      <DashboardHeader 
        searchPlaceholder="Search extensions…" 
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
      />

      <div className="w-full flex-grow space-y-6 p-6 md:p-8">
        {fbError && (
          <div className="status-danger text-xs p-3.5 rounded-xl flex items-center justify-between font-sans">
            <span>{fbError}</span>
            <button onClick={() => setFbError('')} className="text-[#ff9d92] hover:text-white cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

      {/* Connectivity Banner Content (§8) */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white/[0.05] border border-white/12 rounded-full text-[11px] font-bold text-white/70 font-sans tracking-[0.10em]">
          <Globe className="h-4 w-4 text-[#7aa8ff]" />
          Channel ecosystem
        </div>

        <h2 className="text-[44px] font-[800] tracking-[-0.03em] text-white leading-tight font-sans">
          Unify your sales channels
        </h2>

        <p className="text-sm text-white/60 max-w-2xl leading-relaxed font-sans">
          Connect your social messaging pages and store platforms directly into Remlin. Automate replies, sync product catalogs, and finalize orders from a single interface.
        </p>
      </div>

      {/* Messaging Channels Section */}
      <div className="space-y-4">
        <div className="px-1">
          <h3 className="text-sm font-bold text-white uppercase tracking-[0.12em]">Connect your customer channels</h3>
          <p className="text-xs text-white/50 mt-1">Connect Facebook, Instagram, WhatsApp or add a website widget</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredIntegrations
            .filter((item) => ['int-fb', 'int-ig', 'int-wa', 'int-widget'].includes(item.id))
            .map((item) => {
              const isWhatsApp = item.id === 'int-wa';
              const isNotConnected = !item.connected;
              const isWhatsAppError = isWhatsApp && !waConnected;
              
              return (
                <div 
                  key={item.id}
                  className={`flex flex-col justify-between h-[260px] p-6 rounded-2xl transition-all duration-300 relative group overflow-hidden ${
                    isWhatsAppError 
                      ? 'status-danger border-red-500/30' 
                      : isNotConnected 
                        ? 'zone-b-grey2 border border-dashed border-white/16 hover:border-white/30' 
                        : 'zone-b-grey2 hover:border-white/24'
                  }`}
                >
                  <div>
                    <div className="flex justify-between items-start">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105 duration-300 ${
                        item.id === 'int-fb'
                          ? 'bg-[#1877f2]/15 border border-[#1877f2]/30 text-[#1877f2]'
                          : item.id === 'int-ig'
                            ? 'bg-gradient-to-tr from-[#fdf497]/20 via-[#fd5949]/20 to-[#d6249f]/20 border border-[#fd5949]/30 text-white'
                            : item.id === 'int-wa'
                              ? 'bg-[#25D366]/15 border border-[#25D366]/30 text-[#25D366]'
                              : 'bg-white/10 border border-white/15 text-white/90'
                      }`}>
                        {renderIcon(item.logoType, "h-6 w-6")}
                      </div>

                      <div>
                        {item.connected ? (
                          <span className="status-success px-2.5 py-1 text-[11px] font-bold rounded-full">
                            Connected
                          </span>
                        ) : isWhatsAppError ? (
                          <span className="status-danger px-2.5 py-1 text-[11px] font-bold rounded-full">
                            Action required
                          </span>
                        ) : (
                          <span className="status-neutral px-2.5 py-1 text-[11px] font-bold rounded-full">
                            Not connected
                          </span>
                        )}
                      </div>
                    </div>

                    <h3 className="font-sans font-bold text-[19px] text-white tracking-tight mt-5">
                      {item.name}
                    </h3>
                    
                    <p className="text-white/60 text-xs leading-relaxed mt-1 font-sans line-clamp-3">
                      {item.description}
                    </p>
                  </div>

                  <div className="border-t border-white/[0.07] pt-4 flex justify-between items-center">
                    <span className="font-sans text-xs text-white/50">
                      {item.statusText}
                    </span>

                    <button
                      onClick={() => {
                        if (item.id === 'int-fb') {
                          handleFacebookCardClick();
                        } else if (item.id === 'int-ig') {
                          handleInstagramCardClick();
                        } else if (item.id === 'int-wa') {
                          if (waConnected) {
                            handleWhatsAppDisconnect();
                          } else {
                            setShowWhatsAppQr(true);
                          }
                        } else if (item.id === 'int-widget') {
                          if (widgetConnected) {
                            handleConnectClick(item);
                          } else {
                            handleConnectClick(item);
                          }
                        } else {
                          handleConnectClick(item);
                        }
                      }}
                      className={`font-sans text-xs font-bold px-4 py-2 rounded-xl transition-all cursor-pointer ${
                        isWhatsAppError
                          ? 'btn-light-primary'
                          : item.connected
                            ? 'btn-glass'
                            : 'btn-accent'
                      }`}
                    >
                      {item.id === 'int-fb' 
                        ? (item.connected ? 'Disconnect' : 'Connect') 
                        : item.id === 'int-ig' 
                          ? (item.connected ? 'Disconnect' : 'Connect') 
                          : isWhatsApp 
                            ? (waConnected ? 'Disconnect' : 'Connect') 
                            : item.id === 'int-widget' 
                              ? (widgetConnected ? 'Manage' : 'Connect') 
                              : 'Manage'}
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Dotted separator with Beta label */}
      <div className="flex items-center gap-3 py-4">
        <div className="flex-1 border-t border-dotted border-white/25" />
        <span className="text-[9px] uppercase tracking-[0.14em] text-white/40 font-bold">Beta · Product Catalog Connectors</span>
        <div className="flex-1 border-t border-dotted border-white/25" />
      </div>

      {/* Minimal Single-Line Catalog Source Selector */}
      <div className="zone-b-grey2 p-4 rounded-xl border border-white/10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-white/50" />
            <span className="text-xs font-bold text-white/70">Catalog Source:</span>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleCatalogSourceSelect('CUSTOM')}
              disabled={catalogSource !== 'CUSTOM' && (shopifyConnected || wooConnected)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                catalogSource === 'CUSTOM'
                  ? 'bg-[#4d8bff]/20 border border-[#4d8bff]/50 text-white'
                  : 'bg-white/5 border border-white/15 text-white/50 hover:border-white/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              Custom
            </button>
            
            <button
              onClick={() => handleCatalogSourceSelect('SHOPIFY')}
              disabled={catalogSource !== 'CUSTOM' && catalogSource !== 'SHOPIFY'}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                catalogSource === 'SHOPIFY'
                  ? 'bg-[#96bf48]/20 border border-[#96bf48]/50 text-white'
                  : 'bg-white/5 border border-white/15 text-white/50 hover:border-white/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              Shopify
            </button>
            
            <button
              onClick={() => handleCatalogSourceSelect('WOOCOMMERCE')}
              disabled={catalogSource !== 'CUSTOM' && catalogSource !== 'WOOCOMMERCE'}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                catalogSource === 'WOOCOMMERCE'
                  ? 'bg-[#7F54B3]/20 border border-[#7F54B3]/50 text-white'
                  : 'bg-white/5 border border-white/15 text-white/50 hover:border-white/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              WooCommerce
            </button>
            
            <button
              onClick={() => handleCatalogSourceSelect('CSV')}
              disabled={catalogSource !== 'CUSTOM' && catalogSource !== 'CSV'}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                catalogSource === 'CSV'
                  ? 'bg-blue-500/20 border border-blue-500/50 text-white'
                  : 'bg-white/5 border border-white/15 text-white/50 hover:border-white/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              CSV
            </button>
          </div>
        </div>
        
        {catalogSourceError && (
          <div className="status-danger text-[11px] p-2 rounded-lg font-sans mt-3">
            {catalogSourceError}
          </div>
        )}
      </div>

      {/* Product Catalog Connectors Section */}
      <div className="space-y-4">
        <div className="px-1">
          <h3 className="text-sm font-bold text-white uppercase tracking-[0.12em]">Sync your product catalog</h3>
          <p className="text-xs text-white/50 mt-1">Connect your store platform or upload a CSV file</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Shopify Card */}
          {filteredIntegrations
            .filter((item) => item.id === 'int-shopify')
            .map((item) => {
              const sourceLocked = catalogSource !== 'CUSTOM' && catalogSource !== 'SHOPIFY';
              
              return (
                <div 
                  key={item.id}
                  className={`flex flex-col justify-between h-[260px] p-6 rounded-2xl transition-all duration-300 relative group overflow-hidden ${
                    sourceLocked
                      ? 'zone-b-grey2 border border-white/10 opacity-45'
                      : shopifyConnected
                        ? 'zone-b-grey2 hover:border-white/24'
                        : 'zone-b-grey2 border border-dashed border-white/16 hover:border-white/30'
                  }`}
                >
                  <div>
                    <div className="flex justify-between items-start">
                      <div className="w-12 h-12 rounded-xl bg-[#96bf48]/15 border border-[#96bf48]/30 text-[#96bf48] flex items-center justify-center transition-transform group-hover:scale-105 duration-300">
                        {renderIcon(item.logoType, "h-6 w-6")}
                      </div>

                      <div>
                        {sourceLocked ? (
                          <span className="status-neutral px-2.5 py-1 text-[11px] font-bold rounded-full">
                            Locked
                          </span>
                        ) : shopifyConnected ? (
                          <span className="status-success px-2.5 py-1 text-[11px] font-bold rounded-full">
                            Connected
                          </span>
                        ) : (
                          <span className="status-neutral px-2.5 py-1 text-[11px] font-bold rounded-full">
                            Not connected
                          </span>
                        )}
                      </div>
                    </div>

                    <h3 className="font-sans font-bold text-[19px] text-white tracking-tight mt-5">
                      {item.name}
                    </h3>
                    
                    <p className="text-white/60 text-xs leading-relaxed mt-1 font-sans line-clamp-3">
                      {sourceLocked ? `Select "Shopify" as catalog source first` : item.description}
                    </p>
                  </div>

                  <div className="border-t border-white/[0.07] pt-4 flex justify-between items-center">
                    <span className="font-sans text-xs text-white/50">
                      {sourceLocked ? 'Source locked' : item.statusText}
                    </span>

                    <button
                      onClick={() => !sourceLocked && handleConnectClick(item)}
                      disabled={sourceLocked}
                      className={`font-sans text-xs font-bold px-4 py-2 rounded-xl transition-all ${
                        sourceLocked
                          ? 'bg-white/5 text-white/30 cursor-not-allowed'
                          : shopifyConnected
                            ? 'btn-glass cursor-pointer'
                            : 'btn-accent cursor-pointer'
                      }`}
                    >
                      {sourceLocked ? 'Locked' : shopifyConnected ? 'Manage' : 'Connect'}
                    </button>
                  </div>
                </div>
              );
            })}

          {/* WooCommerce Card */}
          {filteredIntegrations
            .filter((item) => item.id === 'int-woo')
            .map((item) => {
              const sourceLocked = catalogSource !== 'CUSTOM' && catalogSource !== 'WOOCOMMERCE';
              
              return (
                <div 
                  key={item.id}
                  className={`flex flex-col justify-between h-[260px] p-6 rounded-2xl transition-all duration-300 relative group overflow-hidden ${
                    sourceLocked
                      ? 'zone-b-grey2 border border-white/10 opacity-45'
                      : wooConnected
                        ? 'zone-b-grey2 hover:border-white/24'
                        : 'zone-b-grey2 border border-dashed border-white/16 hover:border-white/30'
                  }`}
                >
                  <div>
                    <div className="flex justify-between items-start">
                      <div className="w-12 h-12 rounded-xl bg-[#7F54B3]/15 border border-[#7F54B3]/30 text-[#7F54B3] flex items-center justify-center transition-transform group-hover:scale-105 duration-300">
                        {renderIcon(item.logoType, "h-6 w-6")}
                      </div>

                      <div>
                        {sourceLocked ? (
                          <span className="status-neutral px-2.5 py-1 text-[11px] font-bold rounded-full">
                            Locked
                          </span>
                        ) : wooConnected ? (
                          <span className="status-success px-2.5 py-1 text-[11px] font-bold rounded-full">
                            Connected
                          </span>
                        ) : (
                          <span className="status-neutral px-2.5 py-1 text-[11px] font-bold rounded-full">
                            Not connected
                          </span>
                        )}
                      </div>
                    </div>

                    <h3 className="font-sans font-bold text-[19px] text-white tracking-tight mt-5">
                      {item.name}
                    </h3>
                    
                    <p className="text-white/60 text-xs leading-relaxed mt-1 font-sans line-clamp-3">
                      {sourceLocked ? `Select "WooCommerce" as catalog source first` : item.description}
                    </p>
                  </div>

                  <div className="border-t border-white/[0.07] pt-4 flex justify-between items-center">
                    <span className="font-sans text-xs text-white/50">
                      {sourceLocked ? 'Source locked' : item.statusText}
                    </span>

                    <button
                      onClick={() => !sourceLocked && handleConnectClick(item)}
                      disabled={sourceLocked}
                      className={`font-sans text-xs font-bold px-4 py-2 rounded-xl transition-all ${
                        sourceLocked
                          ? 'bg-white/5 text-white/30 cursor-not-allowed'
                          : wooConnected
                            ? 'btn-glass cursor-pointer'
                            : 'btn-accent cursor-pointer'
                      }`}
                    >
                      {sourceLocked ? 'Locked' : wooConnected ? 'Manage' : 'Connect'}
                    </button>
                  </div>
                </div>
              );
            })}

          {/* Excel/CSV Catalog Upload Card */}
          {(() => {
            const csvLocked = catalogSource !== 'CUSTOM' && catalogSource !== 'CSV';
            
            return (
              <div className={`flex flex-col justify-between h-[260px] p-6 rounded-2xl transition-all duration-300 relative group overflow-hidden ${
                csvLocked
                  ? 'zone-b-grey2 border border-white/10 opacity-45'
                  : 'zone-b-grey2 border border-dashed border-white/20 hover:border-white/35'
              }`}>
                <div>
                  <div className="flex justify-between items-start">
                    <div className="w-12 h-12 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 flex items-center justify-center transition-transform group-hover:scale-105 duration-300">
                      <FileSpreadsheet className="h-6 w-6" />
                    </div>
                    <div>
                      {csvLocked ? (
                        <span className="status-neutral px-2.5 py-1 text-[11px] font-bold rounded-full">
                          Locked
                        </span>
                      ) : (
                        <span className="status-neutral px-2.5 py-1 text-[11px] font-bold rounded-full">
                          CSV / Excel
                        </span>
                      )}
                    </div>
                  </div>

                  <h3 className="font-sans font-bold text-[19px] text-white tracking-tight mt-5">
                    Upload Excel/CSV product sheet
                  </h3>
                  
                  <p className="text-white/60 text-xs leading-relaxed mt-1 font-sans line-clamp-3">
                    {csvLocked ? `Select "CSV" as catalog source first` : `Don't have a website? Upload your product catalog excel/csv file and continue your business`}
                  </p>

                  {excelErrorMsg && !csvLocked && (
                    <div className="status-danger text-[11px] p-2 rounded-xl font-sans mt-2">
                      {excelErrorMsg}
                    </div>
                  )}
                </div>

                <div className="border-t border-white/[0.07] pt-4 flex justify-between items-center">
                  <span className="font-sans text-xs text-white/50">
                    {csvLocked ? 'Source locked' : 'Bulk SKU import'}
                  </span>

                  <button
                    type="button"
                    onClick={openUploadDialog}
                    disabled={csvLocked || uploadStep === 'importing'}
                    className={`font-sans text-xs font-bold px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
                      csvLocked
                        ? 'bg-white/5 text-white/30 cursor-not-allowed'
                        : 'btn-accent cursor-pointer shadow-md hover:scale-105'
                    }`}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {csvLocked ? 'Locked' : uploadStep === 'importing' ? 'Importing…' : 'Upload'}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* SETUP WIZARDS DIALOGS OVERLAY */}
      <AnimatePresence>
        {activeWizardId && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="zone-b-grey3 border border-white/20 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col text-left"
            >
              <header className="p-5 border-b border-white/[0.07] bg-black/40 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-white/10 border border-white/15 rounded-xl">
                    {renderIcon(integrations.find(i => i.id === activeWizardId)?.logoType || '', "h-5 w-5 text-white")}
                  </div>
                  <div>
                    <h4 className="font-sans font-bold text-base text-white">
                      Setup {integrations.find(i => i.id === activeWizardId)?.name}
                    </h4>
                    <p className="text-xs text-white/50 mt-0.5">
                      ShopMate channel adapter v1.1
                    </p>
                  </div>
                </div>

                <button 
                  onClick={() => setActiveWizardId(null)}
                  className="text-white/40 hover:text-white transition-colors cursor-pointer p-1"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>

              <div className="p-6 space-y-6 flex-grow">
                {isSimulatingSync ? (
                  <div className="py-8 text-center space-y-4">
                    <RefreshCw className="h-10 w-10 text-[#4d8bff] animate-spin mx-auto" />
                    <div className="space-y-1">
                      <p className="font-sans text-xs text-white font-bold tracking-wider">
                        Indexing data structures…
                      </p>
                      <p className="text-xs text-white/50 font-sans max-w-sm mx-auto leading-relaxed">
                        Establishing webhook endpoint connection and indexing store data into Remlin context…
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 justify-center mb-4">
                      {[1, 2, 3].map((step) => (
                        <div key={step} className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center font-sans text-xs font-bold transition-all ${
                            wizardStep === step 
                              ? 'btn-accent text-white' 
                              : wizardStep > step 
                                ? 'bg-white/20 text-white' 
                                : 'bg-white/5 text-white/30 border border-white/10'
                          }`}>
                            {wizardStep > step ? <Check className="h-3.5 w-3.5" /> : step}
                          </div>
                          {step < 3 && <div className={`w-8 h-0.5 ${wizardStep > step ? 'bg-white/30' : 'bg-white/10'}`} />}
                        </div>
                      ))}
                    </div>

                    {activeWizardId === 'int-ig' && (
                      <div className="space-y-4 text-center py-4">
                        <Facebook className="h-12 w-12 text-[#1877F2] mx-auto" />
                        <div className="space-y-1.5">
                          <h5 className="text-sm font-bold text-white font-sans">OAuth authentication</h5>
                          <p className="text-xs text-white/60 max-w-md mx-auto leading-relaxed font-sans">
                            Sign in with your Facebook account to grant Remlin access to process incoming Instagram messages.
                          </p>
                        </div>
                        <button 
                          onClick={() => { void startFacebookOAuth(); }}
                          className="btn-accent px-6 py-3 text-xs font-bold flex items-center gap-2 mx-auto cursor-pointer"
                        >
                          Connect via Meta OAuth
                        </button>
                      </div>
                    )}

                    {activeWizardId === 'int-wa' && (
                      <div className="space-y-4">
                        {wizardStep === 1 && (
                          <div className="space-y-5">
                            <div className="text-center py-1 space-y-1.5">
                              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mx-auto">
                                <MessageSquare className="h-6 w-6 text-emerald-400" />
                              </div>
                              <h5 className="text-base font-bold text-white font-sans">Connect WhatsApp Business</h5>
                              <p className="text-xs text-white/60 leading-relaxed max-w-sm mx-auto font-sans">
                                Link your WhatsApp Business account so Remlin can automate customer responses.
                              </p>
                            </div>

                            {waError && (
                              <div className="status-danger text-xs p-3 rounded-xl leading-relaxed font-sans">
                                {waError}
                              </div>
                            )}

                            <div className="zone-b-grey2 p-4 rounded-2xl space-y-3">
                              <div className="flex items-center gap-2">
                                <span className="status-success px-2 py-0.5 text-[10.5px] font-bold rounded-full">
                                  Recommended
                                </span>
                              </div>

                              <div>
                                <h6 className="text-xs font-bold text-white font-sans">Sign in with Meta</h6>
                                <p className="text-xs text-white/50 leading-relaxed font-sans mt-0.5">
                                  Meta login automatically detects your WhatsApp Business numbers. No tokens required.
                                </p>
                              </div>

                              <button
                                onClick={() => { void startFacebookOAuth(); }}
                                className="w-full flex items-center justify-center gap-2.5 bg-[#1877f2] hover:bg-[#1565d8] text-white font-sans text-xs font-bold py-3 rounded-xl cursor-pointer transition-colors shadow-md"
                              >
                                <Facebook className="h-4 w-4" />
                                Continue with Meta
                              </button>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-px bg-white/10" />
                              <span className="text-[11px] text-white/40 font-sans">or</span>
                              <div className="flex-1 h-px bg-white/10" />
                            </div>

                            <div className="space-y-3">
                              <div className="space-y-1.5">
                                <label className="font-sans text-xs text-white/60 font-semibold block">
                                  Phone number ID
                                </label>
                                <input
                                  type="text"
                                  placeholder="e.g. 10528492049102"
                                  value={waPhoneNumberId}
                                  onChange={(e) => setWaPhoneNumberId(e.target.value)}
                                  className="w-full zone-b-input p-2.5 text-xs font-mono outline-none"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="font-sans text-xs text-white/60 font-semibold block">
                                  Access token
                                </label>
                                <textarea
                                  placeholder="e.g. EAAG…"
                                  rows={2}
                                  value={waAccessToken}
                                  onChange={(e) => setWaAccessToken(e.target.value)}
                                  className="w-full zone-b-input p-2.5 text-xs font-mono outline-none resize-none"
                                />
                              </div>

                              <button
                                onClick={handleSaveWhatsAppCredentials}
                                disabled={isConnectingWa || (!waPhoneNumberId.trim() || !waAccessToken.trim())}
                                className="w-full btn-glass py-2.5 text-xs font-bold cursor-pointer disabled:opacity-40"
                              >
                                {isConnectingWa ? 'Connecting…' : 'Connect via API keys'}
                              </button>
                            </div>
                          </div>
                        )}

                        {wizardStep === 2 && (
                          <div className="space-y-4 text-center py-4">
                            <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
                            <div className="space-y-1.5">
                              <h5 className="text-base font-bold text-white font-sans">WhatsApp Business connected</h5>
                              <p className="text-xs text-white/60 max-w-sm mx-auto leading-relaxed font-sans">
                                Your WhatsApp channel is live. Remlin will process incoming inquiries automatically.
                              </p>
                            </div>
                            <button
                              onClick={() => handleCompleteWizard(activeWizardId)}
                              className="w-full btn-light-primary py-3 text-xs font-bold cursor-pointer"
                            >
                              Return to integrations
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {activeWizardId === 'int-shopify' && (
                      <div className="space-y-4">
                        {wizardStep === 1 && (
                          <div className="space-y-4">
                            <div className="text-center py-2 space-y-1">
                              <ShoppingBag className="h-10 w-10 text-[#96BF48] mx-auto" />
                              <h5 className="text-base font-bold text-white font-sans">Shopify store catalog pairing</h5>
                              <p className="text-xs text-white/60 leading-relaxed max-w-sm mx-auto font-sans">
                                Enter your Shopify store domain, then connect with Shopify — you'll approve access on your own store, no tokens to copy.
                              </p>
                            </div>

                            {shopifyError && (
                              <div className="status-danger text-xs p-3 rounded-xl text-center font-sans">
                                {shopifyError}
                              </div>
                            )}

                            <div className="space-y-1.5">
                              <label className="font-sans text-xs text-white/60 font-semibold block">Shopify domain</label>
                              <input
                                type="text"
                                placeholder="my-boutique.myshopify.com"
                                value={shopifyDomain}
                                onChange={(e) => setShopifyDomain(e.target.value)}
                                className="w-full zone-b-input p-3 text-xs outline-none"
                              />
                            </div>
                            <button
                              onClick={() => { void startShopifyOAuth(); }}
                              disabled={!shopifyDomain.trim()}
                              className="w-full btn-accent py-3 text-xs font-bold cursor-pointer disabled:opacity-50"
                            >
                              Connect with Shopify
                            </button>

                            <button
                              onClick={() => setShowShopifyManual(!showShopifyManual)}
                              className="w-full text-xs text-white/40 hover:text-white/70 transition-colors cursor-pointer font-sans"
                            >
                              {showShopifyManual ? 'Hide manual token option' : 'Or connect manually with an API token'}
                            </button>

                            {showShopifyManual && (
                              <div className="space-y-3 pt-1 border-t border-white/[0.07]">
                                <p className="text-[11px] text-white/50 leading-relaxed font-sans pt-3">
                                  For testing without OAuth — see docs/SHOPIFY_SETUP.md for how to create a custom-app Admin API access token.
                                </p>
                                <div className="space-y-1.5">
                                  <label className="font-sans text-xs text-white/60 font-semibold block">Admin API access token</label>
                                  <input
                                    type="password"
                                    placeholder="shpat_..."
                                    value={shopifyAccessToken}
                                    onChange={(e) => setShopifyAccessToken(e.target.value)}
                                    className="w-full zone-b-input p-3 text-xs outline-none"
                                  />
                                </div>
                                <button
                                  onClick={handleShopifyConnect}
                                  disabled={isConnectingShopify || !shopifyDomain.trim() || !shopifyAccessToken.trim()}
                                  className="w-full btn-glass py-2.5 text-xs font-bold cursor-pointer disabled:opacity-40"
                                >
                                  {isConnectingShopify ? 'Connecting…' : 'Connect via API token'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {wizardStep === 2 && (
                          <div className="space-y-4 text-center py-4">
                            <CheckCircle2 className="h-12 w-12 text-[#96BF48] mx-auto" />
                            <div className="space-y-1.5">
                              <h5 className="text-base font-bold text-white font-sans">
                                {shopifyStoreName ? `Connected: ${shopifyStoreName}` : 'Shopify connected'}
                              </h5>
                              <p className="text-xs text-white/60 max-w-sm mx-auto leading-relaxed font-sans">
                                Pull the latest products, prices, and stock levels from this store into your ShopMate catalog.
                              </p>
                            </div>

                            {shopifyError && (
                              <div className="status-danger text-xs p-3 rounded-xl text-center font-sans">
                                {shopifyError}
                              </div>
                            )}

                            {shopifySyncResult && (
                              <div className="zone-b-grey2 p-3.5 rounded-xl text-xs text-white/70 font-sans space-y-1">
                                <div>{shopifySyncResult.total} product(s) found on Shopify</div>
                                <div>{shopifySyncResult.created} added, {shopifySyncResult.updated} updated in your catalog</div>
                              </div>
                            )}

                            <button
                              onClick={handleShopifySync}
                              disabled={isSyncingShopify}
                              className="w-full btn-light-primary py-3 text-xs font-bold cursor-pointer disabled:opacity-50"
                            >
                              {isSyncingShopify ? 'Syncing…' : 'Sync products now'}
                            </button>
                            <button
                              onClick={async () => { await handleShopifyDisconnect(); setActiveWizardId(null); }}
                              className="w-full btn-glass py-2.5 text-xs font-bold cursor-pointer"
                            >
                              Disconnect store
                            </button>
                            <button
                              onClick={() => setActiveWizardId(null)}
                              className="w-full text-xs text-white/50 hover:text-white transition-colors cursor-pointer font-sans"
                            >
                              Return to integrations
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {activeWizardId === 'int-woo' && (
                      <div className="space-y-4">
                        {wizardStep === 1 && (
                          <div className="space-y-4">
                            <div className="text-center py-1 space-y-1">
                              <Database className="h-10 w-10 text-[#7F54B3] mx-auto" />
                              <h5 className="text-base font-bold text-white font-sans">WooCommerce REST API setup</h5>
                              <p className="text-xs text-white/60 leading-relaxed max-w-sm mx-auto font-sans">
                                Connect your WooCommerce store using your generated REST API Consumer Key and Consumer Secret.
                              </p>
                            </div>

                            {wooError && (
                              <div className="status-danger text-xs p-3 rounded-xl font-sans text-center">
                                {wooError}
                              </div>
                            )}

                            <div className="space-y-3">
                              <div className="space-y-1.5">
                                <label className="font-sans text-xs text-white/60 font-semibold block">Store URL</label>
                                <input
                                  type="text"
                                  placeholder="https://yourstore.com"
                                  value={wooUrl}
                                  onChange={(e) => setWooUrl(e.target.value)}
                                  className="w-full zone-b-input p-2.5 text-xs outline-none"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <label className="font-sans text-xs text-white/60 font-semibold block">Consumer Key</label>
                                <input
                                  type="password"
                                  placeholder="ck_..."
                                  value={wooConsumerKey}
                                  onChange={(e) => setWooConsumerKey(e.target.value)}
                                  className="w-full zone-b-input p-2.5 text-xs outline-none"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <label className="font-sans text-xs text-white/60 font-semibold block">Consumer Secret</label>
                                <input
                                  type="password"
                                  placeholder="cs_..."
                                  value={wooConsumerSecret}
                                  onChange={(e) => setWooConsumerSecret(e.target.value)}
                                  className="w-full zone-b-input p-2.5 text-xs outline-none"
                                />
                              </div>
                            </div>
                            <button 
                              onClick={handleWooCommerceConnect}
                              disabled={isConnectingWoo || !wooUrl.trim() || !wooConsumerKey.trim() || !wooConsumerSecret.trim()}
                              className="w-full btn-accent py-3 text-xs font-bold cursor-pointer disabled:opacity-40"
                            >
                              {isConnectingWoo ? 'Connecting & Verifying…' : 'Connect WooCommerce'}
                            </button>
                            <p className="text-[11px] text-white/40 text-center font-sans">
                              Need API keys? Check <code className="text-white/70">docs/WOO.md</code> in the project for instructions.
                            </p>
                          </div>
                        )}

                        {wizardStep === 2 && (
                          <div className="space-y-4 text-center py-4">
                            <ShieldCheck className="h-12 w-12 text-[#7F54B3] mx-auto" />
                            <div className="space-y-1.5">
                              <h5 className="text-base font-bold text-white font-sans">
                                {wooStoreName ? `Connected: ${wooStoreName}` : 'WooCommerce connected'}
                              </h5>
                              <p className="text-xs text-white/60 max-w-sm mx-auto leading-relaxed font-sans">
                                Sync products, categories, SKUs, and stock levels from your WooCommerce store into ShopMate AI.
                              </p>
                            </div>

                            {wooError && (
                              <div className="status-danger text-xs p-3 rounded-xl font-sans text-center">
                                {wooError}
                              </div>
                            )}

                            {wooSyncResult && (
                              <div className="zone-b-grey2 p-3.5 rounded-xl text-xs text-white/70 font-sans space-y-1">
                                <div>{wooSyncResult.total} product(s) found on WooCommerce</div>
                                <div>{wooSyncResult.created} added, {wooSyncResult.updated} updated in your catalog</div>
                              </div>
                            )}

                            <button 
                              onClick={handleWooCommerceSync}
                              disabled={isSyncingWoo}
                              className="w-full btn-light-primary py-3 text-xs font-bold cursor-pointer disabled:opacity-50"
                            >
                              {isSyncingWoo ? 'Syncing Catalog…' : 'Sync products now'}
                            </button>
                            <button
                              onClick={async () => { await handleWooCommerceDisconnect(); setActiveWizardId(null); }}
                              className="w-full btn-glass py-2.5 text-xs font-bold cursor-pointer"
                            >
                              Disconnect store
                            </button>
                            <button
                              onClick={() => setActiveWizardId(null)}
                              className="w-full text-xs text-white/50 hover:text-white transition-colors cursor-pointer font-sans"
                            >
                              Return to integrations
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {activeWizardId === 'int-widget' && (
                      <div className="space-y-4">
                        {wizardStep === 1 && (
                          <div className="space-y-4 text-center py-2">
                            <Code2 className="h-10 w-10 text-emerald-400 mx-auto" />
                            <div className="space-y-1.5">
                              <h5 className="text-base font-bold text-white font-sans">Enable the website chat widget</h5>
                              <p className="text-xs text-white/60 leading-relaxed max-w-sm mx-auto font-sans">
                                No OAuth, no tokens — enabling generates a unique embed snippet you paste onto your own site. Visitors get a live AI chat bubble instantly.
                              </p>
                            </div>

                            {widgetError && (
                              <div className="status-danger text-xs p-3 rounded-xl text-center font-sans">
                                {widgetError}
                              </div>
                            )}

                            <button
                              onClick={handleWidgetConnect}
                              disabled={isConnectingWidget}
                              className="w-full btn-accent py-3 text-xs font-bold cursor-pointer disabled:opacity-50"
                            >
                              {isConnectingWidget ? 'Enabling…' : 'Enable website widget'}
                            </button>
                          </div>
                        )}

                        {wizardStep === 2 && (
                          <div className="space-y-4 text-center py-2">
                            <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
                            <div className="space-y-1.5">
                              <h5 className="text-base font-bold text-white font-sans">Widget enabled</h5>
                              <p className="text-xs text-white/60 max-w-sm mx-auto leading-relaxed font-sans">
                                Paste this snippet just before the closing <code className="text-white/80">&lt;/body&gt;</code> tag of your website.
                              </p>
                            </div>

                            {widgetError && (
                              <div className="status-danger text-xs p-3 rounded-xl text-center font-sans">
                                {widgetError}
                              </div>
                            )}

                            <div className="zone-b-grey2 p-3.5 rounded-xl text-left">
                              <code className="text-[11px] text-white/80 font-mono break-all leading-relaxed block">
                                {widgetEmbedSnippet}
                              </code>
                            </div>

                            <button
                              onClick={handleCopyWidgetSnippet}
                              disabled={!widgetEmbedSnippet}
                              className="w-full btn-light-primary py-3 text-xs font-bold cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              {widgetCodeCopied ? 'Copied!' : 'Copy embed code'}
                            </button>
                            <button
                              onClick={async () => { await handleWidgetDisconnect(); setActiveWizardId(null); }}
                              className="w-full btn-glass py-2.5 text-xs font-bold cursor-pointer"
                            >
                              Disable widget
                            </button>
                            <button
                              onClick={() => setActiveWizardId(null)}
                              className="w-full text-xs text-white/50 hover:text-white transition-colors cursor-pointer font-sans"
                            >
                              Return to integrations
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* WhatsApp QR pairing */}
      <AnimatePresence>
        {showWhatsAppQr && <WhatsAppQrModal onClose={() => setShowWhatsAppQr(false)} onConnected={refreshChannelsStatus} />}
      </AnimatePresence>

      {/* Facebook multi-Page picker */}
      <AnimatePresence>
        {fbPendingToken && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="zone-b-grey3 border border-white/20 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col text-left"
            >
              <header className="p-5 border-b border-white/[0.07] bg-black/40 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-[#1877F2]/15 border border-[#1877F2]/30 rounded-xl">
                    <Facebook className="h-5 w-5 text-[#1877F2]" />
                  </div>
                  <div>
                    <h4 className="font-sans font-bold text-base text-white">Select a Facebook page</h4>
                    <p className="text-xs text-white/50 mt-0.5">
                      Multiple pages detected
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setFbPendingToken(null); setFbPendingPages([]); }}
                  className="text-white/40 hover:text-white transition-colors cursor-pointer p-1"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>

              <div className="p-6 space-y-3">
                <p className="text-xs text-white/60 leading-relaxed font-sans">
                  Choose which Facebook page Remlin should connect to:
                </p>
                {fbPendingPages.map((page) => (
                  <button
                    key={page.id}
                    onClick={() => handleSelectFacebookPage(page.id)}
                    disabled={isSelectingPage}
                    className="w-full p-3.5 text-left border rounded-xl flex justify-between items-center transition-all zone-b-grey2 hover:border-white/30 cursor-pointer disabled:opacity-50"
                  >
                    <span className="text-xs text-white font-sans font-bold">{page.name}</span>
                    <ChevronRight className="h-4 w-4 text-white/40" />
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* WhatsApp multi-number picker */}
      <AnimatePresence>
        {waPendingToken && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="zone-b-grey3 border border-white/20 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col text-left"
            >
              <header className="p-5 border-b border-white/[0.07] bg-black/40 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-500/15 border border-emerald-500/30 rounded-xl">
                    <MessageSquare className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="font-sans font-bold text-base text-white">Select a WhatsApp number</h4>
                    <p className="text-xs text-white/50 mt-0.5">
                      Multiple numbers detected
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setWaPendingToken(null); setWaPendingNumbers([]); }}
                  className="text-white/40 hover:text-white transition-colors cursor-pointer p-1"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>

              <div className="p-6 space-y-3">
                <p className="text-xs text-white/60 leading-relaxed font-sans">
                  Choose which WhatsApp Business number Remlin should connect to:
                </p>
                {waError && (
                  <div className="status-danger text-xs p-3 rounded-xl font-sans">
                    {waError}
                  </div>
                )}
                {waPendingNumbers.map((num) => (
                  <button
                    key={num.id}
                    onClick={() => handleSelectWhatsAppNumber(num.id)}
                    disabled={isSelectingWa}
                    className="w-full p-3.5 text-left border rounded-xl flex justify-between items-center transition-all zone-b-grey2 hover:border-emerald-500/40 cursor-pointer disabled:opacity-50"
                  >
                    <div>
                      <span className="text-xs text-white font-sans font-bold block">{num.display_phone_number}</span>
                      {num.name && <span className="text-[11px] text-white/50 font-sans">{num.name}</span>}
                    </div>
                    <ChevronRight className="h-4 w-4 text-white/40 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CSV / Excel import: choose file → progress */}
      <AnimatePresence>
        {uploadStep !== 'closed' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-upload-title"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 25, stiffness: 240 }}
              className="zone-b-grey3 border border-white/20 w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4"
            >
              {uploadStep === 'select' ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 id="catalog-upload-title" className="font-sans font-bold text-white text-[16px]">Upload product sheet</h3>
                      <p className="text-[12px] text-white/50 font-sans mt-1">CSV or Excel (.xlsx), first row as column headers.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUploadStep('closed')}
                      className="text-white/40 hover:text-white p-1 rounded-lg hover:bg-white/10 cursor-pointer"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <input
                    ref={uploadInputRef}
                    type="file"
                    accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={(e) => {
                      setUploadFile(e.target.files?.[0] || null);
                      setUploadError('');
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => uploadInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-white/20 hover:border-white/40 rounded-xl p-5 flex flex-col items-center gap-2 cursor-pointer transition-colors bg-white/[0.03]"
                  >
                    <FileSpreadsheet className="h-7 w-7 text-blue-400" />
                    {uploadFile ? (
                      <>
                        <span className="text-[13px] font-sans font-semibold text-white break-all">{uploadFile.name}</span>
                        <span className="text-[11px] text-white/40 font-sans">
                          {(uploadFile.size / 1024).toFixed(uploadFile.size < 102_400 ? 1 : 0)} KB · click to choose another file
                        </span>
                      </>
                    ) : (
                      <span className="text-[13px] font-sans font-bold text-white">Browse files</span>
                    )}
                  </button>

                  {uploadError && (
                    <div className="status-danger text-[11px] p-2.5 rounded-xl font-sans">{uploadError}</div>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setUploadStep('closed')}
                      className="flex-1 py-2.5 text-xs font-bold font-sans text-white/60 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleImportConfirm}
                      disabled={!uploadFile}
                      className="flex-1 btn-light-primary py-2.5 text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Confirm & import
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center space-y-4 py-2">
                  <RefreshCw className="h-7 w-7 text-blue-400 animate-spin mx-auto" />
                  <div className="space-y-1">
                    <h3 id="catalog-upload-title" className="font-sans font-bold text-white text-[16px]">
                      {importProgress.total === 0 ? 'Reading file…' : 'Loading products…'}
                    </h3>
                    {importProgress.total > 0 && (
                      <p className="text-[13px] text-white/60 font-sans">
                        {importProgress.processed} of {importProgress.total} processed · {importProgress.created} loaded
                      </p>
                    )}
                  </div>
                  <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-400 rounded-full transition-all duration-300"
                      style={{ width: `${importProgress.total ? Math.round((importProgress.processed / importProgress.total) * 100) : 5}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-white/35 font-sans">Please keep this page open until the import finishes.</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Catalog loaded confirmation */}
      <AnimatePresence>
        {catalogLoaded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-loaded-title"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 25, stiffness: 240 }}
              className="zone-b-grey3 border border-white/20 w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center space-y-4"
            >
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              </div>
              <div className="space-y-1.5">
                <h3 id="catalog-loaded-title" className="font-sans font-bold text-white text-[16px]">Done!</h3>
                <p className="text-[13px] text-white/60 font-sans leading-relaxed">
                  {catalogLoaded.total} product{catalogLoaded.total === 1 ? '' : 's'} from {catalogLoaded.source}{' '}
                  {catalogLoaded.total === 1 ? 'is' : 'are'} now loaded in your product catalog.
                </p>
                {(catalogLoaded.updated !== undefined || catalogLoaded.skipped !== undefined) && (
                  <p className="text-[11px] text-white/40 font-sans">
                    {catalogLoaded.created ?? 0} new
                    {catalogLoaded.updated !== undefined && ` · ${catalogLoaded.updated} updated`}
                    {!!catalogLoaded.skipped && ` · ${catalogLoaded.skipped} skipped (already in catalog or invalid)`}
                  </p>
                )}
              </div>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setCatalogLoaded(null);
                  setActiveWizardId(null);
                  onGoToCatalog();
                }}
                className="w-full btn-light-primary py-2.5 text-xs font-bold cursor-pointer"
              >
                OK
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
