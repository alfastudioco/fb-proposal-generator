// Exercises api/clients.js's ?resource=note-snippets branch end to end
// against the real Supabase project: create, list, update, delete a note
// snippet, confirming the `fbpg_note_snippets` table exists and is
// reachable (supabase/schema.sql must have been run first). Note snippets
// are merged into api/clients.js rather than their own file to stay under
// Vercel Hobby's 12-serverless-function-per-deployment cap.
require('./load-env-local');
const handler = require('../api/clients');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}

async function call(req) {
  const res = mockRes();
  await handler({ ...req, query: { ...req.query, resource: 'note-snippets' } }, res);
  return res;
}

async function main() {
  const createRes = await call({ method: 'POST', body: { label: 'Smoke Test Note', text: 'Smoke test note text.' } });
  if (createRes.statusCode !== 200) throw new Error(`Create failed: ${createRes.statusCode} ${JSON.stringify(createRes.body)}`);
  const created = createRes.body.noteSnippet;
  console.log('Created note snippet:', created.id);

  const listRes = await call({ method: 'GET', query: {} });
  if (listRes.statusCode !== 200) throw new Error(`List failed: ${listRes.statusCode} ${JSON.stringify(listRes.body)}`);
  if (!listRes.body.noteSnippets.some((n) => n.id === created.id)) throw new Error('Created snippet not found in list');
  console.log('Listed note snippets, found created one.');

  const updateRes = await call({ method: 'POST', body: { id: created.id, label: 'Smoke Test Note (edited)', text: 'Edited text.' } });
  if (updateRes.statusCode !== 200) throw new Error(`Update failed: ${updateRes.statusCode} ${JSON.stringify(updateRes.body)}`);
  if (updateRes.body.noteSnippet.label !== 'Smoke Test Note (edited)') throw new Error('Update did not stick');
  console.log('Updated note snippet.');

  const deleteRes = await call({ method: 'DELETE', query: { id: created.id } });
  if (deleteRes.statusCode !== 200) throw new Error(`Delete failed: ${deleteRes.statusCode} ${JSON.stringify(deleteRes.body)}`);
  console.log('Deleted note snippet.');

  const finalListRes = await call({ method: 'GET', query: {} });
  if (finalListRes.body.noteSnippets.some((n) => n.id === created.id)) throw new Error('Deleted snippet still present in list');
  console.log('Confirmed deletion.');

  console.log('\nnote-snippets smoke test passed.');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
