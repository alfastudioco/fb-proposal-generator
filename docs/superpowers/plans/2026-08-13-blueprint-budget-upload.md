# Blueprint Budget Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third way to populate the proposal editor — "Draft from blueprints" — where a contractor uploads blueprint/plan files (PDF plan sets, single sheets, or phone photos of prints) plus optional notes, and Claude reads them to draft priced proposal sections, exactly like the existing "AI draft from description" flow already does.

**Architecture:** Browser uploads files directly to a new private Supabase Storage bucket via signed URLs (bypassing Vercel's request body limit), then calls one new endpoint that downloads those files server-side, sends them to Claude via the Anthropic Files API (avoiding huge inline base64 payloads), and returns the same `{sections, priceRationale, notes, clientSupplied}` shape the description-based draft flow already produces. The frontend appends that result into the existing editor state — no changes to rendering, docx/PDF generation, or the editor itself.

**Tech Stack:** Node.js (CommonJS) on Vercel serverless functions, `@anthropic-ai/sdk@^0.115.0` (Files API is under `client.beta.*`, requires the `files-api-2025-04-14` beta flag), `@supabase/supabase-js@^2.112.0` Storage (signed upload URLs), plain browser JS (no framework, no bundler, no `<script>`-tagged Supabase client). Node 18+ (global `fetch`).

**Spec:** `docs/superpowers/specs/2026-08-13-blueprint-budget-upload-design.md`

## Global Constraints

- Deployed on Vercel **Hobby** — every function is hard-capped at 60s regardless of `maxDuration` config. Do not build anything that assumes a longer ceiling.
- `MAX_FILES = 15` per upload batch (both client and server enforce this).
- `TOTAL_SIZE_CAP_BYTES = 18 * 1024 * 1024` (~18MB combined, enforced client-side for fast feedback and server-side as the authoritative check).
- `ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']`. CAD/DWG/DXF is explicitly out of scope for this project.
- Anthropic Files API beta flag: `'files-api-2025-04-14'`. File-referencing content blocks (`source: { type: 'file', file_id }`) and file upload/delete only exist under `anthropic.beta.files.*` and `anthropic.beta.messages.create(...)` in the installed SDK — **not** the top-level `anthropic.messages.create(...)`, which does not support file sources in this SDK version.
- Model constant: `'claude-sonnet-5'` (matches every other AI endpoint in this repo).
- Uploaded blueprint files are never retained — delete from both Supabase Storage and Anthropic Files after each request, success or failure.
- No new database table. No async/polling/Batches-API infrastructure — this is explicitly out of scope (see spec).
- This is a single-tenant internal tool (no multi-user auth), so bucket-scoping (`supabase.storage.from('blueprints')`) is treated as a sufficient boundary — no additional per-path ownership checks are needed.

---

### Task 1: Public config endpoint for the browser-safe Supabase anon key

Direct-to-Storage uploads from the browser need Supabase's `apikey`/`Authorization` headers on the PUT request. The anon/public key is designed to be exposed this way — RLS and the one-time signed-upload token are the actual authorization boundary, not this key. Today's app has never shipped any Supabase credential to the browser, so this is a new (but standard, safe) pattern: a tiny endpoint that hands back `{ supabaseUrl, supabaseAnonKey }`.

**Files:**
- Modify: `.env.example`
- Create: `api/public-config.js`
- Test: `scripts/smoke-test-public-config.js`
- Modify: `package.json` (new npm script)

**Interfaces:**
- Produces: `GET /api/public-config` → `200 { supabaseUrl: string, supabaseAnonKey: string }`, or `500 { error }` if unconfigured. Consumed by `app.js` in Task 6.

- [ ] **Step 1: Add `SUPABASE_ANON_KEY` to `.env.example`**

Edit `.env.example`, adding after the existing `SUPABASE_SERVICE_ROLE_KEY=` line:

```
SUPABASE_URL=https://dasufgubibuutrpwounv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=

# Forces the local full-puppeteer fallback instead of @sparticuz/chromium,
# which targets Amazon Linux and does not run under `vercel dev` on Windows.
LOCAL_CHROMIUM=true

# From console.anthropic.com -- powers client-info extraction from images
# (api/extract-client.js) and AI scope-of-work generation (api/generate-scope.js).
ANTHROPIC_API_KEY=
```

- [ ] **Step 2: Add the real anon key to your local `.env.local`**

This is a manual step — get the value from the Supabase dashboard → Settings → API → "anon" / "public" key (**not** the service role key). Add `SUPABASE_ANON_KEY=<that value>` to `.env.local`. Every later task's tests in this plan that touch Storage uploads depend on this being set.

- [ ] **Step 3: Write `api/public-config.js`**

```js
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
```

- [ ] **Step 4: Write the smoke test**

Create `scripts/smoke-test-public-config.js`:

```js
require('./load-env-local');
const handler = require('../api/public-config');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}

async function main() {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  if (!res.body.supabaseUrl || !res.body.supabaseAnonKey) throw new Error('Missing supabaseUrl/supabaseAnonKey in response');
  console.log('public-config smoke test passed:', {
    supabaseUrl: res.body.supabaseUrl,
    supabaseAnonKey: res.body.supabaseAnonKey.slice(0, 8) + '...',
  });
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
```

- [ ] **Step 5: Run it before `SUPABASE_ANON_KEY` is set, confirm it fails**

Run: `node scripts/smoke-test-public-config.js` (with `SUPABASE_ANON_KEY` still blank in `.env.local`)
Expected: FAIL — `SMOKE TEST FAILED: Expected 200, got 500: ...SUPABASE_ANON_KEY are not configured...`

- [ ] **Step 6: Set the real key (per Step 2), run again, confirm it passes**

Run: `node scripts/smoke-test-public-config.js`
Expected: `public-config smoke test passed: { supabaseUrl: '...', supabaseAnonKey: '...' }`

- [ ] **Step 7: Add the npm script**

Edit `package.json`, in `"scripts"`, add:

```json
"smoke-test-public-config": "node scripts/smoke-test-public-config.js"
```

- [ ] **Step 8: Commit**

```bash
git add .env.example api/public-config.js scripts/smoke-test-public-config.js package.json
git commit -m "Add public-config endpoint for browser Storage uploads"
```

---

### Task 2: `blueprints` Storage bucket

**Files:**
- Create: `scripts/setup-blueprints-bucket.js`
- Modify: `package.json` (new npm script)

**Interfaces:**
- Produces: a private Supabase Storage bucket named `blueprints` (20MB file-size limit, mime-type allowlist matching `ALLOWED_MIME_TYPES`). Consumed by Tasks 4 and 5 via `supabase.storage.from('blueprints')`.

- [ ] **Step 1: Write the setup script**

Create `scripts/setup-blueprints-bucket.js`, mirroring the existing `scripts/setup-storage-bucket.js`:

```js
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
```

- [ ] **Step 2: Add the npm script**

Edit `package.json`, in `"scripts"`, add:

```json
"setup-blueprints-bucket": "node scripts/setup-blueprints-bucket.js"
```

- [ ] **Step 3: Run it against the real Supabase project**

Run: `npm run setup-blueprints-bucket`
Expected: `Created private bucket "blueprints".` (This creates real cloud infrastructure — additive only, does not touch the existing `proposals` bucket or any table.)

- [ ] **Step 4: Run it again, confirm idempotence**

Run: `npm run setup-blueprints-bucket`
Expected: `Bucket "blueprints" already exists. public: false` (no warning)

- [ ] **Step 5: Commit**

```bash
git add scripts/setup-blueprints-bucket.js package.json
git commit -m "Add setup script for the blueprints Storage bucket"
```

---

### Task 3: Shared `sections` schema factored out of the two existing AI-draft endpoints

`api/generate-full-proposal.js` and `api/import-quickbooks.js` each currently define an inline ~25-line JSON-schema for the `sections` array. A third near-copy (Task 5) is the trigger to factor out the shared *structure* into one helper — but the field wording is genuinely tailored per endpoint (e.g. import-quickbooks.js's items description says "preserve original amounts, don't invent scope," which the others don't say), so the refactor parameterizes the wording rather than hard-coding one shared string set. This keeps both existing endpoints byte-for-byte identical in behavior.

**Files:**
- Create: `lib/proposalDraftTool.js`
- Modify: `api/generate-full-proposal.js` (replace the inline `sections` property, lines 6-51 originally)
- Modify: `api/import-quickbooks.js` (replace the inline `sections` property, lines 7-62 originally)
- Test: `scripts/smoke-test-draft-tool-schema.js`

**Interfaces:**
- Produces: `buildSectionsProperty({ sectionsDescription, priceDescription, itemsDescription }) → JSON-schema object` for the `sections` array property. Consumed by both modified endpoints and by Task 5's new endpoint.

- [ ] **Step 1: Write the smoke test first**

Create `scripts/smoke-test-draft-tool-schema.js`:

```js
// Confirms the shared sections-schema factory produces the expected
// shape, and that the two endpoints that now depend on it still load.
const { buildSectionsProperty } = require('../lib/proposalDraftTool');

function main() {
  const schema = buildSectionsProperty({
    sectionsDescription: 'desc',
    priceDescription: 'price desc',
    itemsDescription: 'items desc',
  });
  if (schema.type !== 'array') throw new Error('Expected sections schema type "array"');
  const itemProps = schema.items.properties;
  if (!itemProps.title || !itemProps.price || !itemProps.items) {
    throw new Error('Missing expected section properties (title/price/items)');
  }
  const scopeItemEnum = itemProps.items.items.properties.type.enum;
  if (scopeItemEnum.join(',') !== 'tradeLabel,bullet') {
    throw new Error(`Unexpected scope item type enum: ${scopeItemEnum}`);
  }

  const fullProposalHandler = require('../api/generate-full-proposal');
  const importHandler = require('../api/import-quickbooks');
  if (typeof fullProposalHandler !== 'function') throw new Error('generate-full-proposal.js handler not callable');
  if (typeof importHandler !== 'function') throw new Error('import-quickbooks.js handler not callable');

  console.log('proposalDraftTool smoke test passed.');
}

main();
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `node scripts/smoke-test-draft-tool-schema.js`
Expected: FAIL — `Cannot find module '../lib/proposalDraftTool'`

- [ ] **Step 3: Write `lib/proposalDraftTool.js`**

```js
// Shared JSON-schema shape for the "sections" field in the AI tool-use
// output used by api/generate-full-proposal.js (draft from description),
// api/import-quickbooks.js (extract from PDF), and
// api/generate-budget-from-blueprints.js (draft from blueprint files).
// All three ask the model to return the same rooms/sections structure --
// title + price + scope items grouped under trade labels -- so the shape
// is shared here while each endpoint supplies its own wording for what
// it's asking the model to do.
function buildSectionsProperty({ sectionsDescription, priceDescription, itemsDescription }) {
  return {
    type: 'array',
    description: sectionsDescription,
    items: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Room or area name, e.g. "Kitchen" or "Hall Bathroom".' },
        price: { type: 'number', description: priceDescription },
        items: {
          type: 'array',
          description: itemsDescription,
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['tradeLabel', 'bullet'] },
              text: { type: 'string' },
            },
            required: ['type', 'text'],
          },
        },
      },
      required: ['title', 'price', 'items'],
    },
  };
}

