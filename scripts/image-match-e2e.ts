// End-to-end check of customer-photo matching against a real store catalog (real DB + Gemini).
// Creates a temporary WIDGET conversation (no messages are delivered to any real channel)
// and deletes it afterwards.
//   npx tsx scripts/image-match-e2e.ts
import 'dotenv/config';
import zlib from 'zlib';

process.env.IMAGE_REPLY_WAIT_MS = process.env.IMAGE_REPLY_WAIT_MS || '4000';
// KEEP mode (IMAGE_E2E_KEEP=1): only the chat flow runs, with real customer names; the customer
// photos are saved so the inbox shows them, and the conversations are kept for the dashboard.
const KEEP = process.env.IMAGE_E2E_KEEP === '1';
const STORE_NAME = process.env.IMAGE_E2E_STORE;
const CUSTOMER_NAMES = ['Ayesha Rahman', 'Tanvir Hasan', 'Nusrat Jahan', 'Rafiq Ahmed', 'Sadia Islam'];

let passed = 0;
let failed = 0;
function check(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    passed++;
    console.log('  PASS', label);
  } else {
    failed++;
    console.log('  FAIL', label, detail !== undefined ? JSON.stringify(detail) : '');
  }
}

// Plain PNG (solid color) — something no shop catalog should match.
function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).map((_, i) => [r, g, b][i % 3])]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadWithRetry(download: (url: string) => Promise<Buffer | null>, url: string): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const buffer = await download(url);
    if (buffer) return buffer;
    await sleep(1000);
  }
  return null;
}

