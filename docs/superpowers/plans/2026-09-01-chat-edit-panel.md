# Conversational Chat-Edit Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the contractor type a plain-language instruction (e.g. "add the Studio41 discount note" or "bump the kitchen price to 45k") and have it propose a full-proposal edit, which they review as a diff and Apply or Cancel — no field-hunting.

**Architecture:** `api/generate-full-proposal.js` gains a `mode=edit` branch (dispatched by query param, alongside the existing `mode=draft`/no-param behavior) that sends Claude the full current proposal JSON + the instruction and gets back the full proposal again via forced tool-use. `app.js` gets a new chat panel that snapshots the current form (`collectProposalData()`), calls that endpoint, diffs old vs. new client-side, and — only on the user clicking Apply — writes the new values into the form using the same field-population style `loadProposalForEdit` already uses.

**Tech Stack:** `@anthropic-ai/sdk` (already a dependency), forced tool-use (matches every other AI endpoint in this repo), vanilla JS (no framework, matches `app.js`), no new database table.

**Spec:** `docs/superpowers/specs/2026-09-01-chat-edit-design.md`

## Global Constraints

- No formal JS test framework in this repo — `scripts/smoke-test-*.js` files hit real APIs directly with plain `assert`-via-`throw` checks and `console.log` output; this plan follows that exact convention, not jest/mocha.
- The project is at Vercel Hobby's 12-serverless-function cap (see `git log` — a prior feature broke production by adding a 13th `api/*.js` file). **Do not create a new file under `api/`.** The edit mode is a branch inside the existing `api/generate-full-proposal.js`.
- Model is `claude-sonnet-5`, matching every existing AI endpoint in this file.
- The chat tool may only ever change: `sections[].{title,subtitle,price,priceLabel,leftScope,rightScope}`, `notes`, `termsAndConditions`, `totalLabel`, `investmentNote`, `expirationDate`, `clientSupplied`, `paymentTerms`. It must never be able to change `client.*`, `proposalNum`, or `date` — enforced structurally (these fields are absent from the tool's output schema), not just by prompt instruction.
- `scratch/` is gitignored in this repo — use it for any throwaway verification scripts/servers so nothing test-only lands in the commit.

---

### Task 1: `mode=edit` branch in `api/generate-full-proposal.js`

**Files:**
- Modify: `api/generate-full-proposal.js` (currently 88 lines, single `module.exports = async function handler`)
- Create: `scripts/smoke-test-generate-full-proposal-edit.js`
- Modify: `package.json:7-17` (`scripts` block — add the new smoke-test script)
- Modify: `README.md` (API section — document the new mode)

**Interfaces:**
- Consumes: `lib/anthropic.js`'s `getAnthropicClient()` (existing), `lib/proposalContext.js`'s `buildSnippetContext()` (existing) — both already imported by this file.
- Produces: `POST /api/generate-full-proposal?mode=edit` with body `{ proposal: object, instruction: string }` → `200` with `{ sections, notes, termsAndConditions, totalLabel, investmentNote, expirationDate, clientSupplied, paymentTerms }` (the shape Task 2's `applyEditedProposal(newData)` consumes) or `400`/`502` with `{ error, details? }`. `POST /api/generate-full-proposal` with no `mode` (or `mode=draft`) keeps its existing behavior and response shape unchanged — this is a hard requirement, not just a nice-to-have, since the existing frontend call site (`draftFullProposalBtn` handler in `app.js`) must keep working with zero changes.

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/smoke-test-generate-full-proposal-edit.js`:

```js
// Exercises api/generate-full-proposal.js's mode=edit branch end to end
// against the real Claude API: a notes-only instruction should change
// notes and leave sections untouched; a price-only instruction should
// change one room's price and leave notes/scope untouched.
require('./load-env-local');
const handler = require('../api/generate-full-proposal');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}

async function callEdit(body) {
  const res = mockRes();
  await handler({ method: 'POST', query: { mode: 'edit' }, body }, res);
  return res;
}

const BASE_PROPOSAL = {
  proposalNum: '1901',
  date: 'January 1, 2026',
  client: { name: 'Jane Smith', address: '123 Main St', phone: '', email: '' },
  sections: [
    {
      title: 'Kitchen',
      subtitle: '',
      price: 40000,
      priceLabel: '',
      leftScope: [
        { type: 'tradeLabel', text: 'Demo & Structural' },
        { type: 'bullet', text: 'Demo existing kitchen cabinets' },
      ],
      rightScope: [
        { type: 'tradeLabel', text: 'Finishes' },
        { type: 'bullet', text: 'Paint two coats Benjamin Moore' },
      ],
    },
  ],
  clientSupplied: ['Kitchen sink'],
  notes: 'Permit fees not included.',
  totalLabel: 'Kitchen Remodel',
  investmentNote: '',
  expirationDate: '',
  termsAndConditions: '',
  paymentTerms: undefined,
};

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  const res1 = await callEdit({
    proposal: BASE_PROPOSAL,
    instruction: 'Add a note that our vendor network gives 25-40% discounts at Studio41 for plumbing fixtures.',
  });
  if (res1.statusCode !== 200) throw new Error(`Note edit failed: ${res1.statusCode} ${JSON.stringify(res1.body)}`);
  if (!deepEqual(res1.body.sections, BASE_PROPOSAL.sections)) throw new Error('Sections changed on a notes-only instruction');
  if (res1.body.notes === BASE_PROPOSAL.notes) throw new Error('Notes did not change');
  if (!/studio41|discount/i.test(res1.body.notes)) throw new Error(`New notes text doesn't look right: ${res1.body.notes}`);
  console.log('Case 1 passed: note added, sections untouched.');
  console.log('  New notes:', res1.body.notes);

  const res2 = await callEdit({
    proposal: BASE_PROPOSAL,
    instruction: 'Change the Kitchen price to 45000.',
  });
  if (res2.statusCode !== 200) throw new Error(`Price edit failed: ${res2.statusCode} ${JSON.stringify(res2.body)}`);
  if (res2.body.notes !== BASE_PROPOSAL.notes) throw new Error('Notes changed on a price-only instruction');
  const kitchen = res2.body.sections.find((s) => s.title === 'Kitchen');
  if (!kitchen) throw new Error('Kitchen section missing from response');
  if (Number(kitchen.price) !== 45000) throw new Error(`Kitchen price is ${kitchen.price}, expected 45000`);
  if (!deepEqual(kitchen.leftScope, BASE_PROPOSAL.sections[0].leftScope) || !deepEqual(kitchen.rightScope, BASE_PROPOSAL.sections[0].rightScope)) {
    throw new Error('Scope bullets changed on a price-only instruction');
  }
  console.log('Case 2 passed: Kitchen price updated to 45000, scope/notes untouched.');

  console.log('\ngenerate-full-proposal-edit smoke test passed.');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script and run the test to verify it fails**

In `package.json`, add to the `scripts` block (alongside the other `smoke-test-*` entries):
```json
"smoke-test-generate-full-proposal-edit": "node scripts/smoke-test-generate-full-proposal-edit.js"
```

Run: `npm run smoke-test-generate-full-proposal-edit`

Expected: **FAIL**. The current handler ignores `req.query.mode` and expects `{ description }` in the body, so both calls return `400 { error: 'description is required' }`, and the test throws `Note edit failed: 400 ...`.

- [ ] **Step 3: Implement the `mode=edit` branch**

Replace the full contents of `api/generate-full-proposal.js` with:

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
        titleDescription: 'Room or area name, e.g. "Kitchen" or "Hall Bathroom".',
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

const SCOPE_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['tradeLabel', 'bullet'] },
    text: { type: 'string' },
  },
  required: ['type', 'text'],
};

