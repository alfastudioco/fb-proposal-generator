# Conversational Chat-Edit Panel

## Purpose

Add a way to edit an in-progress proposal by describing the change in
plain language, instead of hunting through the sidebar for the right
field or snippet dropdown. User's framing: "an automated tool where I
can talk and it auto generates my changes... to the notes and summary,
and overall changes to the scope as needed." Covers notes, terms,
investment-summary fields, and room scope-of-work (add/edit/remove
bullets, change prices) — not client identity fields (name, address,
phone, email, proposal number, date), which stay manual.

Each message is stateless: it operates on whatever is currently in the
form, not a remembered conversation. Every proposed change is shown as
a plain-language diff with Apply/Cancel before anything touches the
form — nothing auto-applies.

## Explicitly out of scope (for this project)

- **Voice input.** Confirmed with the user: a typed chat box, not
  speech-to-text. No mic/audio pipeline.
- **Editing client identity fields** (name, address, phone, email,
  proposal number, date). The tool's output schema (see below)
  structurally excludes these — they simply aren't part of what the
  model can return, so an instruction like "change the client's name"
  has no field to land in.
- **Multi-turn conversational memory.** No server-side chat history.
  Each Send captures a fresh snapshot of the current form
  (`collectProposalData()`) and sends it with the new instruction. A
  follow-up like "actually make it 50k instead" works fine because the
  *form* already reflects the prior applied edit (if you clicked
  Apply) — the tool doesn't need to remember your words, just read the
  current state.
- **Multiple pending edits stacked at once.** Sending a new message
  while a previous proposed change is still awaiting Apply/Cancel
  discards the old pending one (its Apply/Cancel buttons are removed
  from the log). Only one edit is "live" for confirmation at a time.
- **Conflict detection between manual edits and a pending Apply.** If
  the user manually changes a field in the sidebar between Send and
  Apply, clicking Apply overwrites it (Apply replaces from the
  snapshot taken at Send time, not from whatever is in the form *now*).
  This mirrors how `loadProposalForEdit`/`loadImportedProposal` already
  behave (wholesale replace) — not a new class of risk for this app.

## Architecture

```
Browser (app.js)                      Vercel function                    External
-----------------                     ---------------                    --------
1. Type instruction, click Send
2. snapshot = collectProposalData()
   POST /api/generate-full-proposal
        ?mode=edit
   { proposal: snapshot,
     instruction }              --->  build prompt (snapshot context
                                       + instruction), call Messages
                                       API w/ forced tool_choice on
                                       apply_proposal_edit           --->  Claude
                                  <--  structured new proposal
                             <----    { sections, notes,
                                        termsAndConditions,
                                        totalLabel, investmentNote,
                                        expirationDate, clientSupplied,
                                        paymentTerms }
3. diff = diffProposalForChat(snapshot, newData)
   Render diff as bullet list in chat log, with Apply/Cancel
4a. Apply -> applyEditedProposal(newData) -> renderRooms() /
    renderClientSupplied() / renderPaymentTermLines() /
    recalcTotals() / schedulePreviewRefresh()
4b. Cancel -> discard newData, form untouched
```

No new database table, no new Storage bucket, no new persistent
state. `mode=edit` is a branch inside the existing
`api/generate-full-proposal.js` (see Function-cap note below) — not a
new file — so the deployment's serverless-function count stays at 12.

## Components

### `api/generate-full-proposal.js` — `mode=edit` branch

The file's handler currently always drafts from scratch
(`{description} -> full proposal`). It gains a `mode` query param:

```js
module.exports = async function handler(req, res) {
  // ...existing CORS/OPTIONS handling...
  const mode = req.query && req.query.mode === 'edit' ? 'edit' : 'draft';
  return mode === 'edit' ? handleEdit(req, res) : handleDraft(req, res);
};
```