async function main() {
  const { prisma } = await import('../server/db');
  const { recognizeCatalogImage, downloadInboundImage } = await import('../server/imageRecognition');
  const { handleInboundCustomerMessage } = await import('../server/inboundBatcher');
  const { IMAGE_PLACEHOLDER_TEXT } = await import('../server/conversationEngine');
  const { resolveProductImageUrl } = await import('../shared/productImage');
  const { resolveProductName } = await import('../shared/catalogColumns');
  const { saveChatImage } = await import('../server/mediaStorage');

  // Store with the most products that have photos
  const stores = await prisma.store.findMany({ where: STORE_NAME ? { name: STORE_NAME } : undefined, select: { id: true, name: true } });
  let best: { id: string; name: string; products: any[] } | null = null;
  for (const store of stores) {
    const products = (await prisma.product.findMany({ where: { storeId: store.id } }))
      .map((p) => ({ ...p, name: resolveProductName(p), image: resolveProductImageUrl(p) }));
    const withImages = products.filter((p) => p.image);
    if (withImages.length > (best?.products.filter((p) => p.image).length ?? 0)) best = { ...store, products };
  }
  if (!best) throw new Error('No store has products with photos to test against.');
  const withImages = best.products.filter((p) => p.image);
  console.log(`Store "${best.name}": ${best.products.length} products, ${withImages.length} with photos\n`);

  const toCatalog = (list: any[]) => list.map((p) => ({
    name: p.name, sku: p.sku, price: Number(p.price), description: p.description, imageUrl: p.image,
    attributes: Object.entries(p.rawAttributes || {}).filter(([, v]) => typeof v === 'string' && !/^https?:/.test(v as string) && (v as string).length < 120).map(([k, v]) => `${k}: ${v}`).join('; '),
  }));
  const catalog = toCatalog(best.products);

  const target = withImages[Math.floor(withImages.length / 2)];
  const photo = await downloadWithRetry(downloadInboundImage, target.image);
  if (!photo) throw new Error(`Could not download catalog photo for ${target.sku}`);
  const blank = solidPng(96, 96, [40, 160, 220]);
  console.log(`Test product: ${target.sku} "${target.name}"\n`);

  if (!KEEP) {
  console.log('A. Recognition');
  let started = Date.now();
  const exact = await recognizeCatalogImage(photo, catalog, '');
  check(exact.match === 'exact' && exact.sku === target.sku, `photo of ${target.sku}, no text → exact match (${Date.now() - started}ms)`, exact);
  check(exact.intent === 'inquiry', 'no text → intent "inquiry"', exact.intent);

  // Closest-product case: a product's photo while that product is missing from the catalog
  const similarTarget = withImages.find((p) => /earbud|headphone|speaker/i.test(p.name)) || withImages[0];
  const similarPhoto = await downloadWithRetry(downloadInboundImage, similarTarget.image);
  if (!similarPhoto) throw new Error(`Could not download catalog photo for ${similarTarget.sku}`);
  started = Date.now();
  const withoutTarget = catalog.filter((p) => p.sku !== similarTarget.sku);
  const similar = await recognizeCatalogImage(similarPhoto, withoutTarget, 'do you have this?');
  check(similar.match === 'similar' && !!similar.sku && similar.sku !== similarTarget.sku, `photo of "${similarTarget.name}" with it removed from catalog → closest similar product (${Date.now() - started}ms)`, similar);
  console.log(`     closest: ${similar.match} ${similar.sku} (${similar.confidence}) — ${similar.candidates[0]?.reason || ''}`);

  started = Date.now();
  const nothing = await recognizeCatalogImage(blank, catalog, '');
  check(nothing.match === 'none' && nothing.match !== ('unavailable' as string), `plain color image → no match (${Date.now() - started}ms)`, nothing);

  const suggestion = await recognizeCatalogImage(photo, catalog, 'please add this to your inventory');
  check(suggestion.intent === 'inventory_request', '"please add this to your inventory" → intent "inventory_request"', suggestion.intent);
  const purchase = await recognizeCatalogImage(photo, catalog, 'I want to buy 2 of these');
  check(purchase.intent === 'purchase', '"I want to buy 2 of these" → intent "purchase"', purchase.intent);
  }

  console.log(`\nB. Full chat flow (reply wait shortened to ${process.env.IMAGE_REPLY_WAIT_MS}ms)`);
  const createdConversationIds: string[] = [];
  const newConversation = async () => {
    const customerName = KEEP ? CUSTOMER_NAMES[createdConversationIds.length % CUSTOMER_NAMES.length] : 'Image test';
    const conversation = await prisma.conversation.create({
      data: { storeId: best!.id, channelType: 'WIDGET', externalUserId: `image-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, customerName, status: 'AI_MANAGED' },
    });
    createdConversationIds.push(conversation.id);
    return conversation;
  };
  const customerSays = async (conversation: any, text: string, image?: Buffer) => {
    const imageUrl = image && KEEP ? await saveChatImage(best!.id, image) : null;
    await prisma.message.create({ data: { conversationId: conversation.id, sender: 'CUSTOMER', text, imageUrl, mediaType: image ? 'image' : undefined } });
    await handleInboundCustomerMessage(conversation, text, image);
  };
  const aiReplies = (conversationId: string) =>
    prisma.message.findMany({ where: { conversationId, sender: 'AI' }, orderBy: { createdAt: 'asc' } });
  const waitForReply = async (conversationId: string) => {
    for (let i = 0; i < 360; i++) {
      const replies = await aiReplies(conversationId);
      if (replies.length) return replies;
      await sleep(500);
    }
    return [];
  };

  try {
    // B1: photo only
    const c1 = await newConversation();
    await customerSays(c1, IMAGE_PLACEHOLDER_TEXT, photo);
    const r1 = await waitForReply(c1.id);
    const reply1 = r1[0];
    console.log('     reply:', reply1?.text, '| image:', reply1?.imageUrl);
    check(r1.length === 1, 'photo only → exactly one reply');
    check(!!reply1 && reply1.text.includes(target.name) && /buy/i.test(reply1.text), 'reply names the product and asks to buy');
    check(!!reply1 && reply1.imageUrl === target.image, 'reply carries the catalog photo of the product');

    // B2: photo, then a follow-up message inside the wait window → one combined reply
    const c2 = await newConversation();
    await customerSays(c2, IMAGE_PLACEHOLDER_TEXT, photo);
    await sleep(1000);
    check((await aiReplies(c2.id)).length === 0, 'no reply while waiting for follow-up messages');
    await customerSays(c2, 'please add this to your inventory');
    const r2 = await waitForReply(c2.id);
    console.log('     reply:', r2[0]?.text, '| image:', r2[0]?.imageUrl);
    check(r2.length === 1, 'photo + follow-up text → one combined reply');
    check(!!r2[0] && r2[0].text.includes(target.name), 'already stocked item → tells the customer we have it');

    // B3: unknown item + stocking request → thanks, nothing added
    const productCountBefore = await prisma.product.count({ where: { storeId: best.id } });
    const c3 = await newConversation();
    await customerSays(c3, 'can you start selling this? please add it to your shop', blank);
    const r3 = await waitForReply(c3.id);
    console.log('     reply:', r3[0]?.text);
    check(!!r3[0] && /suggestion/i.test(r3[0].text) && !r3[0].imageUrl, 'stocking request → thanks for the suggestion');
    check((await prisma.product.count({ where: { storeId: best.id } })) === productCountBefore, 'no product was added to the catalog');

    // B4: unrelated photo alone → we don't have it
    const c4 = await newConversation();
    await customerSays(c4, IMAGE_PLACEHOLDER_TEXT, blank);
    const r4 = await waitForReply(c4.id);
    console.log('     reply:', r4[0]?.text);
    check(!!r4[0] && /don't have|nei|নেই/i.test(r4[0].text), 'unrelated photo → tells the customer we don\'t have it');

    // B5: photo + purchase request → handled by the AI agent, product photo attached
    const c5 = await newConversation();
    await customerSays(c5, 'I want to buy 2 of these', photo);
    const r5 = await waitForReply(c5.id);
    console.log('     reply:', r5[0]?.text, '| image:', r5[0]?.imageUrl);
    check(r5.length >= 1 && (r5[0].text.includes(target.name) || r5[0].text.includes('2')), 'purchase request → agent answers about the matched product');
  } finally {
    if (KEEP) {
      console.log(`\nKept ${createdConversationIds.length} conversation(s) in "${best.name}".`);
    } else {
      await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
      await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
      console.log(`\nCleaned up ${createdConversationIds.length} test conversation(s).`);
    }
    await prisma.$disconnect();
  }

  console.log(`\nImage match e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