// Distinct from buildSectionsProperty (used by DRAFT_TOOL above): that shape
// is a flat items[] list later split left/right by splitSnippetItems's
// alternating-trade-group heuristic, which is fine when drafting from
// nothing. Here, rooms already have an explicit, possibly hand-arranged
// leftScope/rightScope split, so this keeps both arrays separate end to end
// -- re-flattening and re-splitting on every edit would silently reshuffle
// column placement for rooms the instruction never mentioned.
const EDIT_TOOL = {
  name: 'apply_proposal_edit',
  description: 'Records the full proposal again with only the requested change applied; everything else unchanged.',
  input_schema: {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        description: 'Every room/section, in order, after the edit. Include ALL sections, not just changed ones.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            subtitle: { type: 'string' },
            price: { type: 'number' },
            priceLabel: { type: 'string' },
            leftScope: { type: 'array', items: SCOPE_ITEM_SCHEMA },
            rightScope: { type: 'array', items: SCOPE_ITEM_SCHEMA },
          },
          required: ['title', 'price', 'leftScope', 'rightScope'],
        },
      },
      notes: { type: 'string' },
      termsAndConditions: { type: 'string' },
      totalLabel: { type: 'string' },
      investmentNote: { type: 'string' },
      expirationDate: { type: 'string' },
      clientSupplied: { type: 'array', items: { type: 'string' } },
      paymentTerms: {
        type: ['object', 'null'],
        properties: {
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, amount: { type: 'number' } },
              required: ['label', 'amount'],
            },
          },
          note: { type: 'string' },
        },
      },
    },
    required: ['sections', 'notes', 'termsAndConditions', 'totalLabel', 'clientSupplied'],
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const mode = req.query && req.query.mode === 'edit' ? 'edit' : 'draft';
  return mode === 'edit' ? handleEdit(req, res) : handleDraft(req, res);
};