module.exports = { buildSectionsProperty };
```

- [ ] **Step 4: Update `api/generate-full-proposal.js`**

Replace lines 1-51 (the `require`s through the end of the `DRAFT_TOOL` const) with:

```js
const { getAnthropicClient } = require('../lib/anthropic');
const { buildSnippetContext, getComparablePricing } = require('../lib/proposalContext');
const { buildSectionsProperty } = require('../lib/proposalDraftTool');

const MODEL = 'claude-sonnet-5';

const DRAFT_TOOL = {
  name: 'draft_full_proposal',
  description:
    'Records a full multi-section scope-of-work, with a rough starting price per section, drafted from a plain-language ' +
    'description of an entire remodeling project.',
  input_schema: {
    type: 'object',
    properties: {
      sections: buildSectionsProperty({
        sectionsDescription: 'The project split into logical rooms/areas, in a sensible working order.',
        priceDescription: 'A rough total dollar price for this section, as a plain number (no currency symbol).',
        itemsDescription:
          'Scope items in reading order. Group related bullets under a tradeLabel, alternating trade groups the way real proposals do.',
      }),
      priceRationale: {
        type: 'string',
        description: 'One or two sentences explaining the overall estimate and flagging it as a starting point that must be verified before sending.',
      },
      notes: { type: 'string', description: 'Exclusions or general notes implied by the description. Empty string if none.' },
      clientSupplied: {
        type: 'array',
        description: 'Items the description implies the client/owner is supplying themselves, if any.',
        items: { type: 'string' },
      },
    },
    required: ['sections', 'priceRationale', 'notes', 'clientSupplied'],
  },
};
```

The rest of the file (the `module.exports = async function handler...` block) is unchanged.

- [ ] **Step 5: Update `api/import-quickbooks.js`**

Replace lines 1-62 (the `require`s through the end of the `IMPORT_TOOL` const) with:

```js
const { getAnthropicClient } = require('../lib/anthropic');
const { buildSnippetContext } = require('../lib/proposalContext');
const { buildSectionsProperty } = require('../lib/proposalDraftTool');

