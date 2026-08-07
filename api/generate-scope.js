const { getAnthropicClient } = require('../lib/anthropic');
const { buildSnippetContext, getComparablePricing } = require('../lib/proposalContext');

const MODEL = 'claude-sonnet-5';

const GENERATE_TOOL = {
  name: 'generate_scope',
  description: 'Records a generated scope-of-work list and a rough price estimate for one proposal room/section.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Scope items in reading order. Group related bullets under a tradeLabel, alternating trade groups the way real proposals do.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['tradeLabel', 'bullet'] },
            text: { type: 'string' },
          },
          required: ['type', 'text'],
        },
      },
      suggestedPrice: { type: 'number', description: 'A rough total dollar price for this section, as a plain number (no currency symbol).' },
      priceRationale: { type: 'string', description: 'One or two sentences explaining the estimate and flagging it as a starting point that must be verified before sending.' },
    },
    required: ['items', 'suggestedPrice', 'priceRationale'],
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { description, roomTitle } = req.body || {};
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }

  const comparable = await getComparablePricing(`${description} ${roomTitle || ''}`);
  const comparableText = comparable.length
    ? comparable.map((c) => `- ${c.title}: $${c.price.toLocaleString('en-US')}`).join('\n')
    : '(no comparable past sections found)';

  const prompt = `You are writing a scope-of-work section for a residential remodeling proposal for FB Construction. \
Match the voice and structure of the example categories below: trade-label headers followed by specific, concrete \
bullet points (materials, dimensions, what's included) -- not vague marketing language.

EXAMPLE SCOPE LIBRARY (real language from past proposals, for voice/style reference):
${buildSnippetContext()}

RECENT COMPARABLE SECTION PRICING (for rough pricing context only -- may not be a close match):
${comparableText}

Room/section title: ${roomTitle || '(untitled)'}
Project description from the contractor: "${description}"

Generate a scope-of-work item list for this section, and a rough suggested total price. Clearly note in the \
rationale that the price is a starting estimate the contractor must verify.`;

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      tools: [GENERATE_TOOL],
      tool_choice: { type: 'tool', name: 'generate_scope' },
      messages: [{ role: 'user', content: prompt }],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse) throw new Error('Model did not return a structured scope');

    return res.status(200).json(toolUse.input);
  } catch (err) {
    console.error('Scope generation failed:', err);
    return res.status(502).json({ error: 'Could not generate scope', details: err.message });
  }
};