async function handleDraft(req, res) {
  const { description } = req.body || {};
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }

  const comparable = await getComparablePricing(description);
  const comparableText = comparable.length
    ? comparable.map((c) => `- ${c.title}: $${c.price.toLocaleString('en-US')}`).join('\n')
    : '(no comparable past sections found)';

  const prompt = `You are drafting an entire residential remodeling proposal for FB Construction from a contractor's plain-\
language description of the whole job. Split the project into logical rooms/areas the way a real FB Construction \
proposal is organized, and write each section's scope in FB's voice: trade-label headers followed by specific, \
concrete bullet points (materials, dimensions, what's included) -- not vague marketing language.

EXAMPLE SCOPE LIBRARY (real language from past proposals, for voice/style reference):
${buildSnippetContext()}

RECENT COMPARABLE SECTION PRICING (for rough pricing context only -- may not be a close match):
${comparableText}

Project description from the contractor: "${description}"

Draft the full set of sections with a rough starting price each. Clearly note in the rationale that these prices are \
starting estimates the contractor must verify.`;

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [DRAFT_TOOL],
      tool_choice: { type: 'tool', name: 'draft_full_proposal' },
      messages: [{ role: 'user', content: prompt }],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse) throw new Error('Model did not return a structured proposal');

    return res.status(200).json(toolUse.input);
  } catch (err) {
    console.error('Full proposal draft failed:', err);
    return res.status(502).json({ error: 'Could not draft proposal', details: err.message });
  }
}

