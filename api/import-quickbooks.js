const { getAnthropicClient } = require('../lib/anthropic');
const { buildSnippetContext } = require('../lib/proposalContext');

const MODEL = 'claude-sonnet-5';

const IMPORT_TOOL = {
  name: 'import_quickbooks_proposal',
  description:
    'Records client info and a grouped, rewritten scope-of-work extracted from a QuickBooks-style proposal/estimate PDF, preserving the original line-item pricing.',
  input_schema: {
    type: 'object',
    properties: {
      client: {
        type: 'object',
        description: 'Client contact info found in the document. Empty string for any field not present -- do not guess.',
        properties: {
          name: { type: 'string' },
          address: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['name', 'address', 'phone', 'email'],
      },
      proposalNum: { type: 'string', description: 'Estimate or invoice number from the document, or empty string if not present.' },
      sections: {
        type: 'array',
        description:
          'The document\'s flat line items grouped into logical rooms/sections (by room, area, or trade), in reading order.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Room or section name, e.g. "Kitchen" or "Electrical".' },
            price: { type: 'number', description: 'Total dollar price for this section, summed from the matching original line items.' },
            items: {
              type: 'array',
              description:
                'The section\'s scope rewritten as concrete scope-of-work bullets in FB Construction\'s voice (see example library) -- ' +
                'not vague marketing language, and not inventing scope beyond what the original line items describe. Group related ' +
                'bullets under a tradeLabel header where useful.',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['tradeLabel', 'bullet'] },
                  text: { type: 'string' },
                },
                required: ['type', 'text'],
              },
            },
          },
          required: ['title', 'price', 'items'],
        },
      },
      notes: { type: 'string', description: 'Exclusions, allowances, or general notes found in the document. Empty string if none.' },
      clientSupplied: {
        type: 'array',
        description: 'Items noted as client-supplied / owner-furnished, if any.',
        items: { type: 'string' },
      },
    },
    required: ['client', 'proposalNum', 'sections', 'notes', 'clientSupplied'],
  },
};

async function importFromPdf(pdfBase64) {
  const anthropic = getAnthropicClient();
  const prompt =
    'This PDF is a QuickBooks-generated proposal or estimate for a residential remodeling job. Extract the client\'s ' +
    'contact info and the line items, then group the (often flat, one-per-line) line items into logical rooms or ' +
    'sections the way a real FB Construction proposal is organized, and rewrite each section\'s items as specific, ' +
    'concrete scope-of-work bullets -- matching the voice and structure of the example categories below -- without ' +
    'inventing scope the original line item doesn\'t support. Preserve the original dollar amounts: each section\'s ' +
    'price should sum the line items grouped into it, and the sections should account for the document\'s total.\n\n' +
    `EXAMPLE SCOPE LIBRARY (real language from past proposals, for voice/style reference):\n${buildSnippetContext()}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [IMPORT_TOOL],
    tool_choice: { type: 'tool', name: 'import_quickbooks_proposal' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) throw new Error('Model did not return a structured proposal');
  return toolUse.input;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pdfBase64 } = req.body || {};
  if (typeof pdfBase64 !== 'string' || !pdfBase64) {
    return res.status(400).json({ error: 'pdfBase64 is required' });
  }
  // Vercel serverless functions cap the request body around 4.5MB; base64 adds
  // ~33% overhead, so keep real headroom under that before it 413s upstream.
  if (pdfBase64.length > 4 * 1024 * 1024) {
    return res.status(400).json({ error: 'PDF is too large. Please upload a file under 3MB.' });
  }

  try {
    const proposal = await importFromPdf(pdfBase64);
    return res.status(200).json(proposal);
  } catch (err) {
    console.error('QuickBooks import failed:', err);
    return res.status(502).json({ error: 'Could not import proposal from PDF', details: err.message });
  }
};
