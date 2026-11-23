const { buildProposal } = require('../generator/buildProposal');
const { renderProposalHtml } = require('../generator/renderHtml');
const { validateProposalData } = require('../generator/validate');
const { applyLineItemTotals } = require('../generator/lineItems');
const { getSupabaseClient } = require('../lib/supabase');
const { saveClientForProposal } = require('../lib/clientMatching');

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// @sparticuz/chromium targets Amazon Linux and doesn't run under `vercel dev`
// on Windows/macOS. LOCAL_CHROMIUM=true (set in .env.local) swaps in the
// full `puppeteer` package (a devDependency, bundles its own Chromium) for
// local testing; production always uses puppeteer-core + @sparticuz/chromium.
async function launchBrowser() {
  if (process.env.LOCAL_CHROMIUM === 'true') {
    const { default: puppeteer } = await import('puppeteer');
    return puppeteer.launch();
  }
  // @sparticuz/chromium and puppeteer-core are both published as ESM-only,
  // so both must be dynamically imported even from this CommonJS file (a
  // plain require() fails at deploy time with "require() of ES Module ...
  // not supported").
  const { default: chromium } = await import('@sparticuz/chromium');
  const { default: puppeteer } = await import('puppeteer-core');
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
}

async function renderPdf(proposalData) {
  const html = renderProposalHtml(proposalData);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.15in', bottom: '0.15in', left: '0.15in', right: '0.15in' },
    });
  } finally {
    await browser.close();
  }
}

// Recorded payments (fbpg_payments) print on the proposal under the total
// (generator/paymentSummary.js). Always read from the database, never
// trusted from the request. A lookup failure is logged and the files are
// made without the payment lines rather than failing the whole save.
async function loadPayments(supabase, proposalId) {
  if (!proposalId) return [];
  const { data, error } = await supabase
    .from('fbpg_payments')
    .select('amount, paid_on, method, created_at')
    .eq('proposal_id', proposalId)
    .order('paid_on', { ascending: true });
  if (error) {
    console.error('payment lookup failed (non-fatal):', error);
    return [];
  }
  return data || [];
}

// A saved fbpg_proposals row back into the proposal data model the
// renderers take -- the inverse of the `row` built in handler() below.
function rowToProposalData(row) {
  return {
    id: row.id,
    proposalNum: row.proposal_num,
    date: row.date,
    clientId: row.client_id || undefined,
    client: {
      name: row.client_name,
      address: row.client_address || '',
      phone: row.client_phone || '',
      email: row.client_email || '',
    },
    sections: row.sections || [],
    totalAmount: Number(row.total_amount) || 0,
    totalLabel: row.total_label || '',
    notes: row.notes || '',
    clientSupplied: row.client_supplied || [],
    investmentNote: row.investment_note || undefined,
    paymentTerms: row.payment_terms || undefined,
    expirationDate: row.expiration_date || undefined,
    termsAndConditions: row.terms_and_conditions || undefined,
    status: row.status || 'Sent',
    paymentNotes: row.payment_notes || undefined,
  };
}