async function handleEdit(req, res) {
  const { proposal, instruction } = req.body || {};
  if (typeof instruction !== 'string' || !instruction.trim()) {
    return res.status(400).json({ error: 'instruction is required' });
  }
  if (!proposal || typeof proposal !== 'object') {
    return res.status(400).json({ error: 'proposal is required' });
  }

  const prompt = `You are editing an existing residential remodeling proposal for FB Construction. The contractor has \
described a change they want made. Apply ONLY that change. Every other field -- including scope bullets, prices, and \
which column (left vs right) each scope item is in for rooms not mentioned by the instruction -- must come back \
byte-for-byte identical to the input.

EXAMPLE SCOPE LIBRARY (real language from past proposals, for voice/style reference, in case the instruction asks for \
new scope language):
${buildSnippetContext()}

CURRENT PROPOSAL (JSON):
${JSON.stringify(proposal, null, 2)}

Contractor's requested change: "${instruction}"

Return the full proposal again -- all sections, notes, terms and conditions, investment summary fields, client-supplied \
items, and payment terms (if present) -- with only the requested change applied.`;

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [EDIT_TOOL],
      tool_choice: { type: 'tool', name: 'apply_proposal_edit' },
      messages: [{ role: 'user', content: prompt }],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse) throw new Error('Model did not return a structured edit');

    return res.status(200).json(toolUse.input);
  } catch (err) {
    console.error('Proposal edit failed:', err);
    return res.status(502).json({ error: 'Could not apply edit', details: err.message });
  }
}
```

- [ ] **Step 4: Run the smoke test to verify it passes**

Run: `npm run smoke-test-generate-full-proposal-edit`
Expected: `PASS` — both cases print their success lines, ending with `generate-full-proposal-edit smoke test passed.`

If Case 1 fails because the model *did* touch `sections`, or Case 2 fails because it touched `notes` or scope, that's a real prompt problem, not a test problem — tighten the "byte-for-byte identical" instruction in the prompt (e.g. add an explicit "Do not paraphrase, reformat, or reorder anything you were not asked to change" sentence) and re-run. Do not weaken the test's assertions to make it pass.

- [ ] **Step 5: Confirm the existing draft mode still works**

Run: `npm run smoke-test-draft-tool-schema` (existing script — confirms `buildSectionsProperty` itself is untouched) and manually re-read the final `api/generate-full-proposal.js` to confirm `handleDraft`'s body is byte-for-byte the old handler's logic (just renamed and moved into its own function) — no behavior drift for the existing "Draft Full Proposal from Description" button.

- [ ] **Step 6: Document the new mode in the README**

In `README.md`, find this existing line (in the API section):
```
`POST /api/generate-full-proposal` — body `{ description }`. Returns `{ sections, priceRationale, notes, clientSupplied }` — drafted from a full-project plain-language description.
```
(If the exact wording differs slightly, locate the line documenting `POST /api/generate-full-proposal` and edit in place.) Add directly after it:
```
`POST /api/generate-full-proposal?mode=edit` — body `{ proposal, instruction }`, where `proposal` is the same shape the form sends to `/api/generate`/`/api/preview` and `instruction` is a plain-language description of the change to make. Returns `{ sections, notes, termsAndConditions, totalLabel, investmentNote, expirationDate, clientSupplied, paymentTerms }` — the full proposal again, with only the requested change applied. Powers the "Tell it what to change" chat panel; the frontend diffs this against what it sent and shows the difference for the contractor to Apply or Cancel before anything is written to the form. Never touches `client`, `proposalNum`, or `date` — those fields aren't part of this mode's output schema.
```

- [ ] **Step 7: Commit**

```bash
git add api/generate-full-proposal.js scripts/smoke-test-generate-full-proposal-edit.js package.json README.md
git commit -m "$(cat <<'EOF'
Add mode=edit branch to generate-full-proposal for chat-driven edits

Lets a single instruction (e.g. "add the Studio41 discount note")
return the whole proposal again with just that change applied, via
forced tool-use returning leftScope/rightScope per room so existing
column layout isn't reshuffled. Kept inside the existing endpoint
file rather than a new one to stay under Vercel Hobby's 12-function
cap.
EOF
)"
```

---

### Task 2: Chat panel UI in `index.html`/`styles.css`/`app.js`

**Files:**
- Modify: `index.html:14-20` (insert chat panel between `.sidebar-header` and the first `<details class="accordion-group">`) and near the other `<template>` elements (insert a new `chatEntryTemplate`)
- Modify: `styles.css` (append chat-panel styles)
- Modify: `app.js` (new DOM refs, `diffProposalForChat`, `applyEditedProposal`, `sendChatInstruction`, event wiring)
- Modify: `README.md` (known limitations)
- Create (throwaway, gitignored): `scratch/chat-edit-local-server.js`, `scratch/chat-edit-drive.js` — for manual verification only, not committed

**Interfaces:**
- Consumes: Task 1's `POST /api/generate-full-proposal?mode=edit` (`{ proposal, instruction }` → `{ sections, notes, termsAndConditions, totalLabel, investmentNote, expirationDate, clientSupplied, paymentTerms }`); `app.js`'s existing `collectProposalData()` (`app.js:888`), `state` object, `nextSectionId()` (`app.js:13`), `renderRooms()` (`app.js:500`), `renderClientSupplied()` (`app.js:800`), `renderPaymentTermLines()` (`app.js:847`), `recalcTotals()` (`app.js:875`), `schedulePreviewRefresh()` (`app.js:1119`), and the `el(id)` helper (`app.js:20`).
- Produces: nothing consumed by a later task — this is the last task in the plan.

- [ ] **Step 1: Add the chat panel markup**

In `index.html`, insert immediately after the `</div>` that closes `.sidebar-header` (the div containing `<h1>FB Construction</h1>`) and before the first `<details class="accordion-group">`:

```html
    <div class="chat-panel">
      <textarea id="chatInstruction" rows="2" placeholder="Tell it what to change (e.g. &quot;add the Studio41 discount note&quot; or &quot;bump the kitchen price to 45k&quot;)"></textarea>
      <button type="button" class="btn-add" id="chatSendBtn">Send</button>
      <div id="chatLog" class="chat-log"></div>
    </div>
