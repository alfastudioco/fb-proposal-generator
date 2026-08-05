// One-time setup: creates the private `proposals` Storage bucket. Safe to
// re-run -- if the bucket already exists this just confirms it's private
// and reports its current config rather than erroring.
require('./load-env-local');
const { getSupabaseClient } = require('../lib/supabase');

async function main() {
  const supabase = getSupabaseClient();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;

  const existing = buckets.find((b) => b.name === 'proposals');
  if (existing) {
    console.log('Bucket "proposals" already exists. public:', existing.public);
    if (existing.public) {
      console.warn('WARNING: bucket is public, expected private. Not auto-changing -- update it in the dashboard.');
    }
    return;
  }

  const { error: createError } = await supabase.storage.createBucket('proposals', { public: false });
  if (createError) throw createError;
  console.log('Created private bucket "proposals".');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
