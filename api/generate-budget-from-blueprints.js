const { toFile } = require('@anthropic-ai/sdk');
const { getAnthropicClient } = require('../lib/anthropic');
const { getSupabaseClient } = require('../lib/supabase');
const { buildSnippetContext, getComparablePricing } = require('../lib/proposalContext');
const { buildSectionsProperty } = require('../lib/proposalDraftTool');

const MODEL = 'claude-sonnet-5';
const FILES_API_BETA = 'files-api-2025-04-14';
const MAX_FILES = 15;
const TOTAL_SIZE_CAP_BYTES = 18 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = new Set(['application/pdf']);
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Must match the exact path format minted by api/blueprint-upload-url.js:
// `${crypto.randomUUID()}-${sanitizeFileName(fileName)}`. Rejecting anything else
// prevents a caller from passing a path-traversal string (e.g. "../proposals/x.pdf")
// that would make the service-role-keyed download() below reach outside the
// "blueprints" bucket.
const BLUEPRINT_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]+$/;

const DRAFT_FROM_BLUEPRINTS_TOOL = {
  name: 'draft_proposal_from_blueprints',
  description:
    'Records a full multi-section scope-of-work, with a rough starting price per section, drafted from uploaded ' +
    'architectural blueprint/plan files.',
  input_schema: {
    type: 'object',
    properties: {
      sections: buildSectionsProperty({
        sectionsDescription: 'The project split into logical rooms/areas, in a sensible working order, based on what the plans show.',
        priceDescription: 'A rough total dollar price for this section, as a plain number (no currency symbol).',
        itemsDescription:
          'Scope items in reading order. Group related bullets under a tradeLabel, alternating trade groups the way real proposals do.',
        titleDescription: 'Room or area name, e.g. "Kitchen" or "Hall Bathroom".',
      }),
      priceRationale: {
        type: 'string',
        description: 'One or two sentences explaining the overall estimate and flagging it as a starting point that must be verified before sending.',
      },
      notes: {
        type: 'string',
        description: 'Exclusions or general notes implied by the plans or the contractor\'s notes. Empty string if none.',
      },
      clientSupplied: {
        type: 'array',
        description: 'Items the plans or contractor notes imply the client/owner is supplying themselves, if any.',
        items: { type: 'string' },
      },
    },
    required: ['sections', 'priceRationale', 'notes', 'clientSupplied'],
  },
};

function mimeTypeToBlockType(mimeType) {
  if (DOCUMENT_MIME_TYPES.has(mimeType)) return 'document';
  if (IMAGE_MIME_TYPES.has(mimeType)) return 'image';
  return null;
}

