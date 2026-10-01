// One-time backfill: builds fbpg_clients from existing fbpg_proposals rows
// (which predate the client database and all have client_id = null) and
// links each proposal to its client.
//
// Proposals are grouped by client name, ignoring case and extra spaces.
// Each client gets, per field, the value from its most recent proposal that
// has one. A group whose name already exists in fbpg_clients reuses that row.
//
//   node scripts/backfill-clients.js           # dry run -- prints the plan, writes nothing
//   node scripts/backfill-clients.js --apply   # creates clients + links proposals
//   --skip=7891,8012                           # also leave these proposal numbers unlinked
require('./load-env-local');
const { getSupabaseClient } = require('../lib/supabase');
const { normalizeName, findExactClient } = require('../lib/clientMatching');

const APPLY = process.argv.includes('--apply');
const SKIP_NUMS = new Set(((process.argv.find((a) => a.startsWith('--skip=')) || '').slice(7)).split(',').map((n) => n.trim()).filter(Boolean));

async function main() {
  const supabase = getSupabaseClient();

  const { data: proposals, error } = await supabase
    .from('fbpg_proposals')
    .select('id, proposal_num, client_id, client_name, client_address, client_phone, client_email, created_at')
    .is('client_id', null)
    .order('created_at', { ascending: false });
  if (error) throw error;

  // Proposals with only a name (no address/phone/email) are skipped and left
  // unlinked -- names like "Joe" or "Manual" aren't enough to say who the
  // client is, so those get a client assigned by hand instead.
  const hasContact = (p) => [p.client_address, p.client_phone, p.client_email].some((v) => v && String(v).trim());
  const isSkipped = (p) => !hasContact(p) || SKIP_NUMS.has(String(p.proposal_num));
  const skipped = proposals.filter(isSkipped);

  const groups = new Map();
  for (const p of proposals) {
    const key = normalizeName(p.client_name);
    if (!key || isSkipped(p)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p); // newest first, from the query order
  }

  const plan = [...groups.values()].map((rows) => {
    const pick = (col) => (rows.find((r) => r[col] && String(r[col]).trim()) || {})[col] || null;
    return {
      client: {
        name: rows[0].client_name.trim().replace(/\s+/g, ' '),
        address: pick('client_address'),
        phone: pick('client_phone'),
        email: pick('client_email'),
      },
      proposals: rows,
    };
  });

  console.log(`${proposals.length} unlinked proposal(s) -> ${plan.length} client(s), ${skipped.length} skipped\n`);
  if (skipped.length) {
    console.log('Skipped (no contact info or --skip -- assign a client by hand):');
    for (const p of skipped) console.log(`   #${p.proposal_num} ${p.client_name || '(no name)'}`);
    console.log('');
  }
  for (const { client, proposals: rows } of plan) {
    console.log(`${client.name}`);
    console.log(`   ${[client.address, client.phone, client.email].filter(Boolean).join(' | ') || '(no contact info)'}`);
    console.log(`   proposals: ${rows.map((r) => `#${r.proposal_num}`).join(', ')}`);
  }

  if (!APPLY) {
    console.log('\nDry run -- nothing written. Re-run with --apply to create these clients and link the proposals.');
    return;
  }

  console.log('\nApplying...');
  for (const { client, proposals: rows } of plan) {
    const existing = await findExactClient(supabase, { name: client.name });
    let clientId;
    if (existing) {
      clientId = existing.id;
    } else {
      const { data, error: insertError } = await supabase.from('fbpg_clients').insert(client).select('id').single();
      if (insertError) throw insertError;
      clientId = data.id;
    }
    const { error: linkError } = await supabase
      .from('fbpg_proposals')
      .update({ client_id: clientId })
      .in('id', rows.map((r) => r.id));
    if (linkError) throw linkError;
    console.log(`${existing ? 'Reused' : 'Created'} ${client.name} -> linked ${rows.length} proposal(s)`);
  }
  console.log('\nBackfill complete.');
}

main().catch((err) => {
  console.error('BACKFILL FAILED:', err.message || err);
  process.exit(1);
});
