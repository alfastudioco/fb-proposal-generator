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
// deposit/balance tracking, linked client) directly on the row -- unlike the main
// generate/update flow (api/generate.js), it does NOT touch sections,
// pricing, or the docx/pdf files, so the history page's quick status
// dropdown and payment editor don't pay for a document regeneration.
//
// ?resource=payments is the payment log (fbpg_payments) -- folded in here
// rather than its own api/ file to stay within Vercel's function limit:
//   POST   ?resource=payments            { proposalId, amount, paidOn, method, note }
//   PATCH  ?resource=payments&id=<uuid>  same fields, any subset
//   DELETE ?resource=payments&id=<uuid>
// Each returns { payments } -- that proposal's full, updated list.
const PAYMENT_FIELDS = 'id, proposal_id, amount, paid_on, method, note, created_at';

function paymentRowFromBody(body, partial) {
  const row = {};
  const errors = [];
  const has = (k) => body[k] !== undefined;
  if (!partial || has('amount')) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.push('amount must be a number above 0');
    else row.amount = Math.round(amount * 100) / 100;
  }
  if (!partial || has('paidOn')) {
    const paidOn = String(body.paidOn || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(paidOn))) errors.push('paidOn must be a date (YYYY-MM-DD)');
    else row.paid_on = paidOn;
  }
  if (has('method')) row.method = body.method ? String(body.method).trim().slice(0, 40) : null;
  if (has('note')) row.note = body.note ? String(body.note).trim().slice(0, 500) : null;
  return { row, errors };
}

async function listPayments(supabase, proposalId) {
  const { data, error } = await supabase
    .from('fbpg_payments')
    .select(PAYMENT_FIELDS)
    .eq('proposal_id', proposalId)
    .order('paid_on', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function handlePayments(req, res, supabase) {
  const { id } = req.query || {};
  const body = req.body || {};

  if (req.method === 'POST') {
    if (!body.proposalId) return res.status(400).json({ error: 'proposalId is required' });
    const { row, errors } = paymentRowFromBody(body, false);
    if (errors.length) return res.status(400).json({ error: 'Invalid payment', details: errors.join('; ') });
    row.proposal_id = String(body.proposalId);
    const { error } = await supabase.from('fbpg_payments').insert(row);
    if (error) throw error;
    return res.status(200).json({ payments: await listPayments(supabase, row.proposal_id) });
  }

  if (!id) return res.status(400).json({ error: 'id is required' });
  const { data: existing, error: findError } = await supabase
    .from('fbpg_payments').select('proposal_id').eq('id', id).maybeSingle();
  if (findError) throw findError;
  if (!existing) return res.status(404).json({ error: 'Payment not found' });

  if (req.method === 'PATCH') {
    const { row, errors } = paymentRowFromBody(body, true);
    if (errors.length) return res.status(400).json({ error: 'Invalid payment', details: errors.join('; ') });
    if (!Object.keys(row).length) return res.status(400).json({ error: 'No updatable fields provided' });
    const { error } = await supabase.from('fbpg_payments').update(row).eq('id', id);
    if (error) throw error;
  } else if (req.method === 'DELETE') {
    const { error } = await supabase.from('fbpg_payments').delete().eq('id', id);
    if (error) throw error;
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return res.status(200).json({ payments: await listPayments(supabase, existing.proposal_id) });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, resource } = req.query || {};

  if (resource === 'payments') {
    try {
      return await handlePayments(req, res, getSupabaseClient());
    } catch (err) {
      console.error('Payment request failed:', err);
      return res.status(500).json({ error: 'Could not save payment', details: err.message });
    }
  }

  if (req.method !== 'GET' && req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = getSupabaseClient();

    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id is required' });
      // deposit/balance now live in fbpg_payments (?resource=payments).
      const { status, paymentNotes, clientId } = req.body || {};
      const row = {};
      if (status !== undefined) row.status = status;
      if (paymentNotes !== undefined) row.payment_notes = paymentNotes;
      if (clientId !== undefined) row.client_id = clientId || null;
      if (!Object.keys(row).length) return res.status(400).json({ error: 'No updatable fields provided' });

      const { data, error } = await supabase
        .from('fbpg_proposals')
        .update(row)
        .eq('id', id)
        .select('id, status, payment_notes, client_id, client:fbpg_clients(id, name)')
        .single();
      if (error) throw error;
      return res.status(200).json({ proposal: data });
    }

    if (id) {
      const { data, error } = await supabase.from('fbpg_proposals').select(`*, payments:fbpg_payments(${PAYMENT_FIELDS})`).eq('id', id).single();
      if (error) throw error;
      return res.status(200).json({ proposal: data });
    }

    const { data, error } = await supabase
      .from('fbpg_proposals')
      .select(`id, proposal_num, client_id, client:fbpg_clients(id, name), client_name, client_address, client_phone, client_email, date, total_amount, total_label, status, payment_notes, created_at, payments:fbpg_payments(${PAYMENT_FIELDS})`)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return res.status(200).json({ proposals: data });
  } catch (err) {
    console.error('Listing/updating proposals failed:', err);
    return res.status(500).json({ error: 'Could not load proposals', details: err.message });
  }
};
