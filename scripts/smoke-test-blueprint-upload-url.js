// Exercises the full direct-to-Storage upload path end to end: mint a
// signed upload URL via the handler, PUT a small fixture buffer straight
// to Supabase Storage (mirroring what the browser will do), confirm it
// landed, then clean up. Requires SUPABASE_ANON_KEY in .env.local (see
// Task 1).
require('./load-env-local');
const handler = require('../api/blueprint-upload-url');
const { getSupabaseClient } = require('../lib/supabase');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}

async function main() {
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('SUPABASE_ANON_KEY must be set in .env.local for this smoke test');

  const res = mockRes();
  await handler({ method: 'POST', body: { fileName: 'smoke-test.pdf', mimeType: 'application/pdf' } }, res);
  if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  const { path, signedUrl } = res.body;
  console.log('Minted signed upload URL for path:', path);

  const fixture = Buffer.from('%PDF-1.4 smoke test fixture');
  const putRes = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/pdf',
    },
    body: fixture,
  });
  if (!putRes.ok) throw new Error(`Upload PUT failed: ${putRes.status} ${await putRes.text()}`);
  console.log('Uploaded fixture file directly to Storage.');

  const supabase = getSupabaseClient();
  const { data: downloaded, error: downloadError } = await supabase.storage.from('blueprints').download(path);
  if (downloadError) throw downloadError;
  const downloadedBuffer = Buffer.from(await downloaded.arrayBuffer());
  if (!downloadedBuffer.equals(fixture)) throw new Error('Downloaded content did not match uploaded fixture');
  console.log('Confirmed uploaded content matches.');

  await supabase.storage.from('blueprints').remove([path]);
  console.log('Cleaned up fixture file.');

  console.log('\nblueprint-upload-url smoke test passed.');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
