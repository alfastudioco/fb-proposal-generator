const { getSupabaseClient } = require('../lib/supabase');

// User-managed library of reusable "Additional Notes" snippets (e.g.
// vendor-discount language, showroom access) -- supplements the hardcoded
// list in snippets.js without requiring a code change to add. Mirrors the
// GET/POST/DELETE shape of api/clients.js.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
};
