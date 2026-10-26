import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Package,
  Plus,
  Trash2,
  Pencil,
  CheckCircle,
  AlertCircle,
  X,
  ImagePlus,
  ImageOff,
  Link2,
  Eye
} from 'lucide-react';
import { Product } from '../types';
import DashboardHeader from './DashboardHeader';
import { getProductImageCandidates, normalizeProductImageLink } from '../../shared/productImage';
import { CURRENCY_ATTRIBUTE_KEY, formatProductPrice, getCatalogCurrency, getProductCurrency, isCurrencyKey } from '../../shared/currency';

const STANDARD_COLUMN_KEYS = new Set([
  'name', 'title', 'productname', 'producttitle',
  'description', 'desc', 'productdescription',
  'sku', 'price', 'inventory', 'stock', 'quantity', 'qty',
]);

interface ProductCatalogProps {
  products: Product[];
  isWebsiteConnected?: boolean;
  onAddProduct: (product: Omit<Product, 'id'>) => Promise<Product>;
  onEditProduct: (id: string, updates: Omit<Product, 'id' | 'imageUrl' | 'imageSource'>) => Promise<Product>;
  onDeleteProducts: (ids: string[]) => Promise<void>;
  onUploadProductImage: (id: string, file: File) => Promise<void>;
  onSetProductImageUrl: (id: string, imageUrl: string) => Promise<void>;
  onDeleteProductImage: (id: string) => Promise<void>;
}

/** Renders the first product image that actually loads, falling back through image-like columns. */
function ProductImage({ product, className }: { product: Product; className?: string }) {
  const candidates = React.useMemo(() => getProductImageCandidates(product), [product]);
  const [index, setIndex] = useState(0);
  const candidatesKey = candidates.join('\n');

  React.useEffect(() => setIndex(0), [candidatesKey]);

  const src = candidates[index];
  if (!src) return <ImagePlus className="h-5 w-5 text-white/30" />;
  return (
    <img
      src={src}
      alt={product.name}
      className={className}
      referrerPolicy="no-referrer"
      onError={() => setIndex((i) => i + 1)}
    />
  );
}

