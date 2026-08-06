const { getSupabaseClient } = require('../lib/supabase');

// Minimal fbpg_clients search/create/update -- wires up the table that
// previously existed with no UI on top of it (see README's Phase 1 scope).
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = getSupabaseClient();

  if (req.method === 'GET') {
    const q = (req.query && req.query.q ? String(req.query.q) : '').trim();
    try {
      let query = supabase.from('fbpg_clients').select('id, name, address, phone, email').order('created_at', { ascending: false }).limit(20);
      if (q) query = query.ilike('name', `%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ clients: data });
    } catch (err) {
      console.error('Client search failed:', err);
      return res.status(500).json({ error: 'Could not search clients', details: err.message });
    }
  }

  if (req.method === 'POST') {
    const { id, name, address, phone, email } = req.body || {};
    if (!id && (!name || !name.trim())) {
      return res.status(400).json({ error: 'name is required to create a client' });
    }
    try {
      const row = { name: name ?? undefined, address: address ?? null, phone: phone ?? null, email: email ?? null };
      const { data, error } = id
        ? await supabase.from('fbpg_clients').update(row).eq('id', id).select().single()
        : await supabase.from('fbpg_clients').insert(row).select().single();
      if (error) throw error;
      return res.status(200).json({ client: data });
    } catch (err) {
      console.error('Client save failed:', err);
      return res.status(500).json({ error: 'Could not save client', details: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
