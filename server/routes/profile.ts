import express from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { requireAuth, AuthedRequest, establishMerchantSession, isPasswordStrongEnough } from '../auth';
import { getProfileCompletionStatus } from '../profileCompletion';
import { toPublicMerchant, toPublicStore } from '../publicViews';
import {
  validatePhone,
  validateMerchantName,
  validateOnboardingInput,
} from '../inputValidation';
import {
  avatarUpload,
  saveAvatarFile,
  deleteLocalAvatarFile,
  isLocalAvatarUrl,
  MAX_AVATAR_BYTES,
} from '../mediaStorage';

const isProduction = process.env.NODE_ENV === 'production';

export function createProfileRouter(): express.Router {
  const router = express.Router();

  // Current merchant profile, scoped by the JWT
  router.get('/api/me', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const merchant = await prisma.merchant.findUnique({
        where: { id: req.auth!.merchantId },
        include: { store: true },
      });
      if (!merchant || !merchant.store) {
        return res.status(404).json({ error: 'Account not found' });
      }
      const { profileComplete, missingFields } = getProfileCompletionStatus(merchant, merchant.store, req.auth!.isAdmin);
      res.json({
        merchant: toPublicMerchant(merchant),
        store: toPublicStore(merchant.store),
        profileComplete,
        missingFields,
        isAdmin: req.auth!.isAdmin ?? false,
      });
    } catch (err: any) {
      console.error('Fetch profile error:', err);
      res.status(500).json({ error: 'Failed to load profile' });
    }
  });

  // Update personal profile: name, phone, email, and/or password (requires current password to change it)
  router.patch('/api/me', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { name, phone, email, avatarUrl, currentPassword, password } = req.body;
      const merchant = await prisma.merchant.findUnique({ where: { id: req.auth!.merchantId } });
      if (!merchant) {
        return res.status(404).json({ error: 'Account not found' });
      }

      const data: {
        name?: string;
        phone?: string | null;
        email?: string;
        avatarUrl?: string | null;
        passwordHash?: string;
        tokenVersion?: { increment: number };
      } = {};

      if (name !== undefined) {
        const validName = validateMerchantName(name);
        if (validName === null) return res.status(400).json({ error: 'Invalid name.' });
        data.name = validName;
      }

      if (phone !== undefined) {
        const validPhone = validatePhone(phone);
        if (validPhone === null) return res.status(400).json({ error: 'Invalid phone number.' });
        data.phone = validPhone === '' ? null : validPhone;
      }

      if (typeof avatarUrl === 'string') {
        if (avatarUrl === merchant.avatarUrl) {
          // no-op
        } else if (avatarUrl === '') {
          data.avatarUrl = null;
        } else if (!isLocalAvatarUrl(avatarUrl)) {
          // Only a path produced by our own POST /api/me/avatar upload is accepted here —
          // arbitrary external URLs are rejected outright, not just shape-validated. That
          // upload endpoint is the only legitimate way to set an avatar; letting this PATCH
          // accept any https:// URL would let a merchant's own browser be pointed at an
          // attacker-chosen tracking pixel every time their dashboard header renders it.
          return res.status(400).json({ error: 'Invalid avatar URL.' });
        } else {
          data.avatarUrl = avatarUrl;
        }
      }

      if (typeof email === 'string' && email.trim() && email.trim() !== merchant.email) {
        const emailTaken = await prisma.merchant.findUnique({ where: { email: email.trim() } });
        if (emailTaken) {
          return res.status(409).json({ error: 'An account with this email already exists' });
        }
        data.email = email.trim();
      }

      if (password) {
        if (!merchant.passwordHash) {
          return res.status(400).json({ error: 'This account uses Google sign-in and does not have a password' });
        }
        if (!currentPassword) {
          return res.status(400).json({ error: 'Current password is required to set a new password' });
        }
        const valid = await bcrypt.compare(currentPassword, merchant.passwordHash);
        if (!valid) {
          return res.status(401).json({ error: 'Current password is incorrect' });
        }
        if (!isPasswordStrongEnough(password)) {
          return res.status(400).json({ error: 'Invalid request.' });
        }
        data.passwordHash = await bcrypt.hash(password, 12);
        // Bump tokenVersion so all other sessions are invalidated after password change
        data.tokenVersion = { increment: 1 };
      }

      const updated = await prisma.merchant.update({ where: { id: merchant.id }, data });

      // Re-issue session cookie with the new tokenVersion so the current browser stays logged in
      if (data.tokenVersion) {
        establishMerchantSession(res, {
          merchantId: updated.id,
          storeId: req.auth!.storeId,
          tv: updated.tokenVersion,
        });
      }

      const store = await prisma.store.findUnique({
        where: { merchantId: updated.id },
        select: { name: true, businessProfile: true },
      });
      const { profileComplete, missingFields } = store
        ? getProfileCompletionStatus(updated, store, req.auth!.isAdmin)
        : { profileComplete: false, missingFields: ['store'] };

      res.json({ merchant: toPublicMerchant(updated), profileComplete, missingFields });
    } catch (err: any) {
      console.error('Update profile error');
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

  // Upload a new avatar image (multipart/form-data, field: "avatar")
  router.post('/api/me/avatar', requireAuth, avatarUpload.single('avatar'), async (req: AuthedRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
      }
      if (req.file.size > MAX_AVATAR_BYTES) {
        return res.status(400).json({ error: 'Image must be 2 MB or smaller.' });
      }

      const merchantId = req.auth!.merchantId;
      const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
      if (!merchant) return res.status(404).json({ error: 'Account not found' });

      const previousAvatarUrl = merchant.avatarUrl;

      let publicUrl: string;
      try {
        publicUrl = await saveAvatarFile(merchantId, req.file.buffer);
      } catch {
        return res.status(400).json({ error: 'Unsupported image format. Use JPEG, PNG, WebP, or GIF.' });
      }

      const updated = await prisma.merchant.update({
        where: { id: merchantId },
        data: { avatarUrl: publicUrl },
      });

      // Delete the old stored file after successful DB update
      await deleteLocalAvatarFile(merchantId, previousAvatarUrl);

      res.json({ merchant: toPublicMerchant(updated) });
    } catch (err: any) {
      console.error('Avatar upload error');
      res.status(500).json({ error: 'Failed to upload avatar' });
    }
  });

  // Remove the avatar (clears DB field and deletes any local file)
  router.delete('/api/me/avatar', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const merchantId = req.auth!.merchantId;
      const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
      if (!merchant) return res.status(404).json({ error: 'Account not found' });

      const previousAvatarUrl = merchant.avatarUrl;
      const updated = await prisma.merchant.update({
        where: { id: merchantId },
        data: { avatarUrl: null },
      });

      await deleteLocalAvatarFile(merchantId, previousAvatarUrl);

      res.json({ merchant: toPublicMerchant(updated) });
    } catch (err: any) {
      console.error('Avatar delete error');
      res.status(500).json({ error: 'Failed to remove avatar' });
    }
  });

  // Complete onboarding: atomic update of both merchant and store required fields.
  // Accessible even when profile is incomplete (onboarding allowlist).
  router.post('/api/me/complete-profile', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const merchantId = req.auth!.merchantId;

      const result = validateOnboardingInput(req.body);
      if ('fieldErrors' in result) {
        return res.status(400).json({ error: 'Validation failed.', fieldErrors: result.fieldErrors });
      }

      const { merchant: mData, store: sData } = result.data;

      const [updatedMerchant, updatedStore] = await prisma.$transaction([
        prisma.merchant.update({
          where: { id: merchantId },
          data: { name: mData.name },
        }),
        prisma.store.update({
          where: { merchantId },
          data: { name: sData.name, businessProfile: sData.businessProfile as any },
        }),
      ]);

      const { profileComplete, missingFields } = getProfileCompletionStatus(updatedMerchant, updatedStore, req.auth!.isAdmin);

      res.json({
        merchant: toPublicMerchant(updatedMerchant),
        store: toPublicStore(updatedStore),
        profileComplete,
        missingFields,
      });
    } catch (err: any) {
      console.error('Complete profile error');
      res.status(500).json({ error: 'Failed to save profile.' });
    }
  });

  return router;
}