const MODEL = 'claude-sonnet-5';

const IMPORT_TOOL = {
  name: 'import_quickbooks_proposal',
  description:
    'Records client info and a grouped, rewritten scope-of-work extracted from a QuickBooks-style proposal/estimate PDF, preserving the original line-item pricing.',
  input_schema: {
    type: 'object',
    properties: {
      client: {
        type: 'object',
        description: 'Client contact info found in the document. Empty string for any field not present -- do not guess.',
        properties: {
          name: { type: 'string' },
          address: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['name', 'address', 'phone', 'email'],
      },
      proposalNum: { type: 'string', description: 'Estimate or invoice number from the document, or empty string if not present.' },
      sections: buildSectionsProperty({
        sectionsDescription:
          'The document\'s flat line items grouped into logical rooms/sections (by room, area, or trade), in reading order.',
        priceDescription: 'Total dollar price for this section, summed from the matching original line items.',
        itemsDescription:
          'The section\'s scope rewritten as concrete scope-of-work bullets in FB Construction\'s voice (see example library) -- ' +
          'not vague marketing language, and not inventing scope beyond what the original line items describe. Group related ' +
          'bullets under a tradeLabel header where useful.',
      }),
      notes: { type: 'string', description: 'Exclusions, allowances, or general notes found in the document. Empty string if none.' },
      clientSupplied: {
        type: 'array',
        description: 'Items noted as client-supplied / owner-furnished, if any.',
        items: { type: 'string' },
      },
    },
    required: ['client', 'proposalNum', 'sections', 'notes', 'clientSupplied'],
  },
};
```

The rest of the file (`async function importFromPdf` onward) is unchanged.

- [ ] **Step 6: Run the smoke test again, confirm it passes**

Run: `node scripts/smoke-test-draft-tool-schema.js`
Expected: `proposalDraftTool smoke test passed.`

- [ ] **Step 7: Add the npm script**

Edit `package.json`, in `"scripts"`, add:

```json
"smoke-test-draft-tool-schema": "node scripts/smoke-test-draft-tool-schema.js"
```

- [ ] **Step 8: Commit**

```bash
git add lib/proposalDraftTool.js api/generate-full-proposal.js api/import-quickbooks.js scripts/smoke-test-draft-tool-schema.js package.json
git commit -m "Factor shared sections schema out of the two AI-draft endpoints"
```

---

### Task 4: `api/blueprint-upload-url.js`

**Files:**
- Create: `api/blueprint-upload-url.js`
- Modify: `vercel.json` (add `maxDuration: 30` entry)
- Test: `scripts/smoke-test-blueprint-upload-url.js`
- Modify: `package.json` (new npm script)

**Interfaces:**
- Consumes: `getSupabaseClient()` from `lib/supabase.js`.
- Produces: `POST /api/blueprint-upload-url` with body `{ fileName: string, mimeType: string }` → `200 { path: string, signedUrl: string, token: string }`, or `400`/`502` on error. Consumed by `app.js` in Task 6.

- [ ] **Step 1: Write the smoke test first**

Create `scripts/smoke-test-blueprint-upload-url.js`:

```js
// Exercises the full direct-to-Storage upload path end to end: mint a
// signed upload URL via the handler, PUT a small fixture buffer straight
// to Supabase Storage (mirroring what the browser will do), confirm it
// landed, then clean up. Requires SUPABASE_ANON_KEY in .env.local (see
// Task 1).
require('./load-env-local');
const handler = require('../api/blueprint-upload-url');
const { getSupabaseClient } = require('../lib/supabase');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}

