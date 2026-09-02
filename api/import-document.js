const { getAnthropicClient } = require('../lib/anthropic');
const { getSupabaseClient } = require('../lib/supabase');
const { buildSnippetContext } = require('../lib/proposalContext');
const { buildSectionsProperty } = require('../lib/proposalDraftTool');
const { findClientMatches } = require('../lib/clientMatching');

const MODEL = 'claude-sonnet-5';
const ALLOWED_MEDIA_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const IMPORT_TOOL = {
  name: 'import_document_proposal',
  description:
    'Records client info and a grouped, rewritten scope-of-work extracted from an invoice, estimate, or proposal document, preserving the original line-item pricing.',
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
      sections: buildSectionsProperty({
        sectionsDescription:
          'The document\'s flat line items grouped into logical rooms/sections (by room, area, or trade), in reading order.',
        priceDescription: 'Total dollar price for this section, summed from the matching original line items.',
        itemsDescription:
          'The section\'s scope rewritten as concrete scope-of-work bullets in FB Construction\'s voice (see example library) -- ' +
          'not vague marketing language, and not inventing scope beyond what the original line items describe. Group related ' +
          'bullets under a tradeLabel header where useful.',
        titleDescription: 'Room or section name, e.g. "Kitchen" or "Electrical".',
      }),
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

async function importFromDocument(fileBase64, mediaType) {
  const anthropic = getAnthropicClient();
  const prompt =
    'This file is an invoice, estimate, or proposal for a residential remodeling job -- it may be a PDF exported from ' +
    'any software (not just QuickBooks), or a photo of a printed document. Extract the client\'s contact info and the ' +
    'line items, then group the (often flat, one-per-line) line items into logical rooms or sections the way a real FB ' +
    'Construction proposal is organized, and rewrite each section\'s items as specific, concrete scope-of-work bullets ' +
    '-- matching the voice and structure of the example categories below -- without inventing scope the original line ' +
    'item doesn\'t support. Preserve the original dollar amounts: each section\'s price should sum the line items ' +
    'grouped into it, and the sections should account for the document\'s total.\n\n' +
    `EXAMPLE SCOPE LIBRARY (real language from past proposals, for voice/style reference):\n${buildSnippetContext()}`;

  const fileBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: fileBase64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: fileBase64 } };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [IMPORT_TOOL],
    tool_choice: { type: 'tool', name: 'import_document_proposal' },
    messages: [
      {
        role: 'user',
        content: [fileBlock, { type: 'text', text: prompt }],
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

  const { fileBase64, mediaType } = req.body || {};
  if (typeof fileBase64 !== 'string' || !fileBase64) {
    return res.status(400).json({ error: 'fileBase64 is required' });
  }
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    return res.status(400).json({ error: `mediaType must be one of ${ALLOWED_MEDIA_TYPES.join(', ')}` });
  }
  // Vercel serverless functions cap the request body around 4.5MB; base64 adds
  // ~33% overhead, so keep real headroom under that before it 413s upstream.
  if (fileBase64.length > 4 * 1024 * 1024) {
    return res.status(400).json({ error: 'File is too large. Please upload a file under 3MB.' });
  }

  let proposal;
  try {
    proposal = await importFromDocument(fileBase64, mediaType);
  } catch (err) {
    console.error('Document import failed:', err);
    return res.status(502).json({ error: 'Could not import proposal from document', details: err.message });
  }

  let matches = [];
  try {
    const supabase = getSupabaseClient();
    matches = await findClientMatches(supabase, proposal.client);
  } catch (err) {
    console.error('Supabase client lookup failed (non-fatal):', err);
  }

  return res.status(200).json({ ...proposal, matches });
};
