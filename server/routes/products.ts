import express from 'express';
import { prisma } from '../db';
import { requireAuth, AuthedRequest } from '../auth';
import { requireProfileComplete } from '../profileCompletion';
import { validateProductInput } from '../inputValidation';
import { productImageUpload, saveProductImageFile, deleteProductImageFile } from '../mediaStorage';
import { getCatalogSource } from '../catalogSource';
import { normalizeProductImageLink, resolveProductImageUrl } from '../../shared/productImage';
import { resolveProductName } from '../../shared/catalogColumns';

const MAX_BULK_DELETE = 1000;
const MAX_BULK_CREATE = 500;

const toPublicProduct = (p: { id: string; name: string; sku: string; price: any; inventory: number; status: string; description?: string | null; imageUrl?: string | null; rawAttributes?: any }) => {
  const imageUrl = resolveProductImageUrl(p);
  return {
    id: p.id,
    name: resolveProductName(p),
    sku: p.sku,
    price: Number(p.price),
    inventory: p.inventory,
    status: p.status === 'TRAINED' ? 'Trained' : 'Pending',
    description: p.description || undefined,
    imageUrl,
    imageSource: imageUrl ? (p.imageUrl ? 'stored' : 'attribute') : undefined,
    rawAttributes: (p.rawAttributes && typeof p.rawAttributes === 'object') ? p.rawAttributes : undefined,
  };
};

