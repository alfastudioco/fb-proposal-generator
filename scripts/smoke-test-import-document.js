// Exercises api/import-document.js end to end against the real Claude API,
// covering both file types it accepts: a PDF (matching the old QuickBooks-
// only import's original test case) and a photo of a printed invoice
// (the newly-generalized image path). Confirms client info + sections are
// extracted from each, and that the `matches` field (candidate existing
// fbpg_clients rows) is present in the response shape.
require('./load-env-local');
const fs = require('fs');
const path = require('path');
const handler = require('../api/import-document');

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
  // Case 1: PDF invoice/estimate.
  const pdfBase64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'test-invoice.pdf')).toString('base64');
  const res1 = await call({ fileBase64: pdfBase64, mediaType: 'application/pdf' });
  if (res1.statusCode !== 200) throw new Error(`PDF import failed: ${res1.statusCode} ${JSON.stringify(res1.body)}`);
  if (!res1.body.client || !res1.body.client.name) throw new Error(`No client name extracted from PDF: ${JSON.stringify(res1.body.client)}`);
  if (!Array.isArray(res1.body.sections) || !res1.body.sections.length) throw new Error('No sections extracted from PDF');
  if (!Array.isArray(res1.body.matches)) throw new Error('matches field missing or not an array (PDF case)');
  console.log('Case 1 (PDF) passed: client', res1.body.client.name, '-', res1.body.sections.length, 'section(s).');

  // Case 2: photo of a printed invoice.
  const photoBase64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'test-invoice-photo.jpg')).toString('base64');
  const res2 = await call({ fileBase64: photoBase64, mediaType: 'image/jpeg' });
  if (res2.statusCode !== 200) throw new Error(`Photo import failed: ${res2.statusCode} ${JSON.stringify(res2.body)}`);
  if (!res2.body.client || !res2.body.client.name) throw new Error(`No client name extracted from photo: ${JSON.stringify(res2.body.client)}`);
  if (!Array.isArray(res2.body.sections) || !res2.body.sections.length) throw new Error('No sections extracted from photo');
  if (!Array.isArray(res2.body.matches)) throw new Error('matches field missing or not an array (photo case)');
  console.log('Case 2 (photo) passed: client', res2.body.client.name, '-', res2.body.sections.length, 'section(s).');

  // Case 3: rejects an unsupported/missing mediaType.
  const res3 = await call({ fileBase64: pdfBase64, mediaType: 'application/msword' });
  if (res3.statusCode !== 400) throw new Error(`Expected 400 for unsupported mediaType, got ${res3.statusCode}`);
  console.log('Case 3 (bad mediaType) passed: rejected with 400.');

  console.log('\nimport-document smoke test passed.');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
