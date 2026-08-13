require('./load-env-local');
const handler = require('../api/public-config');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}

async function main() {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  if (!res.body.supabaseUrl || !res.body.supabaseAnonKey) throw new Error('Missing supabaseUrl/supabaseAnonKey in response');
  console.log('public-config smoke test passed:', {
    supabaseUrl: res.body.supabaseUrl,
    supabaseAnonKey: res.body.supabaseAnonKey.slice(0, 8) + '...',
  });
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
