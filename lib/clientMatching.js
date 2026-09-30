// Fuzzy-matches an extracted {name, phone, email} against existing
// fbpg_clients rows, so an AI-extraction flow (image upload, document
// import) can offer "use this existing client" instead of always creating
// a fresh one. Shared by api/extract-client.js and api/import-document.js.
async function findClientMatches(supabase, client) {
  const filters = [];
  if (client.phone) filters.push(`phone.eq.${client.phone}`);
  if (client.email) filters.push(`email.eq.${client.email}`);
  if (client.name) filters.push(`name.ilike.%${client.name}%`);
  if (!filters.length) return [];

  const { data, error } = await supabase
    .from('fbpg_clients')
    .select('id, name, address, phone, email')
    .or(filters.join(','))
    .limit(5);
  if (error) {
    console.error('Client match lookup failed (non-fatal):', error);
    return [];
  }
  return data;
}

const CLIENT_COLUMNS = 'id, name, address, phone, email';

const normalizeName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeEmail = (s) => String(s || '').trim().toLowerCase();
const phoneDigits = (s) => String(s || '').replace(/\D/g, '');

// Escapes LIKE wildcards so a user-typed value is matched literally (an
// email like "jane_smith@x.com" would otherwise treat "_" as a wildcard).
const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

// Finds an existing client that is unambiguously the same person: same
// email, else same phone digits (so "847-555-0100" and "(847) 555-0100"
// match), else exactly the same name ignoring case/spacing. Deliberately
// stricter than findClientMatches -- this one links automatically, with no
// human confirming the pick.
async function findExactClient(supabase, client) {
  const email = normalizeEmail(client.email);
  if (email) {
    const { data, error } = await supabase.from('fbpg_clients').select(CLIENT_COLUMNS).ilike('email', escapeLike(email)).limit(5);
    if (error) throw error;
    const hit = data.find((c) => normalizeEmail(c.email) === email);
    if (hit) return hit;
  }

  const digits = phoneDigits(client.phone);
  if (digits.length >= 7) {
    // Narrow by the last 4 digits in SQL, then compare all digits here --
    // stored phones keep whatever formatting they were typed with.
    const { data, error } = await supabase.from('fbpg_clients').select(CLIENT_COLUMNS).ilike('phone', `%${digits.slice(-4)}%`).limit(50);
    if (error) throw error;
    const hit = data.find((c) => phoneDigits(c.phone) === digits);
    if (hit) return hit;
  }

  const name = normalizeName(client.name);
  if (name) {
    const { data, error } = await supabase.from('fbpg_clients').select(CLIENT_COLUMNS).ilike('name', `%${escapeLike(name.split(' ')[0])}%`).limit(50);
    if (error) throw error;
    const hit = data.find((c) => normalizeName(c.name) === name);
    if (hit) return hit;
  }

  return null;
}

// Makes sure the proposal's client exists in fbpg_clients and returns its
// id. A linked clientId (picked from the search dropdown) is updated with
// the form's values; otherwise an exact match is reused before a new row is
// inserted, so the same client typed by hand twice doesn't get two records.
// Blank form fields never overwrite a saved value.
async function saveClientForProposal(supabase, client, clientId) {
  const fields = {};
  for (const key of ['name', 'address', 'phone', 'email']) {
    const value = client[key] ? String(client[key]).trim() : '';
    if (value) fields[key] = value;
  }
  if (!fields.name) return null;

  let targetId = clientId || null;
  if (targetId) {
    const { data, error } = await supabase.from('fbpg_clients').select('id').eq('id', targetId).maybeSingle();
    if (error) throw error;
    if (!data) targetId = null; // linked client was deleted -- fall back to matching
  }
  if (!targetId) {
    const existing = await findExactClient(supabase, fields);
    if (existing) targetId = existing.id;
  }

  const { data, error } = targetId
    ? await supabase.from('fbpg_clients').update(fields).eq('id', targetId).select('id').single()
    : await supabase.from('fbpg_clients').insert(fields).select('id').single();
  if (error) throw error;
  return data.id;
}

module.exports = { findClientMatches, findExactClient, saveClientForProposal, normalizeName, phoneDigits };