export function createProductsRouter(): express.Router {
  const router = express.Router();

  // List this merchant's products & catalog source info
  router.get('/api/products', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const [products, channels] = await Promise.all([
        prisma.product.findMany({
          where: { storeId: req.auth!.storeId },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.channel.findMany({
          where: { storeId: req.auth!.storeId, connected: true },
          select: { type: true },
        }),
      ]);

      const connectedTypes = channels.map(c => c.type);
      const isWebsiteConnected = connectedTypes.includes('SHOPIFY') || connectedTypes.includes('WOOCOMMERCE');

      res.json({
        products: products.map(toPublicProduct),
        isWebsiteConnected,
        connectedChannels: connectedTypes,
        catalogSource: await getCatalogSource(req.auth!.storeId),
      });
    } catch (err: any) {
      console.error('List products error:', err);
      res.status(500).json({ error: 'Failed to load products' });
    }
  });

  // Add a product to this merchant's catalog
  router.post('/api/products', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const validated = validateProductInput(req.body);
      if (!validated) {
        return res.status(400).json({ error: 'Invalid product data.' });
      }

      const catalogSource = await getCatalogSource(req.auth!.storeId);
      if (catalogSource !== 'CUSTOM' && req.body.catalogSource !== catalogSource) {
        return res.status(409).json({ error: `Catalog is managed by ${catalogSource}. Select Custom before adding products manually.` });
      }

      const existing = await prisma.product.findUnique({
        where: { storeId_sku: { storeId: req.auth!.storeId, sku: validated.sku } },
      });
      if (existing) {
        return res.status(409).json({ error: 'A product with this SKU already exists' });
      }

      const rawAttributes = req.body.rawAttributes && typeof req.body.rawAttributes === 'object' ? req.body.rawAttributes : undefined;

      const product = await prisma.product.create({
        data: {
          storeId: req.auth!.storeId,
          name: validated.name,
          sku: validated.sku,
          price: validated.price,
          inventory: validated.inventory,
          status: validated.status,
          ...(validated.description !== undefined ? { description: validated.description } : {}),
          ...(rawAttributes !== undefined ? { rawAttributes } : {}),
        },
      });
      res.status(201).json(toPublicProduct(product));
    } catch (err: any) {
      console.error('Create product error:', err);
      res.status(500).json({ error: 'Unable to process request' });
    }
  });

  // Bulk-create products from a spreadsheet import (JSON body: { products: [...], catalogSource }).
  // Rows with invalid data are skipped; rows whose SKU already exists are left untouched.
  router.post('/api/products/bulk', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const rows = req.body?.products;
      if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_BULK_CREATE) {
        return res.status(400).json({ error: `Provide between 1 and ${MAX_BULK_CREATE} products.` });
      }

      const storeId = req.auth!.storeId;
      const catalogSource = await getCatalogSource(storeId);
      if (catalogSource !== 'CUSTOM' && req.body.catalogSource !== catalogSource) {
        return res.status(409).json({ error: `Catalog is managed by ${catalogSource}. Select Custom before adding products manually.` });
      }

      let invalid = 0;
      const data = rows.flatMap((row: any) => {
        const validated = validateProductInput(row);
        if (!validated) {
          invalid++;
          return [];
        }
        const rawAttributes = row.rawAttributes && typeof row.rawAttributes === 'object' && !Array.isArray(row.rawAttributes) ? row.rawAttributes : undefined;
        return [{
          storeId,
          name: validated.name,
          sku: validated.sku,
          price: validated.price,
          inventory: validated.inventory,
          status: validated.status,
          ...(validated.description !== undefined ? { description: validated.description } : {}),
          ...(rawAttributes !== undefined ? { rawAttributes } : {}),
        }];
      });

      const { count } = data.length > 0
        ? await prisma.product.createMany({ data, skipDuplicates: true })
        : { count: 0 };
      res.status(201).json({ created: count, skipped: data.length - count, invalid });
    } catch (err: any) {
      console.error('Bulk create products error:', err);
      res.status(500).json({ error: 'Unable to import products' });
    }
  });

  router.patch('/api/products/:id', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const existingProduct = await prisma.product.findUnique({ where: { id: req.params.id } });
      if (!existingProduct || existingProduct.storeId !== req.auth!.storeId) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const validated = validateProductInput(req.body);
      if (!validated) {
        return res.status(400).json({ error: 'Invalid product data.' });
      }

      if (validated.sku !== existingProduct.sku) {
        const conflict = await prisma.product.findUnique({
          where: { storeId_sku: { storeId: req.auth!.storeId, sku: validated.sku } },
        });
        if (conflict) {
          return res.status(409).json({ error: 'A product with this SKU already exists' });
        }
      }

      const rawAttributes = req.body.rawAttributes && typeof req.body.rawAttributes === 'object' ? req.body.rawAttributes : undefined;

      const updated = await prisma.product.update({
        where: { id: existingProduct.id },
        data: {
          name: validated.name,
          sku: validated.sku,
          price: validated.price,
          inventory: validated.inventory,
          status: validated.status,
          description: validated.description ?? null,
          ...(rawAttributes !== undefined ? { rawAttributes } : {}),
        },
      });
      res.json(toPublicProduct(updated));
    } catch (err: any) {
      console.error('Update product error:', err);
      res.status(500).json({ error: 'Unable to process request' });
    }
  });

  // Upload a product photo (multipart/form-data, field: "image")
  router.post('/api/products/:id/image', requireAuth, requireProfileComplete, productImageUpload.single('image'), async (req: AuthedRequest, res) => {
    try {
      const product = await prisma.product.findUnique({ where: { id: req.params.id } });
      if (!product || product.storeId !== req.auth!.storeId) {
        return res.status(404).json({ error: 'Product not found' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
      }

      const storeId = req.auth!.storeId;
      const previousImageUrl = product.imageUrl;

      let publicUrl: string;
      try {
        publicUrl = await saveProductImageFile(storeId, req.file.buffer);
      } catch {
        return res.status(400).json({ error: 'Unsupported image format. Use JPEG, PNG, WebP, or GIF.' });
      }

      const updated = await prisma.product.update({
        where: { id: product.id },
        data: { imageUrl: publicUrl },
      });

      await deleteProductImageFile(storeId, previousImageUrl);

      res.json(toPublicProduct(updated));
    } catch (err: any) {
      console.error('Product image upload error');
      res.status(500).json({ error: 'Failed to upload product image' });
    }
  });

  // Set a product photo from an external https link (JSON body: { imageUrl })
  router.put('/api/products/:id/image-url', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const product = await prisma.product.findUnique({ where: { id: req.params.id } });
      if (!product || product.storeId !== req.auth!.storeId) {
        return res.status(404).json({ error: 'Product not found' });
      }
      const imageUrl = normalizeProductImageLink(req.body?.imageUrl);
      if (!imageUrl) {
        return res.status(400).json({ error: 'Enter a valid public https:// image link.' });
      }
      const previousImageUrl = product.imageUrl;
      const updated = await prisma.product.update({
        where: { id: product.id },
        data: { imageUrl },
      });
      if (previousImageUrl !== imageUrl) await deleteProductImageFile(req.auth!.storeId, previousImageUrl);
      res.json(toPublicProduct(updated));
    } catch (err: any) {
      console.error('Product image link error');
      res.status(500).json({ error: 'Failed to save product image link' });
    }
  });

  // Remove a product's photo
  router.delete('/api/products/:id/image', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const product = await prisma.product.findUnique({ where: { id: req.params.id } });
      if (!product || product.storeId !== req.auth!.storeId) {
        return res.status(404).json({ error: 'Product not found' });
      }
      const previousImageUrl = product.imageUrl;
      const updated = await prisma.product.update({
        where: { id: product.id },
        data: { imageUrl: null },
      });
      await deleteProductImageFile(req.auth!.storeId, previousImageUrl);
      res.json(toPublicProduct(updated));
    } catch (err: any) {
      console.error('Product image delete error');
      res.status(500).json({ error: 'Failed to remove product image' });
    }
  });

  // Remove several products at once (JSON body: { ids: string[] })
  router.post('/api/products/bulk-delete', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const rawIds = req.body?.ids;
      if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > MAX_BULK_DELETE || !rawIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64)) {
        return res.status(400).json({ error: `Provide between 1 and ${MAX_BULK_DELETE} product ids.` });
      }
      const storeId = req.auth!.storeId;
      const products = await prisma.product.findMany({
        where: { storeId, id: { in: Array.from(new Set(rawIds as string[])) } },
        select: { id: true, imageUrl: true },
      });
      const ids = products.map((p) => p.id);
      if (ids.length > 0) {
        await prisma.product.deleteMany({ where: { storeId, id: { in: ids } } });
        await Promise.all(products.map((p) => deleteProductImageFile(storeId, p.imageUrl)));
      }
      res.json({ deletedIds: ids });
    } catch (err: any) {
      console.error('Bulk delete products error:', err);
      res.status(500).json({ error: 'Failed to delete products' });
    }
  });

  // Remove a product from this merchant's catalog
  router.delete('/api/products/:id', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const product = await prisma.product.findUnique({ where: { id: req.params.id } });
      if (!product || product.storeId !== req.auth!.storeId) {
        return res.status(404).json({ error: 'Product not found' });
      }
      await prisma.product.delete({ where: { id: product.id } });
      await deleteProductImageFile(req.auth!.storeId, product.imageUrl);
      res.status(204).end();
    } catch (err: any) {
      console.error('Delete product error:', err);
      res.status(500).json({ error: 'Failed to delete product' });
    }
  });

  return router;
}