async function main() {
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('SUPABASE_ANON_KEY must be set in .env.local for this smoke test');

  const res = mockRes();
  await handler({ method: 'POST', body: { fileName: 'smoke-test.pdf', mimeType: 'application/pdf' } }, res);
  if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  const { path, signedUrl } = res.body;
  console.log('Minted signed upload URL for path:', path);

  const fixture = Buffer.from('%PDF-1.4 smoke test fixture');
  const putRes = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/pdf',
    },
    body: fixture,
  });
  if (!putRes.ok) throw new Error(`Upload PUT failed: ${putRes.status} ${await putRes.text()}`);
  console.log('Uploaded fixture file directly to Storage.');

  const supabase = getSupabaseClient();
  const { data: downloaded, error: downloadError } = await supabase.storage.from('blueprints').download(path);
  if (downloadError) throw downloadError;
  const downloadedBuffer = Buffer.from(await downloaded.arrayBuffer());
  if (!downloadedBuffer.equals(fixture)) throw new Error('Downloaded content did not match uploaded fixture');
  console.log('Confirmed uploaded content matches.');

  await supabase.storage.from('blueprints').remove([path]);
  console.log('Cleaned up fixture file.');

  console.log('\nblueprint-upload-url smoke test passed.');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `node scripts/smoke-test-blueprint-upload-url.js`
