// Exercises api/generate-scope.js's optional `images` array (layout photos
// attached to the per-room "Generate Scope" flow) against the real Claude
// API: confirms the existing text-only path is unaffected, that a single
// image and multiple images both work, and that the >MAX_IMAGES case is
// rejected before any Claude call.
require('./load-env-local');
const fs = require('fs');
const path = require('path');
const handler = require('../api/generate-scope');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}

async function call(body) {
  const res = mockRes();
  await handler({ method: 'POST', body }, res);
  return res;
}

async function main() {
  // Case 1: existing text-only path, no `images` key at all -- must still work.
  const res1 = await call({ description: 'Gut kitchen remodel, new hardwood floor, move sink to an island.', roomTitle: 'Kitchen' });
  if (res1.statusCode !== 200) throw new Error(`Text-only case failed: ${res1.statusCode} ${JSON.stringify(res1.body)}`);
  if (!Array.isArray(res1.body.items) || !res1.body.items.length) throw new Error('No items returned for text-only case');
  console.log('Case 1 (text-only) passed:', res1.body.items.length, 'item(s).');

  // Case 2: single layout photo alongside the description.
  const photoBase64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'test-invoice-photo.jpg')).toString('base64');
  const res2 = await call({ description: 'Renovate this bathroom per the attached layout photo.', roomTitle: 'Bathroom', images: [photoBase64] });
  if (res2.statusCode !== 200) throw new Error(`Single-image case failed: ${res2.statusCode} ${JSON.stringify(res2.body)}`);
  if (!Array.isArray(res2.body.items) || !res2.body.items.length) throw new Error('No items returned for single-image case');
  console.log('Case 2 (single image) passed:', res2.body.items.length, 'item(s).');

  // Case 3: multiple layout photos (e.g. first floor + basement) in one call.
  const res3 = await call({ description: 'Whole-level renovation covering both attached floor layouts.', roomTitle: 'First Floor & Basement', images: [photoBase64, photoBase64] });
  if (res3.statusCode !== 200) throw new Error(`Multi-image case failed: ${res3.statusCode} ${JSON.stringify(res3.body)}`);
  if (!Array.isArray(res3.body.items) || !res3.body.items.length) throw new Error('No items returned for multi-image case');
  console.log('Case 3 (multi-image) passed:', res3.body.items.length, 'item(s).');

  // Case 4: too many images is rejected before any Claude call.
  const tooMany = Array(6).fill(photoBase64);
  const res4 = await call({ description: 'Too many photos.', roomTitle: 'Whole House', images: tooMany });
  if (res4.statusCode !== 400) throw new Error(`Expected 400 for too many images, got ${res4.statusCode}`);
  console.log('Case 4 (too many images) passed: rejected with 400.');

  console.log('\ngenerate-scope-images smoke test passed.');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
