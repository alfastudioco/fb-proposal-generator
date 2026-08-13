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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
};
