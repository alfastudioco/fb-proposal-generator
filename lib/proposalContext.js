// Shared grounding context for AI-assisted scope/pricing generation --
// used by both api/generate-scope.js (typed description -> scope) and
// api/import-quickbooks.js (uploaded PDF -> full proposal). One copy of
// the snippet-library formatting and the past-proposal pricing lookup
// rather than duplicating both across the two endpoints.
const SNIPPET_LIBRARY = require('../snippets');
const { getSupabaseClient } = require('./supabase');

function buildSnippetContext() {
  return SNIPPET_LIBRARY.categories
    .map((cat) => {
      const lines = cat.items.map((it) => (it.type === 'tradeLabel' ? `  [${it.text}]` : `  - ${it.text}`));
      return `${cat.label}:\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

function pickComparablePricing(proposals, keywordText) {
  const words = keywordText.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  if (!words.length) return [];

  const candidates = [];
  for (const proposal of proposals) {
    for (const section of proposal.sections || []) {
      if (!section || !section.title || typeof section.price !== 'number') continue;
      const title = section.title.toLowerCase();
      if (words.some((w) => title.includes(w))) {
        candidates.push({ title: section.title, price: section.price });
      }
    }
  }
  return candidates;
}

async function getComparablePricing(keywordText, limit = 8) {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('fbpg_proposals')
      .select('sections')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return pickComparablePricing(data, keywordText).slice(0, limit);
  } catch (err) {
    console.error('Comparable pricing lookup failed (non-fatal):', err);
    return [];
  }
}

module.exports = { buildSnippetContext, getComparablePricing };
