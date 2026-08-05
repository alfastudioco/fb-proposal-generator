const { createClient } = require('@supabase/supabase-js');

let client;

// Lazily creates a server-side Supabase client using the service role key
// (never the anon key — this bypasses RLS by design, see supabase/schema.sql).
// Must only be called from server-side code (api/*.js), never bundled for
// the browser.
function getSupabaseClient() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured');
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

module.exports = { getSupabaseClient };
