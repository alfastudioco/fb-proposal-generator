const crypto = require('crypto');
const { getSupabaseClient } = require('../lib/supabase');

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function sanitizeFileName(fileName) {
  const base = String(fileName || 'file').split(/[/\\]/).pop();
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'file';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { fileName, mimeType } = req.body || {};
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return res.status(400).json({ error: `mimeType must be one of ${ALLOWED_MIME_TYPES.join(', ')}` });
  }

  const path = `${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage.from('blueprints').createSignedUploadUrl(path);
    if (error) throw error;
    return res.status(200).json({ path: data.path, signedUrl: data.signedUrl, token: data.token });
  } catch (err) {
    console.error('Could not create blueprint upload URL:', err);
    return res.status(502).json({ error: 'Could not create upload URL', details: err.message });
  }
};