`handleDraft` is the existing function body, renamed, unchanged
behavior/output shape — `mode` defaults to `draft` so the existing
frontend call (`POST /api/generate-full-proposal` with no query
string) keeps working with zero changes to that call site.

`handleEdit(req, res)`:

- `POST` only. Body: `{ proposal: <collectProposalData() shape>, instruction: string }`.
- 400 if `instruction` is missing/blank, or `proposal` is missing/not an object.
- Builds a prompt: explains this is FB Construction's proposal editor,
  gives the full current proposal as pretty-printed JSON for context
  (including `client`, `proposalNum`, `date`, `paymentTerms` even
  though those aren't editable — the model needs full context to write
  coherent notes/scope, e.g. referencing the client by name), states
  the contractor's instruction verbatim, and instructs: apply *only*
  the requested change; leave every other field — including scope
  bullets, prices, and column placement (left vs right) for rooms not
  implicated by the instruction — byte-for-byte identical to the input.
  Reuses `buildSnippetContext()` for voice/style guidance when the
  instruction asks for new scope language, same as the other AI
  endpoints.
- `EDIT_TOOL` (new, in this file — **not** `buildSectionsProperty`,
  see note below):

  ```js
  const SCOPE_ITEM_SCHEMA = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['tradeLabel', 'bullet'] },
      text: { type: 'string' },
    },
    required: ['type', 'text'],
  };

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
            lines: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, amount: { type: 'number' } }, required: ['label', 'amount'] } },
            note: { type: 'string' },
          },
        },
      },
      required: ['sections', 'notes', 'termsAndConditions', 'totalLabel', 'clientSupplied'],
    },
  };
  ```

  **Why not `buildSectionsProperty`:** that shared schema (used by the
  draft/import/blueprint flows) models sections as one flat
  `items: [{type, text}]` list, later split into left/right columns by
  `splitSnippetItems`'s alternating-trade-group heuristic — appropriate
  when drafting from nothing. Here, rooms already have an explicit,
  possibly hand-arranged `leftScope`/`rightScope` split; re-flattening
  and re-splitting on every edit would silently reshuffle column
  placement for rooms the instruction never mentioned. `EDIT_TOOL`
  keeps `leftScope`/`rightScope` as separate arrays end to end so an
  untouched room's column layout is preserved exactly.

  `client`, `proposalNum`, and `date` are deliberately absent from
  `EDIT_TOOL`'s schema — structurally, the model has no field to
  return a change to them in, regardless of what the instruction asks.
