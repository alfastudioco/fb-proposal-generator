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
const SECTION_SCHEMA = {
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
};

// The model returns only what changed (a patch), not the whole proposal --
// echoing every room and the full Terms & Conditions back on each edit blew
// through max_tokens / the 60s function limit on real-sized proposals.
// applyEditPatch() below merges the patch into the proposal the client sent,
// so the endpoint's response shape is unchanged.
const EDIT_TOOL = {
  name: 'apply_proposal_edit',
  description:
    'Records ONLY the changes needed to carry out the instruction. Anything not mentioned here is kept exactly as-is.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      sectionChanges: {
        type: 'array',
        description:
          'One entry per room/section that is updated, added, or removed. Omit rooms the instruction does not touch. ' +
          '"index" is the 0-based position of the room in the CURRENT proposal (required for update/remove). ' +
          'For update/add, "section" is the complete room after the change (all its scope items, not just the new ones).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            op: { type: 'string', enum: ['update', 'add', 'remove'] },
            index: { type: 'integer' },
            section: SECTION_SCHEMA,
          },
          required: ['op'],
        },
      },
      fieldChanges: {
        type: 'object',
        additionalProperties: false,
        description: 'Only the proposal-level fields that change, with their complete new value. Omit unchanged fields.',
        properties: {
          notes: { type: 'string' },
          termsAndConditions: { type: 'string' },
          totalLabel: { type: 'string' },
          investmentNote: { type: 'string' },
          expirationDate: { type: 'string' },
          clientSupplied: { type: 'array', items: { type: 'string' } },
          paymentTerms: {
            type: ['object', 'null'],
            description: 'The complete new payment terms, or null to remove them.',
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
      },
    },
    required: ['sectionChanges', 'fieldChanges'],
  },
};

function editableSection(s) {
  return {
    title: s.title || '',
    subtitle: s.subtitle || '',
    price: Number(s.price) || 0,
    priceLabel: s.priceLabel || '',
    leftScope: s.leftScope || [],
    rightScope: s.rightScope || [],
  };
}

function applyEditPatch(proposal, patch) {
  const sections = (proposal.sections || []).map(editableSection);
  const changes = patch.sectionChanges || [];
  const isValidIndex = (c) => Number.isInteger(c.index) && c.index >= 0 && c.index < sections.length;

  changes.filter((c) => c.op === 'update' && c.section && isValidIndex(c))
    .forEach((c) => { sections[c.index] = editableSection(c.section); });
  // Removals by descending index so earlier removals don't shift later ones.
  changes.filter((c) => c.op === 'remove' && isValidIndex(c))
    .map((c) => c.index)
    .sort((a, b) => b - a)
    .forEach((i) => sections.splice(i, 1));
  changes.filter((c) => c.op === 'add' && c.section)
    .forEach((c) => sections.push(editableSection(c.section)));

  const fields = patch.fieldChanges || {};
  const pick = (key, fallback) => (Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : fallback);
  return {
    sections,
    notes: pick('notes', proposal.notes || ''),
    termsAndConditions: pick('termsAndConditions', proposal.termsAndConditions || ''),
    totalLabel: pick('totalLabel', proposal.totalLabel || ''),
    investmentNote: pick('investmentNote', proposal.investmentNote || ''),
    expirationDate: pick('expirationDate', proposal.expirationDate || ''),
    clientSupplied: pick('clientSupplied', proposal.clientSupplied || []),
    paymentTerms: pick('paymentTerms', proposal.paymentTerms || null),
  };
}

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

  // Only the fields the edit can touch -- client info, status, and deposit
  // tracking would just be noise in the prompt.
  const editable = applyEditPatch(proposal, {});
  const indexedSections = editable.sections.map((s, index) => ({ index, ...s }));

  const prompt = `You are editing an existing residential remodeling proposal for FB Construction. The contractor has \
described a change they want made. Record ONLY that change -- do not return rooms or fields the instruction doesn't \
affect. When you update a room, keep its untouched scope items (and their left/right column placement) exactly as \
they are in the input.

EXAMPLE SCOPE LIBRARY (real language from past proposals, for voice/style reference, in case the instruction asks for \
new scope language):
${buildSnippetContext()}

CURRENT PROPOSAL (JSON; each room's "index" is what sectionChanges refers to):
${JSON.stringify({ ...editable, sections: indexedSections }, null, 2)}

Contractor's requested change: "${instruction}"`;

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

    return res.status(200).json(applyEditPatch(proposal, toolUse.input));
  } catch (err) {
    console.error('Proposal edit failed:', err);
    return res.status(502).json({ error: 'Could not apply edit', details: err.message });
  }
}
