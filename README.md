# FB Construction — Proposal Generator

Generates branded FB Construction proposals as Word (.docx) and PDF files from a web form. Deployed on Vercel, backed by Supabase (Postgres + Storage).

## Phase 1 scope

Built now: core proposal type — client info, one or more room/section banners, two-column scope of work, client-supplied items, one proposal-level notes box, investment + commitment box, contact footer, signature lines.

Explicitly **not** built yet (designed for, not built — see `generator/totals.js`'s stub exports):
- Payment terms box (deposit/balance) in place of the commitment box
- Addendum / "Updated Proposal" type with line-item + payment-summary tables
- Multi-page millwork/spec-heavy proposal type (cover page, spec tables, warranty/terms sections)
- Supabase `clients` table autocomplete/reuse in the UI (table exists, UI wiring is a follow-up)
- Signed-URL refresh flow for viewing proposals after their 7-day link expires

## Setup

```
npm install
npm run extract-logo        # one-time: pulls the FB Construction logo out of ../deckbuilder/index.html
```

Create `.env.local` (gitignored) with:
```
SUPABASE_URL=https://dasufgubibuutrpwounv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard → Settings → API — NOT the anon key>
SUPABASE_ANON_KEY=<from Supabase dashboard → Settings → API — the anon/public key, safe to expose to the browser; used only by the blueprint-upload flow's direct-to-Storage PUT (see api/public-config.js)>
LOCAL_CHROMIUM=true         # forces the local full-puppeteer fallback instead of @sparticuz/chromium
ANTHROPIC_API_KEY=<from console.anthropic.com — powers image-based client-info extraction and AI scope generation>
```

Run the schema once against the Supabase project (SQL editor or CLI):
```
supabase/schema.sql
```
This creates `fbpg_clients` and `fbpg_proposals` — **not** `clients`/`proposals`. This Supabase project is shared with other apps in this workspace (cabinetprice/alfa-studio-tracker) that already own unprefixed `clients`/`proposals` tables with a different, unrelated schema. Do not rename these back — see `supabase/schema.sql`'s header comment.

Then create the **private** Storage buckets via:
```
npm run setup-bucket        # scripts/setup-storage-bucket.js — creates a private "proposals" bucket
npm run setup-blueprints-bucket   # scripts/setup-blueprints-bucket.js -- creates a private "blueprints" bucket for the blueprint-upload flow
```
(Storage buckets are a separate namespace from Postgres tables, so `proposals` and `blueprints` here don't collide with anything — only the table names needed the `fbpg_` prefix.)

Local dev:
```
npm run dev        # runs `vercel dev`
```

On deploy, add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, and `ANTHROPIC_API_KEY` to the Vercel project's Environment Variables (dashboard) — `.env.local` is not read in production.

## API

`POST /api/generate` — body matches the proposal data model in `generator/validate.js`. Returns `{ docxUrl, pdfUrl }` as 7-day signed Supabase Storage URLs.

`POST /api/preview` — same body, returns `{ html }` for the browser's live preview panel (no Storage/DB writes).

`POST /api/extract-client` — body `{ imageBase64, mediaType }` (a text/email screenshot, business card, or handwritten note). Returns `{ client: {name, phone, email, address}, matches }`, where `matches` are candidate `fbpg_clients` rows found by phone/email/name.

`GET /api/clients?q=` / `POST /api/clients` — search `fbpg_clients` by name, or create/update a client record (`{id?, name, address, phone, email}`).

`POST /api/generate-scope` — body `{ description, roomTitle? }`. Returns `{ items, suggestedPrice, priceRationale }`, grounded in `snippets.js`'s real scope-of-work library and past proposal pricing.

`POST /api/generate-full-proposal` — body `{ description }`. Returns `{ sections, priceRationale, notes, clientSupplied }` — drafted from a full-project plain-language description.

`POST /api/generate-full-proposal?mode=edit` — body `{ proposal, instruction }`, where `proposal` is the same shape the form sends to `/api/generate`/`/api/preview` and `instruction` is a plain-language description of the change to make. Returns `{ sections, notes, termsAndConditions, totalLabel, investmentNote, expirationDate, clientSupplied, paymentTerms }` — the full proposal again, with only the requested change applied. Powers the "Tell it what to change" chat panel; the frontend diffs this against what it sent and shows the difference for the contractor to Apply or Cancel before anything is written to the form. Never touches `client`, `proposalNum`, or `date` — those fields aren't part of this mode's output schema.

`GET /api/public-config` — returns `{ supabaseUrl, supabaseAnonKey }` so the browser can upload blueprint files directly to Storage (bypassing Vercel's request body limit). Both values are safe to expose; see `api/public-config.js`.

`POST /api/blueprint-upload-url` — body `{ fileName, mimeType }` (`mimeType` one of `application/pdf`, `image/jpeg`, `image/png`, `image/webp`). Returns `{ path, signedUrl, token }` for a direct-to-Storage upload.

`POST /api/generate-budget-from-blueprints` — body `{ paths: string[], notes? }` (`paths` from the endpoint above, up to 15 files, ~18MB combined). Returns `{ sections, priceRationale, notes, clientSupplied }` — the same shape `/api/generate-full-proposal` returns — drafted by reading the uploaded blueprint/plan files with Claude's vision.

`GET /api/clients?resource=note-snippets` — lists the user-managed library of reusable "Additional Notes" snippets (`fbpg_note_snippets`), returned as `{ noteSnippets: [{id, label, text}] }`. These supplement (don't replace) the hardcoded notes in `snippets.js`, and are managed from the "Manage custom notes" panel under Additional Notes & Exclusions in the UI — no code change needed to add one. `POST /api/clients?resource=note-snippets` creates (`{label, text}`) or updates (`{id, label, text}`) one; `DELETE /api/clients?resource=note-snippets&id=` removes one. (Merged into `api/clients.js` rather than its own endpoint file to stay under Vercel Hobby's 12-serverless-function-per-deployment cap — `api/clients.js` was picked because it had no frontend caller yet, see below.)

## Known limitations

- **Blueprint uploads are capped at 15 files / ~18MB combined**, to keep the AI read comfortably inside Vercel Hobby's 60s function limit. Large plan sets need trimming to the relevant sheets (typically floor plans) or splitting into two uploads. CAD files (DWG/DXF) aren't supported -- export/plot to PDF first. Uploaded blueprint files are deleted immediately after each request and are never retained. If the browser's upload step fails partway through a multi-file batch, already-uploaded files for that batch are not automatically cleaned up (no bucket lifecycle rule is configured yet) -- low-stakes for this single-tenant internal tool, but worth knowing.
- **Two independently-maintained visual code paths**: the `.docx` (via the `docx` library) and the `.pdf` (via headless Chromium rendering `generator/renderHtml.js`) are not derived from one another. Any layout change to one needs a manual pass over the other. Shared constants live in `generator/styles.js`.
- **Local Chromium ≠ production Chromium**: local dev falls back to full `puppeteer` (`LOCAL_CHROMIUM=true`), not the exact `@sparticuz/chromium` binary used in production. Validate PDF-fidelity changes against a real Vercel Preview Deployment.
- **Signed URLs expire after 7 days.** Revisiting an old proposal after that needs a fresh signed URL (not built yet).
- **The chat-edit panel** ("Tell it what to change") can't touch client name/address/phone/email, proposal number, or date — those stay manual. It has no memory across messages (each one reads the live form fresh), only one proposed edit can be pending confirmation at a time, and clicking Apply overwrites the form from the snapshot taken when you hit Send — any manual edits made in between are lost.
