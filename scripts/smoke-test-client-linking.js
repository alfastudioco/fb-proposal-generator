// Exercises the client database behind the Client Name search dropdown,
// end to end against the real Supabase project: lib/clientMatching.js's
// saveClientForProposal (what api/generate.js calls to create/link/update a
// client) and api/clients.js's GET search. Uses a uniquely named throwaway
// client and deletes it at the end, pass or fail.
require('./load-env-local');
const { getSupabaseClient } = require('../lib/supabase');
const { saveClientForProposal } = require('../lib/clientMatching');
const handler = require('../api/clients');
const proposalsHandler = require('../api/proposals');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}

async function call(h, req) {
  const res = mockRes();
  await h({ query: {}, ...req }, res);
  if (res.statusCode !== 200) throw new Error(`${req.method} ${JSON.stringify(req.query)} failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function search(q) {
  return (await call(handler, { method: 'GET', query: { q } })).clients;
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
  let proposalId = null;

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

    // ---- Manual client management: Clients page + dashboard "Link client" ----
    const added = (await call(handler, { method: 'POST', body: { name: `  Manual Add ${tag} `, phone: '', email: `manual_${tag}@example.com` } })).client;
    createdIds.add(added.id);
    assert(added.name === `Manual Add ${tag}`, `Added client name not trimmed (got "${added.name}")`);
    assert(added.phone === null, 'Blank phone saved as empty string instead of null');

    const edited = (await call(handler, { method: 'POST', body: { id: added.id, name: `Manual Edited ${tag}`, address: '9 Edit Ave', phone: '', email: added.email } })).client;
    assert(edited.id === added.id && edited.name === `Manual Edited ${tag}` && edited.address === '9 Edit Ave', 'Edit did not update the client');
    console.log('Clients page add + edit work.');

    const all = (await call(handler, { method: 'GET', query: { all: '1' } })).clients;
    assert(all.some((c) => c.id === added.id), 'Full client list (?all=1) is missing the new client');

    const { data: prop, error: propErr } = await supabase.from('fbpg_proposals').insert({
      proposal_num: `SMOKE-${tag}`, client_name: 'Joe', date: 'Jan 1, 2026', sections: [], total_amount: 0,
    }).select('id').single();
    if (propErr) throw propErr;
    proposalId = prop.id;

    const linkedProp = (await call(proposalsHandler, { method: 'PATCH', query: { id: proposalId }, body: { clientId: added.id } })).proposal;
    assert(linkedProp.client_id === added.id, 'PATCH clientId did not link the proposal');
    const listed = (await call(proposalsHandler, { method: 'GET' })).proposals.find((p) => p.id === proposalId);
    assert(listed && listed.client_id === added.id && listed.client && listed.client.name === `Manual Edited ${tag}`, 'Proposal list does not include the linked client name');
    console.log('Dashboard link-client PATCH works and the list shows the linked name.');

    await call(handler, { method: 'DELETE', query: { id: added.id } });
    createdIds.delete(added.id);
    const { data: gone } = await supabase.from('fbpg_clients').select('id').eq('id', added.id).maybeSingle();
    assert(!gone, 'DELETE did not remove the client');
    const { data: orphan } = await supabase.from('fbpg_proposals').select('client_id').eq('id', proposalId).single();
    assert(orphan.client_id === null, 'Deleting the client did not unlink its proposal');
    console.log('Deleting a client unlinks (keeps) its proposals.');

    console.log('\nclient-linking smoke test passed.');
  } finally {
    if (proposalId) {
      const { error } = await supabase.from('fbpg_proposals').delete().eq('id', proposalId);
      if (error) console.error('Cleanup failed -- delete this fbpg_proposals row by hand:', proposalId, error.message);
    }
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
