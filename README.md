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
LOCAL_CHROMIUM=true         # forces the local full-puppeteer fallback instead of @sparticuz/chromium
ANTHROPIC_API_KEY=<from console.anthropic.com — powers image-based client-info extraction and AI scope generation>
```

Run the schema once against the Supabase project (SQL editor or CLI):
```
supabase/schema.sql
```
This creates `fbpg_clients` and `fbpg_proposals` — **not** `clients`/`proposals`. This Supabase project is shared with other apps in this workspace (cabinetprice/alfa-studio-tracker) that already own unprefixed `clients`/`proposals` tables with a different, unrelated schema. Do not rename these back — see `supabase/schema.sql`'s header comment.

Then create the **private** Storage bucket via:
```
npm run setup-bucket        # scripts/setup-storage-bucket.js — creates a private "proposals" bucket
```
(Storage buckets are a separate namespace from Postgres tables, so `proposals` here doesn't collide with anything — only the table names needed the `fbpg_` prefix.)

Local dev:
```
npm run dev        # runs `vercel dev`
```

On deploy, add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ANTHROPIC_API_KEY` to the Vercel project's Environment Variables (dashboard) — `.env.local` is not read in production.

## API

`POST /api/generate` — body matches the proposal data model in `generator/validate.js`. Returns `{ docxUrl, pdfUrl }` as 7-day signed Supabase Storage URLs.

`POST /api/preview` — same body, returns `{ html }` for the browser's live preview panel (no Storage/DB writes).

`POST /api/extract-client` — body `{ imageBase64, mediaType }` (a text/email screenshot, business card, or handwritten note). Returns `{ client: {name, phone, email, address}, matches }`, where `matches` are candidate `fbpg_clients` rows found by phone/email/name.

`GET /api/clients?q=` / `POST /api/clients` — search `fbpg_clients` by name, or create/update a client record (`{id?, name, address, phone, email}`).

`POST /api/generate-scope` — body `{ description, roomTitle? }`. Returns `{ items, suggestedPrice, priceRationale }`, grounded in `snippets.js`'s real scope-of-work library and past proposal pricing.

## Known limitations

- **Two independently-maintained visual code paths**: the `.docx` (via the `docx` library) and the `.pdf` (via headless Chromium rendering `generator/renderHtml.js`) are not derived from one another. Any layout change to one needs a manual pass over the other. Shared constants live in `generator/styles.js`.
- **Local Chromium ≠ production Chromium**: local dev falls back to full `puppeteer` (`LOCAL_CHROMIUM=true`), not the exact `@sparticuz/chromium` binary used in production. Validate PDF-fidelity changes against a real Vercel Preview Deployment.
- **Signed URLs expire after 7 days.** Revisiting an old proposal after that needs a fresh signed URL (not built yet).
