# Upload Blueprints → AI-Drafted Budget

## Purpose

Add a third way to populate the proposal editor, alongside the existing
"AI draft from description" (`api/generate-full-proposal.js`) and "Import
QuickBooks PDF" (`api/import-quickbooks.js`) flows: a contractor uploads
blueprint/plan files (PDF plan sets, single sheets, or phone photos of
printed plans) plus optional free-text notes, and Claude reads the plans
to draft the same kind of section-by-section scope + rough pricing the
other two flows already produce. The result feeds into the same editor,
live preview, and docx/PDF generation — nothing downstream of the
editor's state changes.

## Explicitly out of scope (for this project)

- **CAD/DWG/DXF files.** Not readable as images the way Claude's vision
  reads a PDF/image plan sheet. If a contractor only has a CAD file,
  they export/plot it to PDF first (most CAD tools support this). Native
  CAD parsing is a separate future project.
- **Detailed line-item takeoff** (quantities × unit costs, e.g. "320 sf
  drywall @ $2.10/sf"). Output stays in the same shape the tool already
  produces: one rough total price per section, with a rationale noting
  it's a starting estimate the contractor must verify. A real takeoff
  would need a maintained unit-cost rate table, which doesn't exist in
  this codebase today.
- **Async processing / Anthropic Batches API.** The project is deployed
  on Vercel Hobby, which hard-caps serverless functions at 60 seconds
  with no way to extend it. Rather than build a job-tracking table +
  polling endpoints + polling UI to handle arbitrarily large plan sets,
  this design caps total upload size so the single synchronous request
  comfortably finishes inside that ceiling. If the project later moves
  to Vercel Pro, this cap can be relaxed without changing the
  architecture.
- **Retaining uploaded blueprint files.** They're a transient input to
  one AI call, not a saved deliverable like generated proposals. They're
  deleted (Storage + Anthropic Files) immediately after the call
  completes, success or failure.

## Architecture

```
Browser                          Vercel functions                 External
--------                         -----------------                --------
1. Pick files + notes
2. For each file:
   POST /api/blueprint-upload-url
   { fileName, mimeType }   ---> mint signed upload URL  ------->  Supabase Storage
                             <--- { path, signedUrl }               bucket "blueprints"
   PUT file to signedUrl    -------------------------------------> (direct browser upload,
                                                                     bypasses Vercel body limit)
3. POST /api/generate-budget-from-blueprints
   { paths, notes }         ---> download files from Storage --->  Supabase Storage
                                  upload each to Anthropic
                                  Files API                  --->  Anthropic Files API
                                  build prompt + call
                                  Messages API w/ forced
                                  tool_choice                --->  Claude (vision)
                                  <-- structured draft
                                  delete Storage objects +
                                  Anthropic files (finally)
                             <--- { sections, priceRationale,
                                    notes, clientSupplied }
4. loadImportedProposal(body)   (existing function, unchanged --
                                  same shape the other two AI
                                  flows already return)
```

No new database table. No job-tracking state. The only new persistent
piece is the `blueprints` Storage bucket, and objects in it are
short-lived (uploaded, read once, deleted).

## Components

### Supabase bucket: `blueprints`

Created via `scripts/setup-blueprints-bucket.js`, mirroring the existing
`scripts/setup-storage-bucket.js` pattern (idempotent: reports and warns
if it already exists and is misconfigured, rather than erroring).

Unlike the `proposals` bucket, create it with:
```js
supabase.storage.createBucket('blueprints', {
  public: false,
  fileSizeLimit: '20MB',       // defense in depth alongside the app-level cap below
  allowedMimeTypes: ALLOWED_MIME_TYPES,
});
```

### `api/blueprint-upload-url.js`

`POST { fileName: string, mimeType: string }`

- Validates `mimeType` is one of `ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']` (400 if not).
- Builds a storage path like `${crypto.randomUUID()}-${sanitizeFileName(fileName)}`.
- Calls `supabase.storage.from('blueprints').createSignedUploadUrl(path)`.
- Returns `{ path, signedUrl, token }`.

The browser then uploads directly to `signedUrl` via a plain `fetch(signedUrl, { method: 'PUT', headers: {...}, body: file })` — Supabase's signed upload URLs are PUT-able directly without requiring the `@supabase/supabase-js` client in the browser (the app has never loaded the JS SDK client-side; everything today goes through `api/*.js` with the service-role key server-side only, and this preserves that — no Supabase key of any kind ships to the browser). **Implementation note:** confirm the exact required headers (`Content-Type`, possibly `x-upsert`) against the installed `@supabase/supabase-js@^2.112.0` version's signed-upload-URL docs when building this, since this repo hasn't used this Storage feature before.

`maxDuration: 30` in `vercel.json` (fast — no AI call here).

### `api/generate-budget-from-blueprints.js`

`POST { paths: string[], notes?: string }`

1. Validate: `1 <= paths.length <= MAX_FILES` (15), each path was minted by this app (defense: re-derive/check against an expected prefix pattern, not user-supplied arbitrary paths), `notes` is a string under 2000 chars if present. 400 on violation.
2. Download each file from `blueprints` via `supabase.storage.from('blueprints').download(path)`, summing byte sizes as they come in. If the running total exceeds `TOTAL_SIZE_CAP_BYTES` (18MB), abort and return 400 with a message telling the contractor to upload fewer/smaller sheets (typically: floor plans only, skip structural/electrical/elevation sheets) or split into two passes. This check happens **before** any Anthropic Files API calls, so an oversized set costs nothing beyond the Storage download.
3. Upload each downloaded file to the Anthropic Files API to get a `file_id` (avoids re-encoding large files as base64 inline in the Messages call, which existing endpoints do but which doesn't scale to multi-file plan sets). **Implementation note:** this repo's existing AI endpoints (`extract-client.js`, `import-quickbooks.js`) only use inline base64 `source: { type: 'base64', ... }` blocks — this is the first use of the Files API here. Confirm the exact `anthropic.files.create(...)` call shape against the installed `@anthropic-ai/sdk@^0.115.0` during implementation.
4. Build the Messages call:
   - `messages: [{ role: 'user', content: [...fileBlocks, { type: 'text', text: prompt }] }]`, where each `fileBlocks` entry is `{ type: 'document', source: { type: 'file', file_id } }` for PDFs or `{ type: 'image', source: { type: 'file', file_id } }` for images, in upload order.
   - `prompt` follows the existing endpoints' voice: explains the files are architectural blueprints/plans (floor plans, elevations, possibly structural/electrical sheets, or photos of printed plans) for a residential remodel; instructs Claude to read them for scope — rooms/areas, dimensions, layout changes, fixtures/finishes shown; to combine that with the contractor's notes if provided; to draft sections the way FB Construction organizes real proposals, in the same voice as `buildSnippetContext()`'s example library; and to clearly flag prices as starting estimates that must be verified.
   - Comparable pricing: `getComparablePricing(notes || '')` — same mechanism `description` feeds today. If `notes` is empty, this naturally returns `[]` (existing `pickComparablePricing` behavior), same graceful degradation the description-based flow already has when given a sparse description.
   - `tools: [DRAFT_FROM_BLUEPRINTS_TOOL]`, `tool_choice: { type: 'tool', name: 'draft_proposal_from_blueprints' }`, `max_tokens: 4096` (matches `generate-full-proposal.js`).
5. Extract `toolUse.input`, return `200` with it.
6. **`finally` block** (runs on success, on Claude-call failure, and on any error after files were fetched): delete the Storage objects (`supabase.storage.from('blueprints').remove(paths)`) and delete each uploaded Anthropic file (`anthropic.files.delete(file_id)`). Best-effort — log failures, don't let cleanup errors override the real response/error already being sent.
7. On Claude-call failure or missing `tool_use`, return `502` with `{ error, details }`, matching the existing endpoints' error shape.

`maxDuration: 60` in `vercel.json` (Hobby's max).

### `lib/proposalDraftTool.js` (new — small refactor)

The sections/items tool schema is currently duplicated near-identically
in `generate-full-proposal.js`'s `DRAFT_TOOL` and `import-quickbooks.js`'s
`IMPORT_TOOL`. Adding a third near-copy for this endpoint is the trigger
to factor out the shared part:

```js
const SECTIONS_PROPERTY = { /* the array-of-{title,price,items} schema, moved as-is */ };

const COMMON_TOOL_PROPERTIES = {
  sections: SECTIONS_PROPERTY,
  priceRationale: { type: 'string', description: '...' },
  notes: { type: 'string', description: '...' },
  clientSupplied: { type: 'array', items: { type: 'string' }, description: '...' },
};

module.exports = { SECTIONS_PROPERTY, COMMON_TOOL_PROPERTIES };
```

- `generate-full-proposal.js`'s `DRAFT_TOOL.input_schema.properties` becomes `{ ...COMMON_TOOL_PROPERTIES }`.
- `import-quickbooks.js`'s `IMPORT_TOOL.input_schema.properties` becomes `{ client: {...}, proposalNum: {...}, ...COMMON_TOOL_PROPERTIES }`.
- The new `DRAFT_FROM_BLUEPRINTS_TOOL.input_schema.properties` is `{ ...COMMON_TOOL_PROPERTIES }`, `required: ['sections', 'priceRationale', 'notes', 'clientSupplied']` — same required set as `generate-full-proposal.js` (no client info, since blueprints don't identify the client the way a QuickBooks estimate does).

This is a mechanical extraction — no behavior change to the two existing endpoints.

### Frontend (`index.html` + `app.js`)

New card in the same area as the existing "AI draft from description" /
"Import QuickBooks PDF" controls:

- `<input type="file" id="blueprintFilesInput" multiple accept=".pdf,image/jpeg,image/png,image/webp">`
- `<textarea id="blueprintNotes" placeholder="Finish level, exclusions, anything the plans don't show (optional)">`
- `<button id="draftFromBlueprintsBtn">Draft from blueprints</button>`
- `<div id="blueprintDraftStatus" class="generate-status">`

Handler in `app.js`, same style as the existing `importQuickbooksBtn`
listener:

1. Client-side pre-check (fast feedback, no network round-trip): file count ≤ `MAX_FILES`, each file's type in the allowlist, combined size ≤ `TOTAL_SIZE_CAP_BYTES`. Reject with a clear status message if not — these mirror the server-side checks but exist purely for UX; the server re-validates authoritatively since client checks are trivially bypassable.
2. For each file, in sequence (status text updates "Uploading 2 of 5…"): `POST /api/blueprint-upload-url`, then `fetch(signedUrl, { method: 'PUT', ... })`. Collect the returned `path`s. A single file's upload failure surfaces its own error and stops (contractor can remove/retry).
3. `POST /api/generate-budget-from-blueprints` with `{ paths, notes }`; status text "Reading blueprints and drafting scope — this can take a minute…".
4. On success, call the existing `loadImportedProposal(body)` unchanged — same wholesale-replace-the-form behavior the QuickBooks import already has.
5. On failure at any step, show `body.error` (or a generic message) in the status line, styled the same as the existing error states.

No changes needed to `loadImportedProposal`, `renderRooms`, `previewProposal`, or anything downstream — this flow produces exactly the shape those already consume.

## Data flow / error handling summary

| Failure point | Behavior |
|---|---|
| Bad file type/count/size (client) | Rejected before any network call, clear inline message |
| Bad file type/count/size (server, e.g. tampered request) | 400 before touching Storage/Anthropic where possible |
| Signed upload URL PUT fails | That file's status shows an error; contractor retries just that file |
| Combined downloaded size > 18MB | 400, no Anthropic Files/Messages calls made, tells contractor to trim the set |
| Anthropic call fails / no tool_use | 502 with `{ error, details }`, matching existing endpoints |
| Any of the above after files were fetched | `finally` cleans up Storage objects + Anthropic files regardless |

## Testing

- `scripts/smoke-test-blueprint-budget.js`, mirroring the existing
  `scripts/smoke-test-*.js` style (no formal test framework in this
  repo): mints upload URLs for a small fixture PDF and a fixture JPEG,
  uploads them, calls `generate-budget-from-blueprints`, asserts the
  response has a `sections` array with `title`/`price`/`items`, a
  non-empty `priceRationale`, and then lists the `blueprints` bucket to
  confirm the uploaded objects were actually removed afterward.
- Manual test: run a real (or sample) floor plan PDF through the new
  card, review the drafted sections in the live preview before treating
  them as real, same as any AI-drafted content in this tool today.
- This feature only ever populates editor state before the existing
  generate flow — it does not touch `generator/renderHtml.js`, the docx
  path, or any rendering code, so it's additive/isolated with no
  regression risk to existing docx/PDF output. Existing
  `smoke-test-html.js` / `smoke-test-banners.js` coverage is unaffected.

## `vercel.json` additions

```json
"api/blueprint-upload-url.js": { "maxDuration": 30 },
"api/generate-budget-from-blueprints.js": { "maxDuration": 60 }
```

## Known limitations (carried into README on implementation)

- CAD/DWG/DXF not supported — convert to PDF first.
- Output is one rough price per section, not a detailed quantity/unit-cost takeoff.
- Total upload size is capped (~18MB combined) to stay inside Vercel Hobby's 60s function ceiling — large plan sets need trimming to the relevant sheets or splitting into two passes.
- Uploaded blueprint files are not retained after processing.
