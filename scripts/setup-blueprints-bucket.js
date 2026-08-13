// One-time setup: creates the private `blueprints` Storage bucket used by
// the blueprint-to-budget upload flow. Safe to re-run -- if the bucket
// already exists this just confirms it's private and reports its current
// config rather than erroring. Unlike `proposals`, this bucket holds
// transient input files (deleted right after each AI read), so it's
// configured with a file-size/type allowlist as defense in depth.
require('./load-env-local');
const { getSupabaseClient } = require('../lib/supabase');

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

async function main() {
  const supabase = getSupabaseClient();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;

  const existing = buckets.find((b) => b.name === 'blueprints');
  if (existing) {
    console.log('Bucket "blueprints" already exists. public:', existing.public);
    if (existing.public) {
      console.warn('WARNING: bucket is public, expected private. Not auto-changing -- update it in the dashboard.');
    }
    return;
  }

  const { error: createError } = await supabase.storage.createBucket('blueprints', {
    public: false,
    fileSizeLimit: '20mb',
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  });
  if (createError) throw createError;
  console.log('Created private bucket "blueprints".');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