export default function ProductCatalog({
  products,
  isWebsiteConnected = false,
  onAddProduct,
  onEditProduct,
  onDeleteProducts,
  onUploadProductImage,
  onSetProductImageUrl,
  onDeleteProductImage
}: ProductCatalogProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [newProductName, setNewProductName] = useState('');
  const [newProductSku, setNewProductSku] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductInventory, setNewProductInventory] = useState('');
  const [newProductDescription, setNewProductDescription] = useState('');
  const [newProductCurrency, setNewProductCurrency] = useState('');
  const [newProductImageFile, setNewProductImageFile] = useState<File | null>(null);
  const [newProductImagePreview, setNewProductImagePreview] = useState<string | null>(null);
  const [newProductImageLink, setNewProductImageLink] = useState('');
  const [linkPreviewFailed, setLinkPreviewFailed] = useState(false);

  const [addProductError, setAddProductError] = useState('');
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [uploadingImageId, setUploadingImageId] = useState<string | null>(null);
  const [imageError, setImageError] = useState('');
  const [imageMenu, setImageMenu] = useState<{ productId: string; top: number; left: number } | null>(null);
  const [viewingProductId, setViewingProductId] = useState<string | null>(null);
  const imageMenuRef = React.useRef<HTMLDivElement>(null);
  const changeImageInputRef = React.useRef<HTMLInputElement>(null);
  const changeImageTargetRef = React.useRef<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Drop selections for products that no longer exist
  React.useEffect(() => {
    setSelectedIds((prev) => {
      const existing = new Set(products.map((p) => p.id));
      const next = new Set([...prev].filter((id) => existing.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [products]);

  React.useEffect(() => {
    if (selectedIds.size === 0) setConfirmBulkDelete(false);
  }, [selectedIds]);

  // Collect all unique dynamic attribute keys present across products (skipping ones that
  // duplicate the fixed Name / Description / SKU / Price / Inventory columns)
  const dynamicAttributeKeys = React.useMemo(() => {
    const keysSet = new Set<string>();
    products.forEach((p) => {
      if (p.rawAttributes && typeof p.rawAttributes === 'object') {
        Object.keys(p.rawAttributes).forEach((key) => {
          const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
          if (
            p.rawAttributes![key] !== undefined &&
            p.rawAttributes![key] !== null &&
            !STANDARD_COLUMN_KEYS.has(normalized)
          ) {
            keysSet.add(key);
          }
        });
      }
    });
    return Array.from(keysSet);
  }, [products]);

  const showDescriptionColumn = products.some((p) => p.description && p.description.trim());
  const totalColumns = 6 + (showDescriptionColumn ? 1 : 0) + dynamicAttributeKeys.length;

  const defaultCurrency = React.useMemo(() => getCatalogCurrency(products) || '', [products]);

  const filteredProducts = products.filter(p => {
    const searchLower = searchTerm.toLowerCase();
    const matchesStandard = (
      p.name.toLowerCase().includes(searchLower) ||
      p.sku.toLowerCase().includes(searchLower) ||
      (p.description && p.description.toLowerCase().includes(searchLower))
    );
    if (matchesStandard) return true;

    // Check dynamic raw attributes
    if (p.rawAttributes && typeof p.rawAttributes === 'object') {
      return Object.values(p.rawAttributes).some(val =>
        String(val).toLowerCase().includes(searchLower)
      );
    }
    return false;
  });

  const allFilteredSelected = filteredProducts.length > 0 && filteredProducts.every((p) => selectedIds.has(p.id));
  const someFilteredSelected = filteredProducts.some((p) => selectedIds.has(p.id));
  const selectAllRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
  }, [someFilteredSelected, allFilteredSelected]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredProducts.forEach((p) => (allFilteredSelected ? next.delete(p.id) : next.add(p.id)));
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (!confirmBulkDelete) {
      setConfirmBulkDelete(true);
      return;
    }
    setDeleteError('');
    setIsBulkDeleting(true);
    try {
      await onDeleteProducts([...selectedIds]);
      setSelectedIds(new Set());
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete selected products.');
    } finally {
      setIsBulkDeleting(false);
      setConfirmBulkDelete(false);
    }
  };

  const editingProduct = editingProductId ? products.find((p) => p.id === editingProductId) : undefined;
  const trimmedImageLink = newProductImageLink.trim();
  const normalizedImageLink = trimmedImageLink ? normalizeProductImageLink(trimmedImageLink) : null;
  const formPreviewSrc = newProductImagePreview || (normalizedImageLink && !linkPreviewFailed ? normalizedImageLink : null);

  const resetProductForm = () => {
    setNewProductName('');
    setNewProductSku('');
    setNewProductPrice('');
    setNewProductInventory('');
    setNewProductDescription('');
    setNewProductCurrency('');
    setNewProductImageFile(null);
    setNewProductImagePreview(null);
    setNewProductImageLink('');
    setLinkPreviewFailed(false);
    setEditingProductId(null);
    setShowAddForm(false);
  };

  const openAddForm = () => {
    resetProductForm();
    setNewProductCurrency(defaultCurrency);
    setAddProductError('');
    setShowAddForm(true);
  };

  const handleEditClick = (product: Product) => {
    setEditingProductId(product.id);
    setNewProductName(product.name);
    setNewProductSku(product.sku);
    setNewProductPrice(String(product.price));
    setNewProductInventory(String(product.inventory));
    setNewProductDescription(product.description || '');
    setNewProductCurrency(getProductCurrency(product.rawAttributes) || '');
    setNewProductImageFile(null);
    setNewProductImagePreview(null);
    setNewProductImageLink('');
    setLinkPreviewFailed(false);
    setAddProductError('');
    setShowAddForm(true);
  };

  const handleAddProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName || !newProductSku || !newProductPrice) return;
    if (!newProductImageFile && trimmedImageLink && !normalizedImageLink) {
      setAddProductError('Image link must be a public https:// URL.');
      return;
    }

    setAddProductError('');
    setIsAddingProduct(true);
    try {
      // Currency lives in rawAttributes; replace any existing currency column with the form value
      const currency = newProductCurrency.trim();
      const rawAttributes: Record<string, any> = Object.fromEntries(
        Object.entries(editingProduct?.rawAttributes || {}).filter(([key]) => !isCurrencyKey(key))
      );
      if (currency) rawAttributes[CURRENCY_ATTRIBUTE_KEY] = currency;
      const productFields = {
        name: newProductName,
        sku: newProductSku,
        price: parseFloat(newProductPrice) || 0.0,
        inventory: parseInt(newProductInventory) || 0,
        description: newProductDescription.trim() || undefined,
        status: 'Trained' as const,
        rawAttributes: editingProductId || currency ? rawAttributes : undefined
      };
      const productId = editingProductId
        ? (await onEditProduct(editingProductId, productFields)).id
        : (await onAddProduct(productFields)).id;

      if (newProductImageFile || normalizedImageLink) {
        try {
          if (newProductImageFile) await onUploadProductImage(productId, newProductImageFile);
          else await onSetProductImageUrl(productId, normalizedImageLink!);
        } catch (err: any) {
          setImageError(err.message || 'Product was saved, but the photo failed to save.');
        }
      }

      resetProductForm();
    } catch (err: any) {
      setAddProductError(err.message || (editingProductId ? 'Failed to save changes.' : 'Failed to add product.'));
    } finally {
      setIsAddingProduct(false);
    }
  };

  const handleNewProductImageSelect = (file: File | undefined) => {
    if (!file) {
      setNewProductImageFile(null);
      setNewProductImagePreview(null);
      return;
    }
    setNewProductImageFile(file);
    setNewProductImagePreview(URL.createObjectURL(file));
    setNewProductImageLink('');
    setLinkPreviewFailed(false);
  };

  const handleImageLinkChange = (value: string) => {
    setNewProductImageLink(value);
    setLinkPreviewFailed(false);
    if (value.trim()) {
      setNewProductImageFile(null);
      setNewProductImagePreview(null);
    }
  };

  const openImageMenu = (productId: string, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const menuHeight = 96;
    const top = rect.bottom + 6 + menuHeight > window.innerHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
    setImageMenu((current) => (current?.productId === productId ? null : { productId, top, left: rect.left }));
  };

  const startChangeImage = (productId: string) => {
    setImageMenu(null);
    changeImageTargetRef.current = productId;
    changeImageInputRef.current?.click();
  };

  // Close the image menu on outside click, Escape, scroll or resize; Escape also closes the viewer
  React.useEffect(() => {
    if (!imageMenu && !viewingProductId) return;
    const close = () => setImageMenu(null);
    const onPointerDown = (e: MouseEvent) => {
      if (imageMenuRef.current && !imageMenuRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      setViewingProductId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [imageMenu, viewingProductId]);

  const menuProduct = imageMenu ? products.find((p) => p.id === imageMenu.productId) : undefined;
  const viewingProduct = viewingProductId ? products.find((p) => p.id === viewingProductId) : undefined;

  const handleImageSelect = async (productId: string, file: File | undefined) => {
    if (!file) return;
    setUploadingImageId(productId);
    setImageError('');
    try {
      await onUploadProductImage(productId, file);
    } catch (err: any) {
      setImageError(err.message || 'Failed to upload photo.');
    } finally {
      setUploadingImageId(null);
    }
  };

  const handleImageRemove = async (productId: string) => {
    setUploadingImageId(productId);
    setImageError('');
    try {
      await onDeleteProductImage(productId);
    } catch (err: any) {
      setImageError(err.message || 'Failed to remove photo.');
    } finally {
      setUploadingImageId(null);
    }
  };

  return (
    <div className="w-full flex-grow flex flex-col text-left">
      <DashboardHeader
        searchPlaceholder="Search catalog by name, SKU, description, vendor, tags or custom fields…"
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
      />

      <div className="w-full flex-grow space-y-6 p-6 md:p-8">
        <div className="grid grid-cols-1 gap-6 items-start">

          {/* Product Catalog Box */}
          <div className="zone-b-grey2 p-6 space-y-5">
            <div className="flex justify-between items-center pb-4 border-b border-white/[0.07]">
              <div>
                <h3 className="font-sans font-bold text-[19px] text-white tracking-tight">Product Catalog</h3>
                <p className="text-[13px] text-white/55 mt-0.5">
                  {filteredProducts.length} items verified & dynamically modeled inside AI context
                </p>
              </div>

              {isWebsiteConnected ? (
                <div className="status-success px-3 py-1.5 rounded-full text-xs font-bold font-sans flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" /> Live Website Sync Active
                </div>
              ) : (
                <button
                  onClick={() => (showAddForm ? resetProductForm() : openAddForm())}
                  className="btn-accent px-4 py-2 font-sans font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {showAddForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  {showAddForm ? 'Cancel' : 'Add product'}
                </button>
              )}
            </div>

            {/* Add product modal panel */}
            <AnimatePresence>
              {showAddForm && (
                <motion.form
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  onSubmit={handleAddProductSubmit}
                  className="zone-b-grey3 p-5 rounded-xl space-y-4 border border-white/[0.1] overflow-hidden"
                >
                  <div className="flex justify-between items-center">
                    <h4 className="font-sans font-bold text-sm text-white">
                      {editingProductId ? 'Edit product' : 'Manual product registration'}
                    </h4>
                    <span className="text-[10px] text-white/40 font-mono">MODEL SCHEMA VALIDATION</span>
                  </div>

                  {addProductError && (
                    <div className="status-danger text-xs p-3 rounded-xl font-sans">
                      {addProductError}
                    </div>
                  )}

                  <div className="flex items-start gap-4 py-1">
                    <label
                      className="relative w-16 h-16 rounded-xl border-2 border-dashed border-white/20 hover:border-white/40 flex items-center justify-center cursor-pointer transition-all overflow-hidden group/thumb bg-white/5 shrink-0"
                      title="Upload product photo"
                    >
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          handleNewProductImageSelect(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                      {formPreviewSrc ? (
                        <img
                          src={formPreviewSrc}
                          alt=""
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                          onError={() => !newProductImagePreview && setLinkPreviewFailed(true)}
                        />
                      ) : editingProduct && !trimmedImageLink ? (
                        <ProductImage product={editingProduct} className="w-full h-full object-cover" />
                      ) : (
                        <ImagePlus className="h-5 w-5 text-white/30" />
                      )}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
                        <ImagePlus className="h-4 w-4 text-white" />
                      </div>
                    </label>
                    <div className="flex-grow space-y-1.5 min-w-0">
                      <p className="text-[12px] text-white/60">
                        {editingProductId ? 'Replace product photo (optional)' : 'Optional product photo'} — upload a file or paste an image link
                      </p>
                      <div className="relative">
                        <Link2 className="h-3.5 w-3.5 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="url"
                          inputMode="url"
                          placeholder="https://example.com/product.jpg"
                          value={newProductImageLink}
                          onChange={(e) => handleImageLinkChange(e.target.value)}
                          className="w-full zone-b-input pl-8 pr-3 py-2 text-xs outline-none"
                        />
                      </div>
                      {trimmedImageLink && !normalizedImageLink && (
                        <p className="text-[11px] text-[#ff9d92]">Use a public https:// link to an image.</p>
                      )}
                      {normalizedImageLink && linkPreviewFailed && (
                        <p className="text-[11px] text-amber-300/80">Couldn't preview this link — make sure it points directly to an image.</p>
                      )}
                      {(newProductImagePreview || trimmedImageLink) && (
                        <button
                          type="button"
                          onClick={() => {
                            handleNewProductImageSelect(undefined);
                            handleImageLinkChange('');
                          }}
                          className="text-[11px] text-white/40 hover:text-[#ff9d92] transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <ImageOff className="h-3 w-3" /> Clear photo
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[11px] text-white/60 font-semibold block">Product name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Silk Blazer"
                        value={newProductName}
                        onChange={(e) => setNewProductName(e.target.value)}
                        className="w-full zone-b-input px-3 py-2 text-xs outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-white/60 font-semibold block">SKU number</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. SB-1002"
                        value={newProductSku}
                        onChange={(e) => setNewProductSku(e.target.value)}
                        className="w-full zone-b-input px-3 py-2 text-xs outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-[11px] text-white/60 font-semibold block">Price</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        placeholder="240.00"
                        value={newProductPrice}
                        onChange={(e) => setNewProductPrice(e.target.value)}
                        className="w-full zone-b-input px-3 py-2 text-xs outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-white/60 font-semibold block">Currency (optional)</label>
                      <input
                        type="text"
                        maxLength={10}
                        placeholder="e.g. BDT, USD, ৳, €"
                        value={newProductCurrency}
                        onChange={(e) => setNewProductCurrency(e.target.value)}
                        className="w-full zone-b-input px-3 py-2 text-xs outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-white/60 font-semibold block">Initial inventory level</label>
                      <input
                        type="number"
                        placeholder="50"
                        value={newProductInventory}
                        onChange={(e) => setNewProductInventory(e.target.value)}
                        className="w-full zone-b-input px-3 py-2 text-xs outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-white/60 font-semibold block">Product description & details</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Crafted from 100% mulberry silk with notch lapels and padded shoulders."
                      value={newProductDescription}
                      onChange={(e) => setNewProductDescription(e.target.value)}
                      className="w-full zone-b-input px-3 py-2 text-xs outline-none resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isAddingProduct}
                    className="w-full btn-light-primary py-2.5 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                  >
                    {editingProductId
                      ? (isAddingProduct ? 'Saving…' : 'Save changes')
                      : (isAddingProduct ? 'Indexing…' : 'Confirm & index SKU')}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>

            {deleteError && (
              <div className="status-danger text-xs p-3 rounded-xl text-center font-sans">
                {deleteError}
              </div>
            )}

            {imageError && (
              <div className="status-danger text-xs p-3 rounded-xl text-center font-sans">
                {imageError}
              </div>
            )}

            {selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl border border-white/[0.1] bg-white/[0.04]">
                <span className="text-xs font-sans font-semibold text-white/80">
                  {selectedIds.size} product{selectedIds.size === 1 ? '' : 's'} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (confirmBulkDelete ? setConfirmBulkDelete(false) : setSelectedIds(new Set()))}
                    disabled={isBulkDeleting}
                    className="px-3 py-1.5 text-xs font-sans font-semibold text-white/60 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {confirmBulkDelete ? 'Cancel' : 'Clear selection'}
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkDelete}
                    disabled={isBulkDeleting}
                    className="px-3 py-1.5 text-xs font-sans font-bold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 bg-red-500/15 text-[#ff9d92] border border-red-500/30 hover:bg-red-500/25"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {isBulkDeleting
                      ? 'Deleting…'
                      : confirmBulkDelete
                        ? `Confirm delete ${selectedIds.size}`
                        : 'Delete selected'}
                  </button>
                </div>
              </div>
            )}

            {/* Dynamic Table modeled from fetched info */}
            <div className="border border-white/[0.07] rounded-2xl overflow-hidden bg-black/30 w-full overflow-x-auto">
              <div className="max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 min-w-full">
                <table className="w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr className="bg-white/[0.05] border-b border-white/[0.07] text-[11px] font-sans text-white/50 tracking-[0.11em] font-bold uppercase">
                    <th className="pl-4 pr-0 py-4 w-8">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        disabled={filteredProducts.length === 0}
                        className="h-4 w-4 accent-blue-400 cursor-pointer align-middle"
                        title="Select all"
                        aria-label="Select all products"
                      />
                    </th>
                    <th className="p-4 whitespace-nowrap">Product Name</th>
                    {showDescriptionColumn && <th className="p-4 whitespace-nowrap">Description</th>}
                    <th className="p-4 whitespace-nowrap">SKU</th>
                    <th className="p-4 whitespace-nowrap">Price</th>
                    <th className="p-4 whitespace-nowrap">Inventory</th>
                    {/* Render a column header for every dynamic field detected from website / CSV */}
                    {dynamicAttributeKeys.map((attrKey) => (
                      <th key={attrKey} className="p-4 whitespace-nowrap">
                        {attrKey}
                      </th>
                    ))}
                    <th className="p-4 whitespace-nowrap">AI Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.055] font-sans text-[14px]">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={totalColumns} className="p-8 text-center text-white/40 font-sans text-xs">
                        No matching products indexed in catalog. Connect Shopify or upload an Excel/CSV product sheet to populate.
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((p) => (
                      <tr key={p.id} className={`hover:bg-white/[0.03] transition-colors group ${selectedIds.has(p.id) ? 'bg-white/[0.04]' : ''}`}>
                        <td className="pl-4 pr-0 py-4 w-8 align-top">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(p.id)}
                            onChange={() => toggleSelected(p.id)}
                            className="h-4 w-4 accent-blue-400 cursor-pointer mt-4"
                            aria-label={`Select ${p.name}`}
                          />
                        </td>
                        <td className="p-4 font-sans font-bold text-white">
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              onClick={(e) => openImageMenu(p.id, e.currentTarget)}
                              disabled={uploadingImageId === p.id}
                              className="relative w-12 h-12 rounded-xl overflow-hidden bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0 cursor-pointer group/thumb shadow-sm"
                              title="Product photo options"
                              aria-haspopup="menu"
                              aria-expanded={imageMenu?.productId === p.id}
                            >
                              <ProductImage product={p} className="w-full h-full object-cover" />
                              <div className={`absolute inset-0 bg-black/50 transition-opacity flex items-center justify-center ${
                                uploadingImageId === p.id || imageMenu?.productId === p.id ? 'opacity-100' : 'opacity-0 group-hover/thumb:opacity-100'
                              }`}>
                                {uploadingImageId === p.id ? (
                                  <span className="text-[8px] text-white font-bold">...</span>
                                ) : (
                                  <Eye className="h-4 w-4 text-white" />
                                )}
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleEditClick(p)}
                              className="font-bold text-white text-[14px] leading-snug min-w-[160px] self-center text-left hover:underline underline-offset-2 cursor-pointer inline-flex items-center gap-1.5 group/name"
                              title="Edit product"
                            >
                              {p.name}
                              <Pencil className="h-3 w-3 text-white/30 opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0" />
                            </button>

                            {p.imageUrl && p.imageSource !== 'attribute' && (
                              <button
                                type="button"
                                onClick={() => handleImageRemove(p.id)}
                                disabled={uploadingImageId === p.id}
                                className="text-white/20 hover:text-[#ff9d92] transition-colors cursor-pointer opacity-0 group-hover:opacity-100 disabled:opacity-40 ml-1 mt-0.5"
                                title="Remove product photo"
                              >
                                <ImageOff className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                        {showDescriptionColumn && (
                          <td className="p-4 font-sans">
                            {p.description ? (
                              <p className="text-[12px] text-white/60 line-clamp-2 min-w-[220px] max-w-sm leading-relaxed" title={p.description}>
                                {p.description}
                              </p>
                            ) : (
                              <span className="text-white/20 text-[11px]">—</span>
                            )}
                          </td>
                        )}
                        <td className="p-4 font-mono text-[12px] text-white/60 font-semibold whitespace-nowrap">{p.sku}</td>
                        <td className="p-4 font-sans text-white font-bold whitespace-nowrap">{formatProductPrice(p, defaultCurrency || undefined)}</td>
                        <td className="p-4 font-sans whitespace-nowrap">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            p.inventory > 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}>
                            {p.inventory > 0 ? `${p.inventory} units` : 'Out of Stock'}
                          </span>
                        </td>

                        {/* Render cell for every dynamic attribute detected from website/CSV */}
                        {dynamicAttributeKeys.map((attrKey) => {
                          const attrVal = p.rawAttributes ? p.rawAttributes[attrKey] : undefined;
                          return (
                            <td key={attrKey} className="p-4 text-xs text-white/80 font-sans whitespace-nowrap">
                              {attrVal !== undefined && attrVal !== null ? (
                                <span className="px-2 py-1 bg-white/5 rounded-lg border border-white/10 font-mono text-[11px]">
                                  {String(attrVal)}
                                </span>
                              ) : (
                                <span className="text-white/20 text-[11px]">—</span>
                              )}
                            </td>
                          );
                        })}

                        <td className="p-4 whitespace-nowrap">
                          {p.status === 'Trained' ? (
                            <span className="status-success px-2.5 py-1 text-[11px] font-bold rounded-full inline-flex items-center gap-1.5">
                              <CheckCircle className="h-3 w-3" /> Indexed & Trained
                            </span>
                          ) : (
                            <span className="status-warning px-2.5 py-1 text-[11px] font-bold rounded-full inline-flex items-center gap-1.5">
                              <AlertCircle className="h-3 w-3" /> Pending
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

      {/* Shared hidden file picker for "Change image" */}
      <input
        ref={changeImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const productId = changeImageTargetRef.current;
          const file = e.target.files?.[0];
          e.target.value = '';
          changeImageTargetRef.current = null;
          if (productId) handleImageSelect(productId, file);
        }}
      />

      {/* Product photo options menu */}
      {imageMenu && menuProduct && (
        <div
          ref={imageMenuRef}
          role="menu"
          style={{ top: imageMenu.top, left: imageMenu.left }}
          className="fixed z-50 w-44 zone-b-grey3 border border-white/15 rounded-xl shadow-2xl p-1.5 font-sans text-[12.5px]"
        >
          <button
            type="button"
            role="menuitem"
            disabled={getProductImageCandidates(menuProduct).length === 0}
            onClick={() => {
              setViewingProductId(menuProduct.id);
              setImageMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-white/85 hover:bg-white/10 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <Eye className="h-3.5 w-3.5" /> View image
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => startChangeImage(menuProduct.id)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-white/85 hover:bg-white/10 cursor-pointer"
          >
            <ImagePlus className="h-3.5 w-3.5" /> {getProductImageCandidates(menuProduct).length > 0 ? 'Change image' : 'Add image'}
          </button>
        </div>
      )}

      {/* Full-size image viewer */}
      <AnimatePresence>
        {viewingProduct && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setViewingProductId(null)}
            className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
            role="dialog"
            aria-modal="true"
            aria-label={`${viewingProduct.name} photo`}
          >
            <motion.div
              initial={{ scale: 0.96, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 10 }}
              transition={{ type: 'spring', damping: 26, stiffness: 260 }}
              onClick={(e) => e.stopPropagation()}
              className="zone-b-grey3 border border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-w-[min(92vw,1100px)] max-h-[92vh]"
            >
              <header className="flex items-center justify-between gap-4 px-5 py-3 border-b border-white/[0.08]">
                <div className="min-w-0">
                  <h3 className="font-sans font-bold text-white text-[15px] truncate">{viewingProduct.name}</h3>
                  <p className="font-mono text-[11px] text-white/45">{viewingProduct.sku}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setViewingProductId(null);
                      startChangeImage(viewingProduct.id);
                    }}
                    className="px-3 py-1.5 text-xs font-sans font-semibold text-white/75 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <ImagePlus className="h-3.5 w-3.5" /> Change image
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewingProductId(null)}
                    autoFocus
                    className="text-white/50 hover:text-white p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
                    aria-label="Close image viewer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </header>
              <div className="flex-1 min-h-0 flex items-center justify-center bg-black/40 p-4">
                <ProductImage
                  product={viewingProduct}
                  className="max-w-full max-h-[calc(92vh-90px)] min-w-[min(60vw,480px)] min-h-[min(50vh,360px)] object-contain rounded-lg"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
