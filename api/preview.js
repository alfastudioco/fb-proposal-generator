const { renderProposalHtml } = require('../generator/renderHtml');

// Renders the same HTML template used for PDF generation, without touching
// Chromium/Storage/Supabase, so there is exactly one HTML template in the
// codebase (used for both the live browser preview and the printed PDF).
// editable: true adds contenteditable fields + add/remove controls, wired
// up via the bridge script generator/renderHtml.js embeds for this mode --
// harmless for /api/preview's only consumer (the app's iframe), and never
// used by api/generate.js's PDF rendering path.
//
// Deliberately does NOT run the strict validateProposalData used by
// api/generate.js -- this is a live view of in-progress editing (including
// edits made directly in the preview itself, see app.js's collectProposalData
// forPreview flag), so empty-but-just-added rows (e.g. right after clicking
// "+ Add bullet", before its text is typed) are expected and must still
// render, not be rejected. Only a light structural check here; renderHtml.js
// already defaults every field defensively.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body;
  if (!body || typeof body !== 'object' || !Array.isArray(body.sections) || !body.client || typeof body.client !== 'object') {
    return res.status(400).json({ error: 'Invalid proposal data', details: ['body.sections and body.client are required'] });
  }

  try {
    return res.status(200).json({ html: renderProposalHtml(req.body, { editable: true }) });
  } catch (err) {
    console.error('Preview rendering failed:', err);
    return res.status(500).json({ error: 'Preview rendering failed', details: err.message });
  }
};
