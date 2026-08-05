const { renderProposalHtml } = require('../generator/renderHtml');
const { validateProposalData } = require('../generator/validate');

// Renders the same HTML template used for PDF generation, without touching
// Chromium/Storage/Supabase, so there is exactly one HTML template in the
// codebase (used for both the live browser preview and the printed PDF).
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { valid, errors } = validateProposalData(req.body);
  if (!valid) return res.status(400).json({ error: 'Invalid proposal data', details: errors });

  try {
    return res.status(200).json({ html: renderProposalHtml(req.body) });
  } catch (err) {
    console.error('Preview rendering failed:', err);
    return res.status(500).json({ error: 'Preview rendering failed', details: err.message });
  }
};
