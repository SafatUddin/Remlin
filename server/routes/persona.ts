import express from 'express';
import { prisma } from '../db';
import { requireAuth, AuthedRequest } from '../auth';
import { requireProfileComplete } from '../profileCompletion';
import { validatePersonaInput } from '../inputValidation';
import { openingImageUpload, saveOpeningImageFile, deleteOpeningImageFile } from '../mediaStorage';

export function createPersonaRouter(): express.Router {
  const router = express.Router();

  // Get this store's AI persona
  router.get('/api/persona', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const store = await prisma.store.findUnique({ where: { id: req.auth!.storeId } });
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }
      res.json({
        tone: store.tone,
        style: store.style,
        customInstructions: store.customInstructions,
        autoFinalizeOrdersAlways: store.autoFinalizeOrdersAlways,
        openingText: store.openingText || '',
        openingImageUrl: store.openingImageUrl || undefined,
        shareBusinessInfo: store.shareBusinessInfo,
      });
    } catch (err: any) {
      console.error('Fetch persona error:', err);
      res.status(500).json({ error: 'Failed to load persona' });
    }
  });

  // Update this store's AI persona
  router.put('/api/persona', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      console.log('[PERSONA UPDATE] Request body:', JSON.stringify(req.body, null, 2));
      const validated = validatePersonaInput(req.body);
      if (!validated) {
        console.error('[PERSONA UPDATE] Validation failed for body:', req.body);
        return res.status(400).json({ error: 'Invalid request. Please check all required fields.' });
      }
      console.log('[PERSONA UPDATE] Validated data:', JSON.stringify(validated, null, 2));
      const store = await prisma.store.update({
        where: { id: req.auth!.storeId },
        data: {
          tone: validated.tone,
          style: validated.style,
          customInstructions: validated.customInstructions,
          autoFinalizeOrdersAlways: validated.autoFinalizeOrdersAlways,
          openingText: validated.openingText,
          shareBusinessInfo: validated.shareBusinessInfo,
        },
      });
      res.json({
        tone: store.tone,
        style: store.style,
        customInstructions: store.customInstructions,
        autoFinalizeOrdersAlways: store.autoFinalizeOrdersAlways,
        openingText: store.openingText || '',
        openingImageUrl: store.openingImageUrl || undefined,
        shareBusinessInfo: store.shareBusinessInfo,
      });
    } catch (err: any) {
      console.error('Update persona error:', err);
      res.status(500).json({ error: 'Failed to update persona' });
    }
  });

  // Upload the opening-greeting photo (multipart/form-data, field: "image")
  router.post('/api/persona/opening-image', requireAuth, requireProfileComplete, openingImageUpload.single('image'), async (req: AuthedRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
      }
      const storeId = req.auth!.storeId;
      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }
      const previousImageUrl = store.openingImageUrl;
      let publicUrl: string;
      try {
        publicUrl = await saveOpeningImageFile(storeId, req.file.buffer);
      } catch {
        return res.status(400).json({ error: 'Unsupported image format. Use JPEG, PNG, WebP, or GIF.' });
      }
      const updated = await prisma.store.update({ where: { id: storeId }, data: { openingImageUrl: publicUrl } });
      await deleteOpeningImageFile(storeId, previousImageUrl);
      res.json({ openingImageUrl: updated.openingImageUrl || undefined });
    } catch (err: any) {
      console.error('Opening image upload error');
      res.status(500).json({ error: 'Failed to upload greeting image' });
    }
  });

  // Remove the opening-greeting photo
  router.delete('/api/persona/opening-image', requireAuth, requireProfileComplete, async (req: AuthedRequest, res) => {
    try {
      const storeId = req.auth!.storeId;
      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }
      const previousImageUrl = store.openingImageUrl;
      await prisma.store.update({ where: { id: storeId }, data: { openingImageUrl: null } });
      await deleteOpeningImageFile(storeId, previousImageUrl);
      res.json({ openingImageUrl: undefined });
    } catch (err: any) {
      console.error('Opening image delete error');
      res.status(500).json({ error: 'Failed to remove greeting image' });
    }
  });

  return router;
}
