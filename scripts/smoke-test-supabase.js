// Isolated Supabase smoke test: uploads a dummy buffer to Storage and
// inserts a dummy row into `fbpg_proposals`, independent of the
// docx/Chromium pipeline, to confirm credentials/table/bucket names are
// correct before wiring the full api/generate.js flow.
require('./load-env-local');
const { getSupabaseClient } = require('../lib/supabase');

async function main() {
  const supabase = getSupabaseClient();

  // 1. Confirm the fbpg_proposals table exists and is reachable. (Table
  // names are prefixed fbpg_ to avoid colliding with unrelated
  // proposals/clients tables another app in this Supabase project already
  // owns -- see supabase/schema.sql for the full story.)
  const { error: tableCheckError } = await supabase.from('fbpg_proposals').select('id').limit(1);
  if (tableCheckError) {
    console.error('Could not query `fbpg_proposals` table -- has supabase/schema.sql been run yet?');
    throw tableCheckError;
  }
  console.log('fbpg_proposals table reachable.');

  const { error: clientsCheckError } = await supabase.from('fbpg_clients').select('id').limit(1);
  if (clientsCheckError) {
    console.error('Could not query `fbpg_clients` table -- has supabase/schema.sql been run yet?');
    throw clientsCheckError;
  }
  console.log('fbpg_clients table reachable.');

  // 2. Upload a dummy buffer to Storage.
  const slug = `smoke-test-${Date.now()}`;
  const path = `${slug}/test.txt`;
  const { error: uploadError } = await supabase.storage
    .from('proposals')
    .upload(path, Buffer.from('smoke test'), { contentType: 'text/plain' });
  if (uploadError) throw uploadError;
  console.log('Uploaded dummy file to Storage:', path);

  const { data: signed, error: signError } = await supabase.storage.from('proposals').createSignedUrl(path, 60);
  if (signError) throw signError;
  console.log('Signed URL created:', signed.signedUrl.slice(0, 60) + '...');

  // 3. Insert a dummy row.
  const { data: inserted, error: insertError } = await supabase
    .from('fbpg_proposals')
    .insert({
      proposal_num: 'SMOKE-TEST',
      client_name: 'Smoke Test Client',
      date: 'January 1, 2000',
      sections: [{ num: 1, title: 'Test', price: 100, leftScope: [], rightScope: [] }],
      total_amount: 100,
      docx_storage_path: 'n/a',
      pdf_storage_path: 'n/a',
    })
    .select()
    .single();
  if (insertError) throw insertError;
  console.log('Inserted dummy proposals row:', inserted.id);

  // 4. Clean up both the dummy row and the dummy file.
  await supabase.storage.from('proposals').remove([path]);
  await supabase.from('fbpg_proposals').delete().eq('id', inserted.id);
  console.log('Cleaned up dummy row and file.');

  console.log('\nAll Supabase smoke tests passed.');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
