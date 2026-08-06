const { getAnthropicClient } = require('../lib/anthropic');
const { getSupabaseClient } = require('../lib/supabase');

const MODEL = 'claude-sonnet-5';
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const EXTRACT_TOOL = {
  name: 'extract_client_info',
  description: 'Records client contact info found in the image (a text/email screenshot, business card, or handwritten note).',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The client\'s full name, or empty string if not present in the image.' },
      phone: { type: 'string', description: 'Phone number as shown, or empty string if not present.' },
      email: { type: 'string', description: 'Email address, or empty string if not present.' },
      address: { type: 'string', description: 'Property or mailing address, or empty string if not present.' },
    },
    required: ['name', 'phone', 'email', 'address'],
  },
};

async function extractClientFromImage(imageBase64, mediaType) {
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: 'extract_client_info' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          {
            type: 'text',
            text:
              'This image may be a screenshot of a text/email conversation, a business card, or a handwritten ' +
              'intake note for a construction proposal client. Extract the client\'s name, phone, email, and ' +
              'mailing/property address. Use an empty string for any field not present in the image -- do not guess.',
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) throw new Error('Model did not return structured client info');
  return toolUse.input;
}

async function findClientMatches(supabase, client) {
  const filters = [];
  if (client.phone) filters.push(`phone.eq.${client.phone}`);
  if (client.email) filters.push(`email.eq.${client.email}`);
  if (client.name) filters.push(`name.ilike.%${client.name}%`);
  if (!filters.length) return [];

  const { data, error } = await supabase
    .from('fbpg_clients')
    .select('id, name, address, phone, email')
    .or(filters.join(','))
    .limit(5);
  if (error) {
    console.error('Client match lookup failed (non-fatal):', error);
    return [];
  }
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType } = req.body || {};
  if (typeof imageBase64 !== 'string' || !imageBase64) {
    return res.status(400).json({ error: 'imageBase64 is required' });
  }
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    return res.status(400).json({ error: `mediaType must be one of ${ALLOWED_MEDIA_TYPES.join(', ')}` });
  }

  let client;
  try {
    client = await extractClientFromImage(imageBase64, mediaType);
  } catch (err) {
    console.error('Client extraction failed:', err);
    return res.status(502).json({ error: 'Could not extract client info from image', details: err.message });
  }

  let matches = [];
  try {
    const supabase = getSupabaseClient();
    matches = await findClientMatches(supabase, client);
  } catch (err) {
    console.error('Supabase client lookup failed (non-fatal):', err);
  }

  return res.status(200).json({ client, matches });
};