async function fetchBlueprintFiles(supabase, paths) {
  let totalBytes = 0;
  const files = [];
  for (const path of paths) {
    const { data, error } = await supabase.storage.from('blueprints').download(path);
    if (error) throw new Error(`Could not download "${path}": ${error.message}`);
    const buffer = Buffer.from(await data.arrayBuffer());
    totalBytes += buffer.length;
    if (totalBytes > TOTAL_SIZE_CAP_BYTES) {
      throw Object.assign(new Error('Combined blueprint files exceed the size cap'), { statusCode: 400 });
    }
    const mimeType = data.type || 'application/octet-stream';
    const blockType = mimeTypeToBlockType(mimeType);
    if (!blockType) {
      throw Object.assign(new Error(`Unsupported file type "${mimeType}" for "${path}"`), { statusCode: 400 });
    }
    files.push({ path, buffer, mimeType, blockType });
  }
  return files;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paths, notes } = req.body || {};
  // Only the "is paths even an array" check can safely stay outside the try/finally:
  // if paths isn't a real array, there's nothing meaningful to pass to Storage's
  // .remove() below. Once we know paths is a genuine array, the browser has already
  // uploaded those files to Storage in an earlier step (Task 4) -- so every check from
  // here on (length bounds, notes shape) must happen inside the try block, so the
  // finally block's cleanup always gets a chance to run before we respond, even for a
  // request that fails validation.
  if (!Array.isArray(paths)) {
    return res.status(400).json({ error: `paths must be an array of 1 to ${MAX_FILES} blueprint file paths` });
  }

  const supabase = getSupabaseClient();
  const uploadedAnthropicFileIds = [];

  try {
    if (paths.length === 0 || paths.length > MAX_FILES) {
      return res.status(400).json({ error: `paths must be an array of 1 to ${MAX_FILES} blueprint file paths` });
    }
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000)) {
      return res.status(400).json({ error: 'notes must be a string under 2000 characters' });
    }
    if (!paths.every((p) => typeof p === 'string' && BLUEPRINT_PATH_RE.test(p))) {
      return res.status(400).json({ error: 'paths must be blueprint upload paths minted by this app' });
    }

    let blueprintFiles;
    try {
      blueprintFiles = await fetchBlueprintFiles(supabase, paths);
    } catch (err) {
      const statusCode = err.statusCode || 502;
      return res.status(statusCode).json({
        error: statusCode === 400
          ? `${err.message}. Upload just the relevant sheets (typically floor plans) or split into two passes.`
          : 'Could not read uploaded blueprint files',
        details: err.message,
      });
    }

    const anthropic = getAnthropicClient();
    const fileBlocks = [];
    for (const file of blueprintFiles) {
      const uploaded = await anthropic.beta.files.upload({
        file: await toFile(file.buffer, file.path, { type: file.mimeType }),
        betas: [FILES_API_BETA],
      });
      uploadedAnthropicFileIds.push(uploaded.id);
      fileBlocks.push({ type: file.blockType, source: { type: 'file', file_id: uploaded.id } });
    }

    const comparable = await getComparablePricing(notes || '');
    const comparableText = comparable.length
      ? comparable.map((c) => `- ${c.title}: $${c.price.toLocaleString('en-US')}`).join('\n')
      : '(no comparable past sections found)';

    const prompt = `You are drafting a residential remodeling proposal budget for FB Construction from uploaded \
architectural blueprint/plan files (floor plans, elevations, possibly structural or electrical sheets, or photos of \
printed plans). Read the plans to understand the scope: rooms/areas, dimensions, layout changes, and fixtures/\
finishes shown. Split the project into logical rooms/areas the way a real FB Construction proposal is organized, \
and write each section's scope in FB's voice: trade-label headers followed by specific, concrete bullet points \
(materials, dimensions, what's included) -- not vague marketing language.

EXAMPLE SCOPE LIBRARY (real language from past proposals, for voice/style reference):
${buildSnippetContext()}

RECENT COMPARABLE SECTION PRICING (for rough pricing context only -- may not be a close match):
${comparableText}

${notes ? `Contractor's notes (finish level, exclusions, anything the plans don't show): "${notes}"\n\n` : ''}Draft the full set of sections with a rough starting price each, based on what the plans show. Clearly note in \
the rationale that these prices are starting estimates the contractor must verify.`;

    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      betas: [FILES_API_BETA],
      tools: [DRAFT_FROM_BLUEPRINTS_TOOL],
      tool_choice: { type: 'tool', name: 'draft_proposal_from_blueprints' },
      messages: [{ role: 'user', content: [...fileBlocks, { type: 'text', text: prompt }] }],
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Model response was truncated (max_tokens reached) — try uploading fewer files or splitting into two passes');
    }

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse) throw new Error('Model did not return a structured proposal');

    return res.status(200).json(toolUse.input);
  } catch (err) {
    console.error('Blueprint budget drafting failed:', err);
    return res.status(502).json({ error: 'Could not draft a budget from the uploaded blueprints', details: err.message });
  } finally {
    try {
      const { error: removeError } = await supabase.storage.from('blueprints').remove(paths);
      if (removeError) console.error('Could not clean up blueprint Storage files (non-fatal):', removeError);
    } catch (err) {
      console.error('Could not clean up blueprint Storage files (non-fatal):', err.message);
    }

    for (const fileId of uploadedAnthropicFileIds) {
      try {
        await getAnthropicClient().beta.files.delete(fileId, { betas: [FILES_API_BETA] });
      } catch (err) {
        console.error('Could not clean up Anthropic file (non-fatal):', fileId, err.message);
      }
    }
  }
};
