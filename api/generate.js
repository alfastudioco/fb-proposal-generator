const { buildProposal } = require('../generator/buildProposal');
const { renderProposalHtml } = require('../generator/renderHtml');
const { validateProposalData } = require('../generator/validate');
const { getSupabaseClient } = require('../lib/supabase');

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { valid, errors } = validateProposalData(req.body);
  if (!valid) return res.status(400).json({ error: 'Invalid proposal data', details: errors });

  const data = req.body;

  let docxBuffer;
  let pdfBuffer;
  try {
    [docxBuffer, pdfBuffer] = await Promise.all([buildProposal(data), renderPdf(data)]);
  } catch (err) {
    console.error('Proposal rendering failed:', err);
    return res.status(500).json({ error: 'Proposal generation failed', details: err.message });
  }

  const slug = `${data.proposalNum}-${Date.now()}`;
  const docxPath = `${slug}/proposal.docx`;
  const pdfPath = `${slug}/proposal.pdf`;

  try {
    const supabase = getSupabaseClient();
    const [docxUpload, pdfUpload] = await Promise.all([
      supabase.storage.from('proposals').upload(docxPath, docxBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      supabase.storage.from('proposals').upload(pdfPath, pdfBuffer, { contentType: 'application/pdf' }),
    ]);
    if (docxUpload.error) throw docxUpload.error;
    if (pdfUpload.error) throw pdfUpload.error;

    const [docxSigned, pdfSigned] = await Promise.all([
      supabase.storage.from('proposals').createSignedUrl(docxPath, SIGNED_URL_TTL_SECONDS),
      supabase.storage.from('proposals').createSignedUrl(pdfPath, SIGNED_URL_TTL_SECONDS),
    ]);
    if (docxSigned.error) throw docxSigned.error;
    if (pdfSigned.error) throw pdfSigned.error;

    const { error: dbError } = await supabase.from('fbpg_proposals').insert({
      proposal_num: data.proposalNum,
      client_id: data.clientId ?? null,
      client_name: data.client.name,
      client_address: data.client.address ?? null,
      client_phone: data.client.phone ?? null,
      client_email: data.client.email ?? null,
      date: data.date,
      sections: data.sections,
      total_amount: data.totalAmount,
      total_label: data.totalLabel ?? null,
      notes: data.notes ?? null,
      payment_terms: data.paymentTerms ?? null,
      expiration_date: data.expirationDate ?? null,
      terms_and_conditions: data.termsAndConditions ?? null,
      docx_storage_path: docxPath,
      pdf_storage_path: pdfPath,
    });
    // A failed audit-trail write must never block file delivery -- the
    // user still gets both files even if this insert fails.
    if (dbError) console.error('proposals insert failed (non-fatal):', dbError);

    return res.status(200).json({ docxUrl: docxSigned.data.signedUrl, pdfUrl: pdfSigned.data.signedUrl });
  } catch (err) {
    console.error('Storage/DB step failed:', err);
    return res.status(502).json({ error: 'Files were generated but could not be stored', details: err.message });
  }
};
