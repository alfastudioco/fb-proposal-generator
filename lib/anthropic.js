const Anthropic = require('@anthropic-ai/sdk');

let client;

// Lazily creates a server-side Anthropic client. Must only be called from
// server-side code (api/*.js), never bundled for the browser -- mirrors
// lib/supabase.js's getSupabaseClient() pattern.
function getAnthropicClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

module.exports = { getAnthropicClient };
