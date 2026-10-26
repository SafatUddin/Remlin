import {
  MAX_INBOUND_IMAGE_BYTES,
  isInventoryRequest,
  normalizeImageRecognitionResult,
  shortlistCatalog,
  validateInboundImage,
} from '../server/imageRecognition';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}

const catalog = [
  { name: 'Red Shirt', sku: 'SHIRT-RED', price: 20, imageUrl: 'https://example.com/red.jpg' },
  { name: 'Blue Shirt', sku: 'SHIRT-BLUE', price: 20, imageUrl: 'https://example.com/blue.jpg' },
];

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
assert(validateInboundImage(jpeg)?.mime === 'image/jpeg', 'accepts JPEG magic bytes');
assert(validateInboundImage(png)?.mime === 'image/png', 'accepts PNG magic bytes');
assert(validateInboundImage(Buffer.from('not an image')) === null, 'rejects non-image bytes');
assert(validateInboundImage(Buffer.alloc(MAX_INBOUND_IMAGE_BYTES + 1)) === null, 'rejects oversized images');

const exact = normalizeImageRecognitionResult({
  match: 'exact',
  candidates: [{ sku: 'SHIRT-RED', confidence: 0.94, reason: 'same color and cut' }],
}, catalog);
assert(exact.match === 'exact' && exact.sku === 'SHIRT-RED', 'keeps exact catalog match');

const similar = normalizeImageRecognitionResult({
  match: 'similar',
  candidates: [
    { sku: 'SHIRT-BLUE', confidence: 0.71, reason: 'similar shape' },
    { sku: 'SHIRT-RED', confidence: 0.68, reason: 'similar shape' },
  ],
}, catalog);
assert(similar.match === 'similar' && similar.sku === 'SHIRT-BLUE' && similar.candidates.length === 2, 'offers the closest product as similar');

const notExact = normalizeImageRecognitionResult({
  match: 'exact',
  candidates: [{ sku: 'SHIRT-BLUE', confidence: 0.6, reason: 'model over-claimed' }],
}, catalog);
assert(notExact.match === 'similar', 'low-confidence "exact" is downgraded to similar');

const weak = normalizeImageRecognitionResult({
  match: 'similar',
  candidates: [{ sku: 'SHIRT-BLUE', confidence: 0.1, reason: 'barely related' }],
}, catalog);
assert(weak.match === 'none' && weak.sku === null, 'very weak candidate is not offered');

const noneMatch = normalizeImageRecognitionResult({
  match: 'none',
  candidates: [{ sku: 'SHIRT-RED', confidence: 0.12, reason: 'unrelated' }],
}, catalog);
assert(noneMatch.match === 'none' && noneMatch.sku === null, 'unrelated closest product is not offered');

const labelledNone = normalizeImageRecognitionResult({
  match: 'none',
  candidates: [{ sku: 'SHIRT-RED', confidence: 0.6, reason: 'same kind of product' }],
}, catalog);
assert(labelledNone.match === 'similar' && labelledNone.sku === 'SHIRT-RED', 'same-kind product is offered as similar even if labelled none');

assert(isInventoryRequest('please add this to your inventory'), 'detects "add this to your inventory"');
assert(isInventoryRequest('can you start selling this?'), 'detects "start selling this"');
assert(isInventoryRequest('eta apnader shop e add koren'), 'detects Banglish stocking request');
assert(!isInventoryRequest('do you have this in red?'), 'normal question is not a stocking request');
assert(!isInventoryRequest('I want to buy 2 of these'), 'purchase is not a stocking request');

const big = Array.from({ length: 300 }, (_, i) => ({ name: `Item ${i}`, sku: `SKU-${i}`, price: 1 }));
big[250] = { name: 'Red Leather Wallet', sku: 'WALLET', price: 5 };
const shortlist = shortlistCatalog(big, ['wallet', 'leather', 'red'], 20);
assert(shortlist.length === 20 && shortlist[0].sku === 'WALLET', 'text shortlist keeps the best keyword match for huge catalogs');

const foreign = normalizeImageRecognitionResult({
  match: 'exact',
  candidates: [{ sku: 'OTHER-STORE-SKU', confidence: 1, reason: 'spoofed' }],
}, catalog);
assert(foreign.match === 'none' && foreign.sku === null, 'rejects SKU outside the supplied store catalog');

const clamped = normalizeImageRecognitionResult({
  candidates: [{ sku: 'SHIRT-RED', confidence: 42, reason: 'bad model value' }],
}, catalog);
assert(clamped.confidence === 1 && clamped.sku === 'SHIRT-RED', 'clamps confidence and derives safe exact match');

console.log(`\nImage recognition smoke tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