Expected: FAIL — `Cannot find module '../api/blueprint-upload-url'`

- [ ] **Step 3: Write `api/blueprint-upload-url.js`**

```js
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
```

- [ ] **Step 4: Run the smoke test again, confirm it passes**

Run: `node scripts/smoke-test-blueprint-upload-url.js`
Expected: `blueprint-upload-url smoke test passed.`

- [ ] **Step 5: Add the `vercel.json` entry**

Edit `vercel.json`, in `"functions"`, add:

```json
"api/blueprint-upload-url.js": { "maxDuration": 30 },
```

- [ ] **Step 6: Add the npm script**

Edit `package.json`, in `"scripts"`, add:

```json
"smoke-test-blueprint-upload-url": "node scripts/smoke-test-blueprint-upload-url.js"
```

- [ ] **Step 7: Commit**

```bash
git add api/blueprint-upload-url.js scripts/smoke-test-blueprint-upload-url.js vercel.json package.json
git commit -m "Add blueprint-upload-url endpoint for direct-to-Storage uploads"
```

---

### Task 5: `api/generate-budget-from-blueprints.js`

The core endpoint: downloads the uploaded blueprint files from Storage, uploads each to the Anthropic Files API, sends one Messages call referencing all of them plus the same grounding (`buildSnippetContext()` + `getComparablePricing()`) the other AI-draft endpoints use, and cleans up both Storage and Anthropic Files afterward regardless of outcome.

**Files:**
- Create: `api/generate-budget-from-blueprints.js`
- Modify: `vercel.json` (add `maxDuration: 60` entry)
- Test: `scripts/smoke-test-generate-budget-from-blueprints.js`
- Modify: `package.json` (new npm script)

**Interfaces:**
- Consumes: `getSupabaseClient()` (`lib/supabase.js`), `getAnthropicClient()` (`lib/anthropic.js`), `buildSnippetContext()`/`getComparablePricing()` (`lib/proposalContext.js`), `buildSectionsProperty()` (`lib/proposalDraftTool.js`, Task 3), the `blueprints` bucket (Task 2), the file paths produced by Task 4.
- Produces: `POST /api/generate-budget-from-blueprints` with body `{ paths: string[], notes?: string }` → `200 { sections, priceRationale, notes, clientSupplied }` (same shape `/api/generate-full-proposal` returns), or `400`/`502` on error. Consumed by `app.js` in Task 6.

- [ ] **Step 1: Write the smoke test first (module-load only)**

This endpoint's real path costs a paid Anthropic API call per run, so — matching this repo's existing convention for AI-calling endpoints (see `scripts/smoke-test-import.js`) — the automated smoke test only confirms the module resolves and exports a handler; the real functional check is the manual pass in Task 6, Step 3.

Create `scripts/smoke-test-generate-budget-from-blueprints.js`:

