const { getSupabaseClient } = require('../lib/supabase');

// Minimal fbpg_clients search/create/update -- wires up the table that
// previously existed with no UI on top of it (see README's Phase 1 scope).
//
// Also serves fbpg_note_snippets (the user-managed custom-notes library)
// under ?resource=note-snippets, and fbpg_statuses (the user-managed
// sales-pipeline status list) under ?resource=statuses -- both merged into
// this file rather than their own api/*.js so the deployment stays under
// Vercel Hobby's 12-serverless-function cap. Picked this file to merge
// into because it's the one existing endpoint with no frontend caller yet,
// so there's no URL to keep backwards-compatible.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const resource = req.query && req.query.resource;
  if (resource === 'note-snippets') return handleNoteSnippets(req, res);
  if (resource === 'statuses') return handleStatuses(req, res);
  return handleClients(req, res);
};

async function handleClients(req, res) {
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
}

// User-managed library of reusable "Additional Notes" snippets (e.g.
// vendor-discount language, showroom access) -- supplements the hardcoded
// list in snippets.js without requiring a code change to add.
async function handleNoteSnippets(req, res) {
  const supabase = getSupabaseClient();

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('fbpg_note_snippets')
        .select('id, label, text')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ noteSnippets: data });
    } catch (err) {
      console.error('Note snippet list failed:', err);
      return res.status(500).json({ error: 'Could not list note snippets', details: err.message });
    }
  }

  if (req.method === 'POST') {
    const { id, label, text } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: 'label is required' });
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });
    try {
      const row = { label: label.trim(), text: text.trim() };
      const { data, error } = id
        ? await supabase.from('fbpg_note_snippets').update(row).eq('id', id).select().single()
        : await supabase.from('fbpg_note_snippets').insert(row).select().single();
      if (error) throw error;
      return res.status(200).json({ noteSnippet: data });
    } catch (err) {
      console.error('Note snippet save failed:', err);
      return res.status(500).json({ error: 'Could not save note snippet', details: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const id = req.query && req.query.id ? String(req.query.id) : '';
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      const { error } = await supabase.from('fbpg_note_snippets').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Note snippet delete failed:', err);
      return res.status(500).json({ error: 'Could not delete note snippet', details: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// User-managed list of status values for the Status dropdown (proposal
// pipeline tracking: Draft/Sent/Pending/Sold/Lost, seeded by
// supabase/schema.sql, plus whatever custom ones are added here) -- same
// pattern as fbpg_note_snippets above.
async function handleStatuses(req, res) {
  const supabase = getSupabaseClient();

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('fbpg_statuses')
        .select('id, label')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ statuses: data });
    } catch (err) {
      console.error('Status list failed:', err);
      return res.status(500).json({ error: 'Could not list statuses', details: err.message });
    }
  }

  if (req.method === 'POST') {
    const { label } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: 'label is required' });
    try {
      const { data, error } = await supabase.from('fbpg_statuses').insert({ label: label.trim() }).select().single();
      if (error) throw error;
      return res.status(200).json({ status: data });
    } catch (err) {
      console.error('Status save failed:', err);
      return res.status(500).json({ error: 'Could not save status', details: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const id = req.query && req.query.id ? String(req.query.id) : '';
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      const { error } = await supabase.from('fbpg_statuses').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Status delete failed:', err);
      return res.status(500).json({ error: 'Could not delete status', details: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