```

Near the other `<template>` elements (alongside `customNoteItemTemplate`, before `<script src="/snippets.js">`), add:

```html
<template id="chatEntryTemplate">
  <div class="chat-entry">
    <div class="chat-entry-instruction"></div>
    <div class="chat-entry-note"></div>
    <ul class="chat-entry-changes"></ul>
    <div class="chat-entry-actions"></div>
  </div>
</template>
```

- [ ] **Step 2: Add chat panel styles**

Append to `styles.css`:

```css
.chat-panel {
  margin-top: 16px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--notes-bg);
}
.chat-panel textarea {
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
  border: 1px solid var(--border);
  border-radius: 4px;
  resize: vertical;
  margin-bottom: 6px;
}
.chat-log {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow-y: auto;
}
.chat-entry {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  font-size: 11px;
}
.chat-entry-instruction {
  font-weight: bold;
  color: var(--navy);
  margin-bottom: 4px;
}
.chat-entry-note {
  color: var(--gray);
}
.chat-entry-note.error { color: #b3261e; }
.chat-entry-changes {
  margin: 4px 0;
  padding-left: 16px;
  color: #333;
}
.chat-entry-changes:empty { display: none; }
.chat-entry-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
```

- [ ] **Step 3: Implement `diffProposalForChat` and `applyEditedProposal` in `app.js`**

Add this new section to `app.js`, right after the `// ---- Custom notes library` block ends (immediately before the `// ---- Rooms & Scope` comment at `app.js:421` — insert before it):

```js
  // ---- Chat-driven proposal edits (mode=edit) --------------------------------

  const CHAT_SIMPLE_FIELD_LABELS = {
    notes: 'Notes',
    termsAndConditions: 'Terms & Conditions',
    totalLabel: 'Total Label',
    investmentNote: 'Investment Note',
    expirationDate: 'Valid Until',
  };

  function truncateForChat(text, max) {
    const t = (text || '').trim();
    return t.length > max ? `${t.slice(0, max)}...` : t;
  }

  function diffProposalForChat(oldData, newData) {
    const changes = [];

    Object.keys(CHAT_SIMPLE_FIELD_LABELS).forEach((key) => {
      const oldVal = (oldData[key] || '').trim();
      const newVal = (newData[key] || '').trim();
      if (oldVal !== newVal) {
        changes.push(`${CHAT_SIMPLE_FIELD_LABELS[key]}: "${truncateForChat(oldVal, 60) || '(empty)'}" -> "${truncateForChat(newVal, 60) || '(empty)'}"`);
      }
    });

    const oldSupplied = oldData.clientSupplied || [];
    const newSupplied = newData.clientSupplied || [];
    newSupplied.filter((t) => !oldSupplied.includes(t)).forEach((t) => changes.push(`+ Client-supplied item: "${t}"`));
    oldSupplied.filter((t) => !newSupplied.includes(t)).forEach((t) => changes.push(`- Client-supplied item: "${t}"`));

    const oldSections = oldData.sections || [];
    const newSections = newData.sections || [];
    const oldTitles = oldSections.map((s) => s.title);
    const newTitles = newSections.map((s) => s.title);
    newTitles.filter((t) => !oldTitles.includes(t)).forEach((t) => changes.push(`+ Room added: "${t}"`));
    oldTitles.filter((t) => !newTitles.includes(t)).forEach((t) => changes.push(`- Room removed: "${t}"`));

    newSections.forEach((newSection) => {
      const oldSection = oldSections.find((s) => s.title === newSection.title);
      if (!oldSection) return;
      const oldPrice = Number(oldSection.price) || 0;
      const newPrice = Number(newSection.price) || 0;
      if (oldPrice !== newPrice) {
        changes.push(`${newSection.title} price: $${oldPrice.toLocaleString('en-US')} -> $${newPrice.toLocaleString('en-US')}`);
      }
      const oldBullets = [...(oldSection.leftScope || []), ...(oldSection.rightScope || [])].map((it) => it.text);
      const newBullets = [...(newSection.leftScope || []), ...(newSection.rightScope || [])].map((it) => it.text);
      newBullets.filter((t) => !oldBullets.includes(t)).forEach((t) => changes.push(`+ ${newSection.title}: "${t}"`));
      oldBullets.filter((t) => !newBullets.includes(t)).forEach((t) => changes.push(`- ${newSection.title}: "${t}"`));
    });

    const oldPT = oldData.paymentTerms;
    const newPT = newData.paymentTerms;
    if (!oldPT && newPT) {
      changes.push('+ Payment terms added');
    } else if (oldPT && !newPT) {
      changes.push('- Payment terms removed');
    } else if (oldPT && newPT && (oldPT.lines.length !== newPT.lines.length || (oldPT.note || '') !== (newPT.note || ''))) {
      changes.push(`Payment terms changed (${newPT.lines.length} line${newPT.lines.length === 1 ? '' : 's'})`);
    }

    return changes;
  }

  function applyEditedProposal(newData) {
    el('notes').value = newData.notes || '';
    el('termsAndConditions').value = newData.termsAndConditions || '';
    el('totalLabel').value = newData.totalLabel || '';
    el('investmentNote').value = newData.investmentNote || '';
    el('expirationDate').value = newData.expirationDate || '';

    state.sections = (newData.sections || []).map((s) => ({
      id: nextSectionId(),
      title: s.title || '',
      subtitle: s.subtitle || '',
      price: Number(s.price) || 0,
      priceLabel: s.priceLabel || '',
      description: '',
      scopeStatus: null,
      leftScope: (s.leftScope || []).map((it) => ({ ...it })),
      rightScope: (s.rightScope || []).map((it) => ({ ...it })),
    }));
    state.clientSupplied = Array.isArray(newData.clientSupplied) ? [...newData.clientSupplied] : [];

    if (newData.paymentTerms && Array.isArray(newData.paymentTerms.lines)) {
      el('paymentTermsToggle').checked = true;
      el('paymentTermsPanel').classList.remove('is-hidden');
      state.paymentTermLines = newData.paymentTerms.lines.map((l) => ({ label: l.label || '', amount: l.amount || 0 }));
      el('paymentTermsNote').value = newData.paymentTerms.note || '';
    } else {
      el('paymentTermsToggle').checked = false;
      el('paymentTermsPanel').classList.add('is-hidden');
      state.paymentTermLines = [];
    }

    renderRooms();
    renderClientSupplied();
    renderPaymentTermLines();
    recalcTotals();
    schedulePreviewRefresh();
  }

  const chatInstructionEl = el('chatInstruction');
  const chatLogEl = el('chatLog');
  const chatEntryTemplate = el('chatEntryTemplate');
  let pendingChatEntry = null;

  function createChatEntry(instructionText) {
    const fragment = chatEntryTemplate.content.cloneNode(true);
    const entry = fragment.querySelector('.chat-entry');
    entry.querySelector('.chat-entry-instruction').textContent = instructionText;
    chatLogEl.appendChild(entry);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    return entry;
  }

  function setChatEntryNote(entry, text, isError) {
    const noteEl = entry.querySelector('.chat-entry-note');
    noteEl.textContent = text;
    noteEl.className = isError ? 'chat-entry-note error' : 'chat-entry-note';
  }

  function clearPendingChatEntry() {
    if (!pendingChatEntry) return;
    pendingChatEntry.querySelector('.chat-entry-actions').innerHTML = '';
    pendingChatEntry.querySelector('.chat-entry-changes').innerHTML = '';
    pendingChatEntry = null;
  }

  async function sendChatInstruction() {
    const instruction = chatInstructionEl.value.trim();
    if (!instruction) return;

    clearPendingChatEntry();

    const entry = createChatEntry(instruction);
    setChatEntryNote(entry, 'Thinking...');
    chatInstructionEl.value = '';

    const snapshot = collectProposalData();
    try {
      const res = await fetch('/api/generate-full-proposal?mode=edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal: snapshot, instruction }),
      });
      const newData = await res.json();
      if (!res.ok) throw new Error(newData.error || 'Edit failed');

      const changes = diffProposalForChat(snapshot, newData);
      if (!changes.length) {
        setChatEntryNote(entry, 'No changes detected — try rephrasing.');
        return;
      }

      setChatEntryNote(entry, '');
      const changesList = entry.querySelector('.chat-entry-changes');
      changes.forEach((c) => {
        const li = document.createElement('li');
        li.textContent = c;
        changesList.appendChild(li);
      });

      const actionsEl = entry.querySelector('.chat-entry-actions');
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn-add-small';
      applyBtn.textContent = 'Apply';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-add-small';
      cancelBtn.textContent = 'Cancel';
      applyBtn.addEventListener('click', () => {
        applyEditedProposal(newData);
        actionsEl.innerHTML = '';
        changesList.innerHTML = '';
        setChatEntryNote(entry, 'Applied.');
        pendingChatEntry = null;
      });
      cancelBtn.addEventListener('click', () => {
        actionsEl.innerHTML = '';
        changesList.innerHTML = '';
        setChatEntryNote(entry, 'Cancelled.');
        pendingChatEntry = null;
      });
      actionsEl.appendChild(applyBtn);
      actionsEl.appendChild(cancelBtn);
      pendingChatEntry = entry;
    } catch (err) {
      setChatEntryNote(entry, `Could not apply edit: ${err.message}`, true);
    }
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  el('chatSendBtn').addEventListener('click', sendChatInstruction);
```

- [ ] **Step 4: Set up the throwaway local server + Puppeteer driver for manual verification**

`vercel dev` is broken in this environment (it errors with "must not recursively invoke itself" because `package.json`'s `dev` script is itself `vercel dev`) — use a plain Node server that mounts the real handlers instead, mirroring what worked for the previous two features in this repo's history.

Create `scratch/chat-edit-local-server.js` (gitignored — `scratch/` is in `.gitignore`):

```js
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const envPath = path.join(ROOT, '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const clientsHandler = require(path.join(ROOT, 'api', 'clients.js'));
const generateFullProposalHandler = require(path.join(ROOT, 'api', 'generate-full-proposal.js'));

const STATIC_TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

function handleApi(handler, req, res, urlPath, qs) {
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    let parsed = {};
    try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = {}; }
    const mockRes = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { res.writeHead(this.statusCode, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); return this; },
      setHeader() {},
      end() { res.writeHead(this.statusCode); res.end(); },
    };
    await handler({ method: req.method, query, body: parsed }, mockRes);
  });
}

const server = http.createServer((req, res) => {
  const [urlPath, qs] = req.url.split('?');
  if (urlPath === '/api/clients') return handleApi(clientsHandler, req, res, urlPath, qs);
  if (urlPath === '/api/generate-full-proposal') return handleApi(generateFullProposalHandler, req, res, urlPath, qs);

  const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(4173, () => console.log('chat-edit local server listening on http://localhost:4173'));
```

Create `scratch/chat-edit-drive.js`:

```js
const puppeteer = require('puppeteer');

async function main() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  await page.goto('http://localhost:4173', { waitUntil: 'networkidle0' });

  // Add one room so there's something for the instruction to touch.
  // "Rooms & Scope" is open by default (see the accordion redesign), so
  // #addRoomBtn is already visible/clickable with no accordion interaction needed.
  await page.click('#addRoomBtn');
  await page.type('.room-title', 'Kitchen');
  await page.type('.room-price', '40000');
  await new Promise((r) => setTimeout(r, 300));

  await page.type('#chatInstruction', 'Add a note that permit fees are not included.');
  await page.click('#chatSendBtn');

  // Wait for the pending Apply button to appear (model call takes a few seconds).
  await page.waitForSelector('.chat-entry-actions button', { timeout: 30000 });
  const changesText = await page.$eval('.chat-entry-changes', (el) => el.textContent);
  console.log('CHANGES_SHOWN:', changesText);

  const notesBefore = await page.$eval('#notes', (el) => el.value);
  console.log('NOTES_BEFORE_APPLY:', JSON.stringify(notesBefore));

  const buttons = await page.$$('.chat-entry-actions button');
  await buttons[0].click(); // Apply is added first
  await new Promise((r) => setTimeout(r, 300));

  const notesAfter = await page.$eval('#notes', (el) => el.value);
  console.log('NOTES_AFTER_APPLY:', JSON.stringify(notesAfter));
  if (notesAfter === notesBefore) throw new Error('Apply did not change the notes field');
  if (!/permit/i.test(notesAfter)) throw new Error('Applied notes do not mention permits');

  const roomPrice = await page.$eval('.room-price', (el) => el.value);
  console.log('ROOM_PRICE_AFTER_APPLY:', roomPrice);
  if (Number(roomPrice) !== 40000) throw new Error('Room price changed on a notes-only instruction -- should be untouched');

  console.log('\nchat-edit-drive.js: all assertions passed.');
  await browser.close();
}

main().catch((err) => { console.error('DRIVE_FAILED:', err); process.exit(1); });
```

- [ ] **Step 5: Run the manual verification**

```bash
node scratch/chat-edit-local-server.js &
sleep 2
node scratch/chat-edit-drive.js
```

Expected output ends with `chat-edit-drive.js: all assertions passed.` Then stop the local server (find it with `netstat -ano | grep :4173` on Windows, or `lsof -i :4173` elsewhere, and kill that PID — do not leave it running).

If any assertion throws, read the printed `CHANGES_SHOWN`/`NOTES_BEFORE_APPLY`/`NOTES_AFTER_APPLY` values to see exactly where behavior diverged from the spec before changing code.

- [ ] **Step 6: Also verify Cancel leaves the form untouched**

Manually (or by extending `scratch/chat-edit-drive.js` with a second instruction + clicking the Cancel button, which is `buttons[1]`), confirm: after Cancel, `#notes`'s value is unchanged from before that Send, and the chat log entry shows "Cancelled." with no Apply/Cancel buttons remaining.

- [ ] **Step 7: Update the README's Known limitations section**

In `README.md`'s `## Known limitations` section, add:
```
- **The chat-edit panel** ("Tell it what to change") can't touch client name/address/phone/email, proposal number, or date — those stay manual. It has no memory across messages (each one reads the live form fresh), only one proposed edit can be pending confirmation at a time, and clicking Apply overwrites the form from the snapshot taken when you hit Send — any manual edits made in between are lost.
```

- [ ] **Step 8: Commit**

```bash
git add index.html styles.css app.js README.md
git commit -m "$(cat <<'EOF'
Add chat-driven edit panel for notes, summary, and scope

A pinned chat box above the sidebar accordion: type a plain-language
instruction, review the proposed change as a diff, then Apply or
Cancel. Backed by generate-full-proposal.js's new mode=edit branch;
Apply reuses the same field-population style loadProposalForEdit
already uses.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Purpose/scope (Task 2 Step 3's field list matches spec exactly), architecture diagram (Task 1 endpoint + Task 2 UI flow), `EDIT_TOOL` schema incl. the `buildSectionsProperty` divergence rationale (Task 1 Step 3), diff algorithm (Task 2 Step 3's `diffProposalForChat`), `applyEditedProposal` (Task 2 Step 3, matches spec's code block field-for-field), error-handling table (empty instruction/network failure/malformed response/empty diff/cancel/second-send-while-pending all handled in `sendChatInstruction`), testing (Task 1's smoke test + Task 2's Puppeteer drive script), known limitations (Task 2 Step 7) — all covered.
- **Placeholder scan:** No TBD/TODO; every step has runnable code or an exact command.
- **Type consistency:** `newData` shape returned by `handleEdit` (`sections`, `notes`, `termsAndConditions`, `totalLabel`, `investmentNote`, `expirationDate`, `clientSupplied`, `paymentTerms`) matches exactly what `diffProposalForChat` and `applyEditedProposal` read in Task 2. `collectProposalData()`'s output shape (verified by reading `app.js:888-918`) matches what Task 1's prompt/`EDIT_TOOL` expects as `proposal` context (includes `client`/`proposalNum`/`date`, which `EDIT_TOOL`'s output schema simply omits, structurally preventing the model from returning changes to them).