```js
// Verifies api/generate-budget-from-blueprints.js resolves under plain
// Node (so Vercel's build-time tracing will bundle it correctly) without
// making a real (paid) Anthropic API call -- matches this repo's existing
// scripts/smoke-test-import.js convention for AI-calling endpoints.
const handler = require('../api/generate-budget-from-blueprints');
if (typeof handler !== 'function') {
  throw new Error('api/generate-budget-from-blueprints.js did not export a handler function');
}
console.log('api/generate-budget-from-blueprints.js loaded OK, handler type:', typeof handler);
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `node scripts/smoke-test-generate-budget-from-blueprints.js`
Expected: FAIL — `Cannot find module '../api/generate-budget-from-blueprints'`

- [ ] **Step 3: Write `api/generate-budget-from-blueprints.js`**

```js
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
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_FILES) {
    return res.status(400).json({ error: `paths must be an array of 1 to ${MAX_FILES} blueprint file paths` });
  }
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000)) {
    return res.status(400).json({ error: 'notes must be a string under 2000 characters' });
  }

  const supabase = getSupabaseClient();
  const uploadedAnthropicFileIds = [];

  try {
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

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse) throw new Error('Model did not return a structured proposal');

    return res.status(200).json(toolUse.input);
  } catch (err) {
    console.error('Blueprint budget drafting failed:', err);
    return res.status(502).json({ error: 'Could not draft a budget from the uploaded blueprints', details: err.message });
  } finally {
    const { error: removeError } = await supabase.storage.from('blueprints').remove(paths);
    if (removeError) console.error('Could not clean up blueprint Storage files (non-fatal):', removeError);

    for (const fileId of uploadedAnthropicFileIds) {
      try {
        await getAnthropicClient().beta.files.delete(fileId, { betas: [FILES_API_BETA] });
      } catch (err) {
        console.error('Could not clean up Anthropic file (non-fatal):', fileId, err.message);
      }
    }
  }
};
```

Note the `finally` block always removes **all** requested `paths` from Storage (not just the ones that made it through `fetchBlueprintFiles`) — a partial failure (e.g. hitting the size cap on file 4 of 5) must not orphan files 1-3, which are already sitting in Storage from the client's earlier upload step regardless of where server-side processing stopped.

- [ ] **Step 4: Run the smoke test again, confirm it passes**

Run: `node scripts/smoke-test-generate-budget-from-blueprints.js`
Expected: `api/generate-budget-from-blueprints.js loaded OK, handler type: function`

- [ ] **Step 5: Add the `vercel.json` entry**

Edit `vercel.json`, in `"functions"`, add:

```json
"api/generate-budget-from-blueprints.js": { "maxDuration": 60 },
```

- [ ] **Step 6: Add the npm script**

Edit `package.json`, in `"scripts"`, add:

```json
"smoke-test-generate-budget-from-blueprints": "node scripts/smoke-test-generate-budget-from-blueprints.js"
```

- [ ] **Step 7: Commit**

```bash
git add api/generate-budget-from-blueprints.js scripts/smoke-test-generate-budget-from-blueprints.js vercel.json package.json
git commit -m "Add generate-budget-from-blueprints endpoint"
```

---

### Task 6: Frontend — "Draft from Blueprints" card

**Files:**
- Modify: `index.html`
- Modify: `app.js`

**Interfaces:**
- Consumes: `GET /api/public-config` (Task 1), `POST /api/blueprint-upload-url` (Task 4), `POST /api/generate-budget-from-blueprints` (Task 5); existing `app.js` internals — `state`, `el(id)`, `nextSectionId()`, `splitSnippetItems(items)`, `renderRooms()`, `renderClientSupplied()`, `recalcTotals()`, `previewProposal()`.
- Produces: a working upload-and-draft UI, appending drafted sections to `state.sections` the same way `draftFullProposalBtn`'s handler already does (not a wholesale-replace like the QuickBooks import — blueprints don't carry client contact info any more than a typed description does).

- [ ] **Step 1: Add the new panel to `index.html`**

Insert a new `<section class="panel">` right after the existing "Import from QuickBooks" panel's closing `</section>` (immediately before the `<section class="panel">` that starts the "Client Information" block):

```html
    <section class="panel">
      <h2>Draft from Blueprints</h2>
      <label>Upload blueprints/plans (PDF or photos, up to 15 files)<input type="file" id="blueprintFilesInput" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" multiple></label>
      <textarea id="blueprintNotes" rows="2" placeholder="Finish level, exclusions, anything the plans don't show (optional)"></textarea>
      <button type="button" class="btn-add" id="draftFromBlueprintsBtn">Draft from Blueprints</button>
      <div id="blueprintDraftStatus" class="generate-status"></div>
    </section>
