const { getAnthropicClient } = require('../lib/anthropic');
const { buildSnippetContext, getComparablePricing } = require('../lib/proposalContext');
const { buildSectionsProperty } = require('../lib/proposalDraftTool');

const MODEL = 'claude-sonnet-5';

const DRAFT_TOOL = {
  name: 'draft_full_proposal',
  description:
    'Records a full multi-section scope-of-work, with a rough starting price per section, drafted from a plain-language ' +
    'description of an entire remodeling project.',
  input_schema: {
    type: 'object',
    properties: {
      sections: buildSectionsProperty({
        sectionsDescription: 'The project split into logical rooms/areas, in a sensible working order.',
        priceDescription: 'A rough total dollar price for this section, as a plain number (no currency symbol).',
        itemsDescription:
          'Scope items in reading order. Group related bullets under a tradeLabel, alternating trade groups the way real proposals do.',
        titleDescription: 'Room or area name, e.g. "Kitchen" or "Hall Bathroom".',
      }),
      priceRationale: {
        type: 'string',
        description: 'One or two sentences explaining the overall estimate and flagging it as a starting point that must be verified before sending.',
      },
      notes: { type: 'string', description: 'Exclusions or general notes implied by the description. Empty string if none.' },
      clientSupplied: {
        type: 'array',
        description: 'Items the description implies the client/owner is supplying themselves, if any.',
        items: { type: 'string' },
      },
    },
    required: ['sections', 'priceRationale', 'notes', 'clientSupplied'],
  },
};

const SCOPE_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['tradeLabel', 'bullet'] },
    text: { type: 'string' },
  },
  required: ['type', 'text'],
};

// Distinct from buildSectionsProperty (used by DRAFT_TOOL above): that shape
// is a flat items[] list later split left/right by splitSnippetItems's
// alternating-trade-group heuristic, which is fine when drafting from
// nothing. Here, rooms already have an explicit, possibly hand-arranged
// leftScope/rightScope split, so this keeps both arrays separate end to end
// -- re-flattening and re-splitting on every edit would silently reshuffle
// column placement for rooms the instruction never mentioned.
const EDIT_TOOL = {
  name: 'apply_proposal_edit',
  description: 'Records the full proposal again with only the requested change applied; everything else unchanged.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      sections: {
        type: 'array',
        description: 'Every room/section, in order, after the edit. Include ALL sections, not just changed ones.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            subtitle: { type: 'string' },
            price: { type: 'number' },
            priceLabel: { type: 'string' },
            leftScope: { type: 'array', items: SCOPE_ITEM_SCHEMA },
            rightScope: { type: 'array', items: SCOPE_ITEM_SCHEMA },
          },
          required: ['title', 'price', 'leftScope', 'rightScope'],
        },
      },
      notes: { type: 'string' },
      termsAndConditions: { type: 'string' },
      totalLabel: { type: 'string' },
      investmentNote: { type: 'string' },
      expirationDate: { type: 'string' },
      clientSupplied: { type: 'array', items: { type: 'string' } },
      paymentTerms: {
        type: ['object', 'null'],
        properties: {
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, amount: { type: 'number' } },
              required: ['label', 'amount'],
            },
          },
          note: { type: 'string' },
        },
      },
    },
    required: ['sections', 'notes', 'termsAndConditions', 'totalLabel', 'investmentNote', 'expirationDate', 'clientSupplied', 'paymentTerms'],
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const mode = req.query && req.query.mode === 'edit' ? 'edit' : 'draft';
  return mode === 'edit' ? handleEdit(req, res) : handleDraft(req, res);
};

async function handleDraft(req, res) {
  const { description } = req.body || {};
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }

  const comparable = await getComparablePricing(description);
  const comparableText = comparable.length
    ? comparable.map((c) => `- ${c.title}: $${c.price.toLocaleString('en-US')}`).join('\n')
    : '(no comparable past sections found)';

  const prompt = `You are drafting an entire residential remodeling proposal for FB Construction from a contractor's plain-\
language description of the whole job. Split the project into logical rooms/areas the way a real FB Construction \
proposal is organized, and write each section's scope in FB's voice: trade-label headers followed by specific, \
concrete bullet points (materials, dimensions, what's included) -- not vague marketing language.

EXAMPLE SCOPE LIBRARY (real language from past proposals, for voice/style reference):
${buildSnippetContext()}

RECENT COMPARABLE SECTION PRICING (for rough pricing context only -- may not be a close match):
${comparableText}

Project description from the contractor: "${description}"

Draft the full set of sections with a rough starting price each. Clearly note in the rationale that these prices are \
starting estimates the contractor must verify.`;

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [DRAFT_TOOL],
      tool_choice: { type: 'tool', name: 'draft_full_proposal' },
      messages: [{ role: 'user', content: prompt }],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse) throw new Error('Model did not return a structured proposal');

    return res.status(200).json(toolUse.input);
  } catch (err) {
    console.error('Full proposal draft failed:', err);
    return res.status(502).json({ error: 'Could not draft proposal', details: err.message });
  }
}

async function handleEdit(req, res) {
  const { proposal, instruction } = req.body || {};
  if (typeof instruction !== 'string' || !instruction.trim()) {
    return res.status(400).json({ error: 'instruction is required' });
  }
  if (!proposal || typeof proposal !== 'object') {
    return res.status(400).json({ error: 'proposal is required' });
  }

  const prompt = `You are editing an existing residential remodeling proposal for FB Construction. The contractor has \
described a change they want made. Apply ONLY that change. Every other field -- including scope bullets, prices, and \
which column (left vs right) each scope item is in for rooms not mentioned by the instruction -- must come back \
byte-for-byte identical to the input.

EXAMPLE SCOPE LIBRARY (real language from past proposals, for voice/style reference, in case the instruction asks for \
new scope language):
${buildSnippetContext()}

CURRENT PROPOSAL (JSON):
${JSON.stringify(proposal, null, 2)}

Contractor's requested change: "${instruction}"

Return the full proposal again -- all sections, notes, terms and conditions, investment summary fields, client-supplied \
items, and payment terms (if present) -- with only the requested change applied.`;

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [EDIT_TOOL],
      tool_choice: { type: 'tool', name: 'apply_proposal_edit' },
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('This proposal is too large to edit in one pass — try a narrower instruction or a smaller proposal.');
    }

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse) throw new Error('Model did not return a structured edit');

    return res.status(200).json(toolUse.input);
  } catch (err) {
    console.error('Proposal edit failed:', err);
    return res.status(502).json({ error: 'Could not apply edit', details: err.message });
  }
}
