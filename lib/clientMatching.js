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

module.exports = { findClientMatches };