```

- [ ] **Step 2: Add the handler to `app.js`**

Insert the following block immediately after the closing `});` of the existing `el('draftFullProposalBtn').addEventListener(...)` listener (the block that ends the "Draft an entire proposal from one plain-language description" section):

```js
  // ---- Draft a full proposal from uploaded blueprint/plan files -------------
  //
  // Same append-to-current-state behavior as "Draft Full Proposal from
  // Description" above (not a reset like the QuickBooks import) -- plans
  // don't carry client contact info the way a QuickBooks estimate does, so
  // there's no client-info payload to wholesale-replace the form with.

  const BLUEPRINT_MAX_FILES = 15;
  const BLUEPRINT_TOTAL_SIZE_CAP_BYTES = 18 * 1024 * 1024;
  const BLUEPRINT_ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

  let publicConfigPromise = null;
  function getPublicConfig() {
    if (!publicConfigPromise) {
      publicConfigPromise = fetch('/api/public-config').then((res) => {
        if (!res.ok) throw new Error('Could not load Supabase config');
        return res.json();
      });
    }
    return publicConfigPromise;
  }

  async function uploadBlueprintFile(file, config) {
    const urlRes = await fetch('/api/blueprint-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, mimeType: file.type }),
    });
    const urlBody = await urlRes.json();
    if (!urlRes.ok) throw new Error(urlBody.error || `Could not get an upload URL for ${file.name}`);

    const putRes = await fetch(urlBody.signedUrl, {
      method: 'PUT',
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.supabaseAnonKey}`,
        'Content-Type': file.type,
      },
      body: file,
    });
    if (!putRes.ok) throw new Error(`Could not upload ${file.name}`);

    return urlBody.path;
  }

  el('draftFromBlueprintsBtn').addEventListener('click', async () => {
    const fileInput = el('blueprintFilesInput');
    const notesEl = el('blueprintNotes');
    const statusEl = el('blueprintDraftStatus');
    const files = Array.from(fileInput.files || []);

    if (!files.length) {
      statusEl.textContent = 'Choose at least one blueprint file first.';
      statusEl.className = 'generate-status error';
      return;
    }
    if (files.length > BLUEPRINT_MAX_FILES) {
      statusEl.textContent = `Choose ${BLUEPRINT_MAX_FILES} files or fewer.`;
      statusEl.className = 'generate-status error';
      return;
    }
    const badType = files.find((f) => !BLUEPRINT_ALLOWED_MIME_TYPES.includes(f.type));
    if (badType) {
      statusEl.textContent = `${badType.name} isn't a supported file type (PDF, JPEG, PNG, or WEBP).`;
      statusEl.className = 'generate-status error';
      return;
    }
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > BLUEPRINT_TOTAL_SIZE_CAP_BYTES) {
      statusEl.textContent = 'These files are too large combined. Upload just the relevant sheets (typically floor plans) or split into two passes.';
      statusEl.className = 'generate-status error';
      return;
    }

    try {
      statusEl.textContent = 'Uploading blueprints…';
      statusEl.className = 'generate-status';
      const config = await getPublicConfig();

      const paths = [];
      for (let i = 0; i < files.length; i += 1) {
        statusEl.textContent = `Uploading ${i + 1} of ${files.length}…`;
        paths.push(await uploadBlueprintFile(files[i], config));
      }

      statusEl.textContent = 'Reading blueprints and drafting scope — this can take a minute…';
      const res = await fetch('/api/generate-budget-from-blueprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, notes: notesEl.value.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        statusEl.textContent = body.error || 'Drafting failed.';
        statusEl.className = 'generate-status error';
        return;
      }

      for (const s of body.sections || []) {
        const { left, right } = splitSnippetItems(s.items || []);
        state.sections.push({
          id: nextSectionId(),
          title: s.title || '',
          subtitle: '',
          price: Number(s.price) || 0,
          priceLabel: '',
          description: '',
          scopeStatus: null,
          leftScope: left,
          rightScope: right,
        });
      }
      if (body.notes) {
        const notesTextarea = el('notes');
        notesTextarea.value = notesTextarea.value.trim() ? `${notesTextarea.value.trim()}\n${body.notes}` : body.notes;
      }
      if (Array.isArray(body.clientSupplied)) {
        state.clientSupplied.push(...body.clientSupplied);
      }

      fileInput.value = '';
      notesEl.value = '';
      statusEl.textContent = body.priceRationale || 'Done — review pricing and scope before generating.';
      statusEl.className = 'generate-status';

      renderRooms();
      renderClientSupplied();
      recalcTotals();
      previewProposal();
    } catch (err) {
      statusEl.textContent = `Drafting failed: ${err.message}`;
      statusEl.className = 'generate-status error';
    }
  });
