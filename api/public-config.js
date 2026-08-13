// Hands the browser the two values it needs to upload blueprint files
// directly to Supabase Storage (see api/blueprint-upload-url.js and
// app.js's uploadBlueprintFile). Both are safe to expose: the anon key
// alone grants nothing without a matching RLS policy or, for uploads, a
// one-time signed-upload token -- it is never the service role key.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY are not configured' });
  }
  return res.status(200).json({ supabaseUrl, supabaseAnonKey });
};
