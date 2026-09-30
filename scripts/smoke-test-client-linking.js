// Exercises the client database behind the Client Name search dropdown,
// end to end against the real Supabase project: lib/clientMatching.js's
// saveClientForProposal (what api/generate.js calls to create/link/update a
// client) and api/clients.js's GET search. Uses a uniquely named throwaway
// client and deletes it at the end, pass or fail.
require('./load-env-local');
const { getSupabaseClient } = require('../lib/supabase');
const { saveClientForProposal } = require('../lib/clientMatching');
const handler = require('../api/clients');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}

async function search(q) {
  const res = mockRes();
  await handler({ method: 'GET', query: { q } }, res);
  if (res.statusCode !== 200) throw new Error(`Search "${q}" failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  return res.body.clients;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const supabase = getSupabaseClient();
  const tag = String(Date.now()).slice(-6);
  const name = `Smoke Test Client ${tag}`;
  const email = `smoke_${tag}@example.com`;
  const phone = `847-555-${tag.slice(-4)}`;
  const createdIds = new Set();

  try {
    const id = await saveClientForProposal(supabase, { name, address: '1 Smoke St', phone, email }, null);
    assert(id, 'No id returned on create');
    createdIds.add(id);
    console.log('Created client:', id);

    const byEmail = await saveClientForProposal(supabase, { name: 'Someone Else', email: email.toUpperCase() }, null);
    createdIds.add(byEmail);
    assert(byEmail === id, 'Same email (different case) created a duplicate');
    console.log('Unlinked save with same email reused the client.');

    const byPhone = await saveClientForProposal(supabase, { name: `  smoke test CLIENT ${tag} `, phone: `(847) 555 ${tag.slice(-4)}` }, null);
    createdIds.add(byPhone);
    assert(byPhone === id, 'Same phone (different formatting) created a duplicate');
    console.log('Unlinked save with reformatted phone reused the client.');

    const byName = await saveClientForProposal(supabase, { name: `smoke   test client ${tag}` }, null);
    createdIds.add(byName);
    assert(byName === id, 'Same name (different case/spacing) created a duplicate');
    console.log('Unlinked save with same name reused the client.');

    const newPhone = `312-555-${tag.slice(-4)}`;
    const linked = await saveClientForProposal(supabase, { name, address: '', phone: newPhone, email: '' }, id);
    assert(linked === id, 'Linked save returned a different id');
    const { data: row, error } = await supabase.from('fbpg_clients').select('name, address, phone, email').eq('id', id).single();
    if (error) throw error;
    assert(row.phone === newPhone, `Linked save did not update phone (got ${row.phone})`);
    assert(row.address === '1 Smoke St', 'Blank address wiped the saved address');
    assert((row.email || '').toLowerCase() === email, 'Blank email wiped the saved email');
    console.log('Linked save updated phone and kept blank fields intact.');

    const staleId = await saveClientForProposal(supabase, { name, email }, '00000000-0000-0000-0000-000000000000');
    createdIds.add(staleId);
    assert(staleId === id, 'Deleted/unknown linked id did not fall back to matching');
    console.log('Unknown linked id fell back to matching.');

    for (const q of [`Client ${tag}`, 'smoke st', email, `312555${tag.slice(-4)}`]) {
      const results = await search(q);
      assert(results.some((c) => c.id === id), `Search "${q}" did not find the client`);
    }
    console.log('Search by name, address, email and phone digits all found it.');

    const other = await saveClientForProposal(supabase, { name: `Different Person ${tag}` }, null);
    createdIds.add(other);
    assert(other !== id, 'A different client was merged into the test client');
    console.log('A genuinely different client got its own record.');

    console.log('\nclient-linking smoke test passed.');
  } finally {
    const ids = [...createdIds].filter(Boolean);
    if (ids.length) {
      const { error } = await supabase.from('fbpg_clients').delete().in('id', ids);
      if (error) console.error('Cleanup failed -- delete these fbpg_clients rows by hand:', ids, error.message);
      else console.log(`Cleaned up ${ids.length} test client(s).`);
    }
  }
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
