const { getSupabaseClient } = require('../lib/supabase');

// Lists past proposals (most recent first) for the history page. Does NOT
// return signed URLs -- those are generated on demand, per-file, by
// api/proposal-link.js when the user actually clicks a download button, so
// listing never hands out a link that might outlive its usefulness or get
// generated for rows nobody downloads.
//
// GET ?id=<uuid> instead returns one full row (every column, including
// sections/payment_terms/etc.) -- used by the editor to reload a saved
// proposal back into the form.
//
// PATCH ?id=<uuid> updates only the sales-pipeline fields (status,
// deposit/balance tracking) directly on the row -- unlike the main
// generate/update flow (api/generate.js), it does NOT touch sections,
// pricing, or the docx/pdf files, so the history page's quick status
// dropdown and payment editor don't pay for a document regeneration.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query || {};

  try {
    const supabase = getSupabaseClient();

    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id is required' });
      const { status, depositAmount, depositDate, balanceDue, paymentNotes } = req.body || {};
      const row = {};
      if (status !== undefined) row.status = status;
      if (depositAmount !== undefined) row.deposit_amount = depositAmount;
      if (depositDate !== undefined) row.deposit_date = depositDate;
      if (balanceDue !== undefined) row.balance_due = balanceDue;
      if (paymentNotes !== undefined) row.payment_notes = paymentNotes;
      if (!Object.keys(row).length) return res.status(400).json({ error: 'No updatable fields provided' });

      const { data, error } = await supabase
        .from('fbpg_proposals')
        .update(row)
        .eq('id', id)
        .select('id, status, deposit_amount, deposit_date, balance_due, payment_notes')
        .single();
      if (error) throw error;
      return res.status(200).json({ proposal: data });
    }

    if (id) {
      const { data, error } = await supabase.from('fbpg_proposals').select('*').eq('id', id).single();
      if (error) throw error;
      return res.status(200).json({ proposal: data });
    }

    const { data, error } = await supabase
      .from('fbpg_proposals')
      .select('id, proposal_num, client_name, date, total_amount, total_label, status, deposit_amount, deposit_date, balance_due, payment_notes, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return res.status(200).json({ proposals: data });
  } catch (err) {
    console.error('Listing/updating proposals failed:', err);
    return res.status(500).json({ error: 'Could not load proposals', details: err.message });
  }
};