```

- [ ] **Step 3: Manual end-to-end test**

This flow can't be exercised by an automated script (no test framework in this repo, and `vercel dev` needs an interactive `vercel login` — see `scripts/smoke-test-import.js`'s comment). Run manually:

1. `vercel dev` (or your usual local run command).
2. Open the app, scroll to the new "Draft from Blueprints" card.
3. Select 1-2 sample PDF/image files (a real or sample floor plan works), optionally add a note like "mid-range finishes, client supplying appliances."
4. Click "Draft from Blueprints" and watch the status line progress through uploading → drafting.
5. Confirm: rooms appear in "Rooms & Scope" with plausible titles/scope/prices, the live preview updates, and the status line shows the price rationale.
6. Confirm cleanup: check the Supabase dashboard's `blueprints` bucket — it should be empty again after the request completes.

- [ ] **Step 4: Commit**

```bash
git add index.html app.js
git commit -m "Add Draft from Blueprints UI"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update the Setup section**

In the `.env.local` code block, add the `SUPABASE_ANON_KEY` line with its rationale:

```
SUPABASE_ANON_KEY=<from Supabase dashboard → Settings → API — the anon/public key, safe to expose to the browser; used only by the blueprint-upload flow's direct-to-Storage PUT (see api/public-config.js)>
```

After the `npm run setup-bucket` line, add:

```
npm run setup-blueprints-bucket   # scripts/setup-blueprints-bucket.js -- creates a private "blueprints" bucket for the blueprint-upload flow
```

- [ ] **Step 2: Update the API section**

Add after the existing `POST /api/generate-scope` line:

```
`GET /api/public-config` — returns `{ supabaseUrl, supabaseAnonKey }` so the browser can upload blueprint files directly to Storage (bypassing Vercel's request body limit). Both values are safe to expose; see `api/public-config.js`.

`POST /api/blueprint-upload-url` — body `{ fileName, mimeType }` (`mimeType` one of `application/pdf`, `image/jpeg`, `image/png`, `image/webp`). Returns `{ path, signedUrl, token }` for a direct-to-Storage upload.

`POST /api/generate-budget-from-blueprints` — body `{ paths: string[], notes? }` (`paths` from the endpoint above, up to 15 files, ~18MB combined). Returns `{ sections, priceRationale, notes, clientSupplied }` — the same shape `/api/generate-full-proposal` returns — drafted by reading the uploaded blueprint/plan files with Claude's vision.
```

- [ ] **Step 3: Update Known limitations**

Add:

```
- **Blueprint uploads are capped at 15 files / ~18MB combined**, to keep the AI read comfortably inside Vercel Hobby's 60s function limit. Large plan sets need trimming to the relevant sheets (typically floor plans) or splitting into two uploads. CAD files (DWG/DXF) aren't supported -- export/plot to PDF first. Uploaded blueprint files are deleted immediately after each request and are never retained.
```

- [ ] **Step 4: Run every new smoke test together as a final regression pass**

Run:
```bash
npm run smoke-test-public-config
npm run smoke-test-draft-tool-schema
npm run smoke-test-blueprint-upload-url
npm run smoke-test-generate-budget-from-blueprints
```
Expected: all four print their "passed" / "loaded OK" line, none exit non-zero.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Document the blueprint-upload feature"
```
