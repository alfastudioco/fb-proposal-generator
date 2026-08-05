const { getSupabaseClient } = require('../lib/supabase');

const LINK_TTL_SECONDS = 300; // 5 minutes -- generated just-in-time per click, no need for a long expiry

// Generates a fresh signed Storage URL for one proposal's docx or pdf,
// looked up by id. Kept separate from api/proposals.js's list response so
// a link is only ever minted for a file someone actually clicked to
// download, not for every row on every page load.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id, type } = req.query || {};
  if (!id || (type !== 'docx' && type !== 'pdf')) {
    return res.status(400).json({ error: 'Query params "id" and "type" (docx|pdf) are required' });
  }

  try {
    const supabase = getSupabaseClient();
    const column = type === 'docx' ? 'docx_storage_path' : 'pdf_storage_path';
    const { data: row, error: rowError } = await supabase
      .from('fbpg_proposals')
      .select(column)
      .eq('id', id)
      .single();
    if (rowError) throw rowError;

    const path = row[column];
    if (!path || path === 'n/a') {
      return res.status(404).json({ error: `No ${type} file stored for this proposal` });
    }

    const { data: signed, error: signError } = await supabase.storage
      .from('proposals')
      .createSignedUrl(path, LINK_TTL_SECONDS);
    if (signError) throw signError;

    return res.status(200).json({ url: signed.signedUrl });
  } catch (err) {
    console.error('Signing proposal link failed:', err);
    return res.status(500).json({ error: 'Could not create download link', details: err.message });
  }
};