- `tool_choice: { type: 'tool', name: 'apply_proposal_edit' }`, `max_tokens: 4096` (matches `generate-full-proposal.js`'s draft mode).
- On success, `200` with `toolUse.input` (the new proposal, same shape as the request's `proposal` plus the always-present fields above).
- On missing `tool_use` or API failure, `502` with `{ error, details }`, matching every other AI endpoint in this codebase.

### `app.js` — chat panel

**UI** (pinned above the accordion, per the approved mockup): a
`<textarea id="chatInstruction">`, `<button id="chatSendBtn">`, and a
`<div id="chatLog">` that accumulates one entry per Send — the
instruction text, then either an error, "No changes detected — try
rephrasing," or a bullet list of changes with **Apply**/**Cancel**
buttons scoped to that entry.

**`sendChatInstruction()`**:
1. Read + trim the textarea; no-op if empty.
2. `const snapshot = collectProposalData();`
3. `POST /api/generate-full-proposal?mode=edit` with `{ proposal: snapshot, instruction }`.
4. On success: `const changes = diffProposalForChat(snapshot, newData);` — if `changes.length === 0`, log "No changes detected — try rephrasing." Otherwise render the change list + Apply/Cancel, holding `newData` in a closure for the Apply handler. Remove any previous pending entry's Apply/Cancel buttons first (single-pending-edit rule above).
5. On failure: log the error message, styled like existing `.generate-status.error` text.

**`diffProposalForChat(oldData, newData)`** (new, pure function, no
side effects) — returns an array of human-readable strings:
- Simple fields (`notes`, `termsAndConditions`, `totalLabel`,
  `investmentNote`, `expirationDate`): if changed, `"${Label}: changed"`
  with old/new shown truncated (e.g. first 60 chars) for long text
  fields, full value for short ones.
- `clientSupplied`: added/removed items by set difference.
- `sections`: match old/new by index (both come from the same
  snapshot lineage, so index alignment holds *except* when the
  instruction adds/removes a whole room — detect count mismatch and
  report "+N room(s) added" / "-N room(s) removed" by title, then diff
  the remaining common-index rooms). For each matched room: price
  change (`"${title} price: $X -> $Y"`), and scope changes summarized
  as added/removed bullet text (compare `leftScope`+`rightScope`
  joined text arrays old vs. new; report additions/removals, not a
  full text diff — keeps this readable rather than exhaustive).
- `paymentTerms`: present/absent change, or line count + note change if both present.

**`applyEditedProposal(newData)`** (new) — mirrors
`loadProposalForEdit`'s field-by-field population style, but scoped to
only the fields `EDIT_TOOL` can return, and explicitly does **not**
touch `clientName`/`propertyAddress`/`clientPhone`/`clientEmail`/
`proposalNum`/`proposalDate`/`state.editingId`/`state.clientId` (out
of scope per the Purpose section):

```js
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
```

`nextSectionId()` reassigns fresh local ids for the room cards (same
as every other wholesale-replace flow in this file) — these ids are
DOM/state bookkeeping only, never sent to the server.

## Data flow / error handling summary

| Failure point | Behavior |
|---|---|
| Empty/whitespace instruction | Send is a no-op |
| Network/API failure calling `mode=edit` | Error logged in chat, styled like existing error states, form untouched |
| Model returns no `tool_use` / malformed input | `502` from the endpoint, surfaced as a chat error |
| Diff comes back empty | "No changes detected — try rephrasing," no Apply/Cancel shown |
| User clicks Cancel | `newData` discarded, form untouched |
| User manually edits the form between Send and Apply | Apply overwrites those manual edits (documented limitation above, consistent with existing wholesale-replace flows) |
| A second Send while one edit is pending | Previous entry's Apply/Cancel buttons removed; only the newest edit is confirmable |

## Testing

- `scripts/smoke-test-generate-full-proposal-edit.js`, mirroring this
  repo's existing smoke-test style (no formal test framework): builds a
  small synthetic `proposal` object (one room, some notes), calls the
  handler directly with `{ query: { mode: 'edit' }, body: { proposal, instruction: 'add a note about permit fees not being included' } }`,
  and asserts: the response's `sections` array is deep-equal to the
  input's (untouched), `notes` contains permit-related language and
  differs from the input, `totalLabel`/`investmentNote`/
  `expirationDate`/`termsAndConditions`/`clientSupplied` are unchanged.
  A second case asks for a price change on a named room and asserts
  only that room's `price` differs.
- Manual verification (same approach used for the notes-library and
  accordion features): drive the real UI in a browser via Puppeteer —
  type an instruction, confirm the diff list renders with sensible
  text, click Apply, confirm the actual form fields/state changed,
  repeat for Cancel and confirm the form is untouched.

## `vercel.json` changes

None. `api/generate-full-proposal.js` already has `"maxDuration": 60`;
`mode=edit` makes one Claude call like `mode=draft` already does, so
the existing budget applies unchanged.

## Known limitations (carried into README on implementation)

- No voice input — typed instructions only.
- No conversation memory across messages — each Send reads the live form fresh.
- Only one pending (unconfirmed) edit at a time.
- Client identity fields (name/address/phone/email/proposal number/date) can't be changed through this tool.
- Apply replaces from the snapshot taken at Send time — manual edits made while a confirmation is pending are lost if Apply is then clicked.
