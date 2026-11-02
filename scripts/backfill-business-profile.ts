// One-off, non-destructive: copies each store's legacy business fields into the new
// "Your business" data (Store.businessProfile → sell / hotline / address). Old columns are left untouched.
import { prisma } from '../server/db';

(async () => {
  const stores = await prisma.store.findMany({
    select: { id: true, businessPhone: true, businessType: true, streetAddress: true, city: true, country: true, businessProfile: true },
  });
  let updated = 0;
  for (const s of stores) {
    const bp = ((s.businessProfile && typeof s.businessProfile === 'object' && !Array.isArray(s.businessProfile)) ? s.businessProfile : {}) as Record<string, any>;
    const next = { ...bp };
    if (!next.sell && s.businessType) next.sell = s.businessType;
    if (!next.hotline && s.businessPhone) next.hotline = s.businessPhone;
    const address = [s.streetAddress, s.city, s.country].filter(Boolean).join(', ');
    if (!next.address && address) next.address = address;
    if (JSON.stringify(next) !== JSON.stringify(bp)) {
      await prisma.store.update({ where: { id: s.id }, data: { businessProfile: next } });
      updated++;
    }
  }
  console.log(`stores: ${stores.length}, backfilled: ${updated}`);
  await prisma.$disconnect();
  process.exit(0);
})();
