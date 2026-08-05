const { getSupabaseClient } = require('../lib/supabase');

// Lists past proposals (most recent first) for the history page. Does NOT
// return signed URLs -- those are generated on demand, per-file, by
// api/proposal-link.js when the user actually clicks a download button, so
// listing never hands out a link that might outlive its usefulness or get
// generated for rows nobody downloads.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('fbpg_proposals')
      .select('id, proposal_num, client_name, date, total_amount, total_label, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return res.status(200).json({ proposals: data });
  } catch (err) {
    console.error('Listing proposals failed:', err);
    return res.status(500).json({ error: 'Could not load proposals', details: err.message });
  }
};