async function uploadFiles(supabase, proposalNum, docxBuffer, pdfBuffer) {
  const slug = `${proposalNum}-${Date.now()}`;
  const docxPath = `${slug}/proposal.docx`;
  const pdfPath = `${slug}/proposal.pdf`;
  const [docxUpload, pdfUpload] = await Promise.all([
    supabase.storage.from('proposals').upload(docxPath, docxBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    supabase.storage.from('proposals').upload(pdfPath, pdfBuffer, { contentType: 'application/pdf' }),
  ]);
  if (docxUpload.error) throw docxUpload.error;
  if (pdfUpload.error) throw pdfUpload.error;
  return { docxPath, pdfPath };
}

async function removeFiles(supabase, paths) {
  const oldPaths = [paths && paths.docx_storage_path, paths && paths.pdf_storage_path].filter(Boolean);
  if (!oldPaths.length) return;
  const { error } = await supabase.storage.from('proposals').remove(oldPaths);
  if (error) console.error('old file cleanup failed (non-fatal):', error);
}

// POST ?regenerate=<id>: remakes a saved proposal's Word/PDF from what's
// stored (plus its current payments) without changing anything else on
// the row -- called by Past Proposals after a payment is recorded, edited
// or deleted, so the files always show the current balance. Lives here
// (not api/proposals.js) because it needs this function's Chromium memory
// and time limits (vercel.json).
async function handleRegenerate(req, res, id) {
  try {
    const supabase = getSupabaseClient();
    const { data: row, error } = await supabase.from('fbpg_proposals').select('*').eq('id', id).single();
    if (error) throw error;
    const data = rowToProposalData(row);
    applyLineItemTotals(data);
    const { valid, errors } = validateProposalData(data);
    if (!valid) return res.status(400).json({ error: 'Saved proposal is not valid', details: errors });
    data.payments = await loadPayments(supabase, id);

    const [docxBuffer, pdfBuffer] = await Promise.all([buildProposal(data), renderPdf(data)]);
    const { docxPath, pdfPath } = await uploadFiles(supabase, data.proposalNum, docxBuffer, pdfBuffer);
    const { error: updateError } = await supabase
      .from('fbpg_proposals')
      .update({ docx_storage_path: docxPath, pdf_storage_path: pdfPath })
      .eq('id', id);
    if (updateError) {
      await removeFiles(supabase, { docx_storage_path: docxPath, pdf_storage_path: pdfPath });
      throw updateError;
    }
    await removeFiles(supabase, row);
    return res.status(200).json({ ok: true, id });
  } catch (err) {
    console.error('Regenerate failed:', err);
    return res.status(500).json({ error: 'Could not update the proposal files', details: err.message });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const regenerateId = req.query && req.query.regenerate ? String(req.query.regenerate) : '';
  if (regenerateId) return handleRegenerate(req, res, regenerateId);

  // Rooms with line items: price = sum of the lines (and the grand total
  // follows), so what's saved, the banner and the itemized list always agree.
  applyLineItemTotals(req.body);
  const { valid, errors } = validateProposalData(req.body);
  if (!valid) return res.status(400).json({ error: 'Invalid proposal data', details: errors });

  const data = req.body;
  // Payments come from the database only (an existing proposal's), never
  // from the request body.
  delete data.payments;
  if (data.id) {
    try {
      data.payments = await loadPayments(getSupabaseClient(), data.id);
    } catch (err) {
      console.error('payment lookup failed (non-fatal):', err);
    }
  }

  let docxBuffer;
  let pdfBuffer;
  try {
    [docxBuffer, pdfBuffer] = await Promise.all([buildProposal(data), renderPdf(data)]);
  } catch (err) {
    console.error('Proposal rendering failed:', err);
    return res.status(500).json({ error: 'Proposal generation failed', details: err.message });
  }

  try {
    const supabase = getSupabaseClient();

    // Editing a saved proposal: grab its previous file paths now, so they
    // can be cleaned up after the new files are safely uploaded and the row
    // is updated -- never delete the old files before the new ones exist.
    let previousPaths = null;
    if (data.id) {
      const { data: existing, error: existingError } = await supabase
        .from('fbpg_proposals')
        .select('docx_storage_path, pdf_storage_path')
        .eq('id', data.id)
        .single();
      if (existingError) throw existingError;
      previousPaths = existing;
    }

    const { docxPath, pdfPath } = await uploadFiles(supabase, data.proposalNum, docxBuffer, pdfBuffer);

    const [docxSigned, pdfSigned] = await Promise.all([
      supabase.storage.from('proposals').createSignedUrl(docxPath, SIGNED_URL_TTL_SECONDS),
      supabase.storage.from('proposals').createSignedUrl(pdfPath, SIGNED_URL_TTL_SECONDS),
    ]);
    if (docxSigned.error) throw docxSigned.error;
    if (pdfSigned.error) throw pdfSigned.error;

    // Keeps fbpg_clients (the search-as-you-type client list) in sync with
    // what was just proposed. Like the proposals write below, a failure here
    // must never block file delivery -- the proposal just saves unlinked.
    let clientId = data.clientId ?? null;
    try {
      clientId = await saveClientForProposal(supabase, data.client, data.clientId);
    } catch (clientErr) {
      console.error('client save failed (non-fatal):', clientErr);
    }

    const row = {
      proposal_num: data.proposalNum,
      client_id: clientId,
      client_name: data.client.name,
      client_address: data.client.address ?? null,
      client_phone: data.client.phone ?? null,
      client_email: data.client.email ?? null,
      date: data.date,
      sections: data.sections,
      total_amount: data.totalAmount,
      total_label: data.totalLabel ?? null,
      notes: data.notes ?? null,
      client_supplied: data.clientSupplied ?? null,
      investment_note: data.investmentNote ?? null,
      payment_terms: data.paymentTerms ?? null,
      expiration_date: data.expirationDate ?? null,
      terms_and_conditions: data.termsAndConditions ?? null,
      status: data.status || 'Sent',
      // Deposits/balance now live in fbpg_payments, recorded from Past
      // Proposals; saving a proposal never touches them.
      payment_notes: data.paymentNotes ?? null,
      docx_storage_path: docxPath,
      pdf_storage_path: pdfPath,
    };

    // A failed audit-trail write must never block file delivery -- the
    // user still gets both files even if this insert/update fails.
    const { data: savedRow, error: dbError } = data.id
      ? await supabase.from('fbpg_proposals').update(row).eq('id', data.id).select('id').single()
      : await supabase.from('fbpg_proposals').insert(row).select('id').single();
    if (dbError) console.error('proposals insert/update failed (non-fatal):', dbError);

    // Only clean up the old files once the new ones are uploaded and the
    // row points at them -- best-effort, must not affect the response.
    if (!dbError && previousPaths) await removeFiles(supabase, previousPaths);

    return res.status(200).json({
      docxUrl: docxSigned.data.signedUrl,
      pdfUrl: pdfSigned.data.signedUrl,
      id: savedRow ? savedRow.id : undefined,
      clientId: clientId || undefined,
    });
  } catch (err) {
    console.error('Storage/DB step failed:', err);
    return res.status(502).json({ error: 'Files were generated but could not be stored', details: err.message });
  }
};
