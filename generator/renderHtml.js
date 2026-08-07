// Shared HTML/CSS template for the proposal. Used two ways:
//   1. Fed into headless Chromium to print the PDF deliverable
//      (editable: false, or omitted -- the default).
//   2. Returned by POST /api/preview for the browser's live preview
//      (editable: true) -- contenteditable fields + add/remove controls,
//      bridged back to app.js via postMessage since the preview lives in
//      an <iframe> (a separate document). See the bridge script and CSS
//      near the bottom of renderProposalHtml for the wire format:
//      { source: 'fbpg-preview', type: 'edit', field, value } for text
//      edits (sent on blur, not on every keystroke, so re-rendering the
//      sidebar never fights an in-progress edit), and
//      { source: 'fbpg-preview', type: 'structural', action, payload }
//      for add/remove (handled in app.js by re-using the exact same
//      addRoom/removeRoom/addScopeItem/etc. functions the sidebar
//      buttons already call).
//
// Pulls its raw color/font constants from styles.js (the same source the
// docx builders use) so a brand-color change only happens in one place.
// The docx-specific unit helpers (pt/spacingPt/borderPt) do NOT apply here
// — this is plain CSS, not docx XML.

const fs = require('fs');
const path = require('path');
const rawStyles = require('./styles');
const { CONTACT } = require('./footer');
const { COMMITMENT_TEXT } = require('./totals');

// styles.js exports bare hex (no leading '#') for docx's color options;
// CSS needs the '#'. Convert once here rather than sprinkling '#' + X
// through the template below.
const NAVY = `#${rawStyles.NAVY}`;
const NAVY_DARK = `#${rawStyles.NAVY_DARK}`;
const NAVY_LITE = `#${rawStyles.NAVY_LITE}`;
const ORANGE = `#${rawStyles.ORANGE}`;
const GRAY = `#${rawStyles.GRAY}`;
const LGRAY = `#${rawStyles.LGRAY}`;
const NOTES_BG = `#${rawStyles.NOTES_BG}`;
const BULLET_TEXT_COLOR = `#${rawStyles.BULLET_TEXT_COLOR}`;
const { FONT, ACCENT_FONT, formatCurrency } = rawStyles;

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo_rgb.png');

let logoDataUri;
function getLogoDataUri() {
  if (!logoDataUri) {
    logoDataUri = `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;
  }
  return logoDataUri;
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---- Editable-mode helpers --------------------------------------------
// Only ever emitted when editable === true; the non-editable (PDF/print)
// path never sees a contenteditable attribute or a data-action control.

function editableAttrs(field, multiline) {
  return ` contenteditable="true" data-field="${esc(field)}"${multiline ? ' data-multiline="true"' : ''}`;
}

function dataAttrs(payload) {
  return Object.entries(payload).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
}

function removeControl(action, payload, label) {
  return `<span class="fbpg-remove" data-action="${esc(action)}"${dataAttrs(payload)}>${label ? `${esc(label)} ` : ''}×</span>`;
}

function addControl(action, payload, label) {
  return `<div class="fbpg-add" data-action="${esc(action)}"${dataAttrs(payload)}>+ ${esc(label)}</div>`;
}

function renderScopeColumn(items = [], editable, sectionIndex, side) {
  const itemsHtml = items
    .map((item, i) => {
      const field = `sections.${sectionIndex}.${side}Scope.${i}.text`;
      const remove = editable ? removeControl('remove-item', { section: sectionIndex, side, index: i }) : '';
      if (item.type === 'tradeLabel') {
        return `<div class="trade-label"><span${editable ? editableAttrs(field) : ''}>${esc(item.text)}</span>${remove}</div>`;
      }
      return `<div class="bullet"><span class="dash">–</span><span${editable ? editableAttrs(field) : ''}>${esc(item.text)}</span>${remove}</div>`;
    })
    .join('');
  const addHtml = editable ? addControl('add-bullet', { section: sectionIndex, side }, 'Add bullet') : '';
  return itemsHtml + addHtml;
}

function renderSection(section, isHero, editable, sectionIndex) {
  const priceLabel = section.priceLabel || 'INVESTMENT';
  const titleField = `sections.${sectionIndex}.title`;
  const subtitleField = `sections.${sectionIndex}.subtitle`;
  const priceLabelField = `sections.${sectionIndex}.priceLabel`;
  const priceField = `sections.${sectionIndex}.price`;

  const titleHtml = editable
    ? `<span${editableAttrs(titleField)}>${esc(section.title || '')}</span>`
    : esc(section.title || '');
  const subtitleHtml = editable
    ? `<div class="banner-subtitle"${editableAttrs(subtitleField)}>${esc(section.subtitle || '')}</div>`
    : (section.subtitle ? `<div class="banner-subtitle">${esc(section.subtitle)}</div>` : '');
  const priceLabelHtml = editable
    ? `<span${editableAttrs(priceLabelField)}>${esc(priceLabel)}</span>`
    : esc(priceLabel);
  const priceAmountHtml = editable
    ? `<span${editableAttrs(priceField)}>${esc(formatCurrency(section.price))}</span>`
    : esc(formatCurrency(section.price));

  const bannerHtml = isHero
    ? `
    <table class="banner banner-hero">
      <tr>
        <td class="banner-title hero">${titleHtml}${subtitleHtml}</td>
        <td class="banner-price hero">
          <div class="investment-label hero">${priceLabelHtml}</div>
          <div class="investment-amount hero">${priceAmountHtml}</div>
        </td>
      </tr>
    </table>
  `
    : `
    <table class="banner">
      <tr>
        <td class="badge">${esc(String(section.num).padStart(2, '0'))}</td>
        <td class="banner-title">${titleHtml}${subtitleHtml}</td>
        <td class="banner-price">
          <div class="investment-label">${priceLabelHtml}</div>
          <div class="investment-amount">${priceAmountHtml}</div>
        </td>
      </tr>
    </table>
  `;

  const roomControlsHtml = editable
    ? `<div class="fbpg-room-controls">${removeControl('remove-room', { section: sectionIndex }, 'Remove Room')}</div>`
    : '';

  return `
    <div class="fbpg-room">
      ${roomControlsHtml}
      ${bannerHtml}
      <table class="scope">
        <tr>
          <td class="scope-col">${renderScopeColumn(section.leftScope, editable, sectionIndex, 'left')}</td>
          <td class="divider"></td>
          <td class="scope-col">${renderScopeColumn(section.rightScope, editable, sectionIndex, 'right')}</td>
        </tr>
      </table>
    </div>
  `;
}

function renderClientSupplied(items = [], editable) {
  if (!items.length && !editable) return '';
  const itemsHtml = items
    .map((t, i) => `
      <div class="bullet">
        <span class="dash">–</span>
        <span${editable ? editableAttrs(`clientSupplied.${i}`) : ''}>${esc(t)}</span>
        ${editable ? removeControl('remove-client-supplied', { index: i }) : ''}
      </div>
    `)
    .join('');
  return `
    <div class="section-label">Client-Supplied Items</div>
    ${itemsHtml}
    ${editable ? addControl('add-client-supplied', {}, 'Add item') : ''}
  `;
}

// Plain labeled text blocks, not boxes -- see the matching comment in
// generator/sections.js's buildLabeledTextBlock for why: two identical
// bordered/tinted boxes sandwiching the dark investment/payment box read as
// a busy stack of competing containers. The investment/payment box is the
// one deliberate "box" left in the document.
//
// In editable mode this becomes one free-text contenteditable block (real
// newlines, no per-line dash prefix) rather than the dash-bulleted lines
// the final PDF/docx renders -- simpler to sync line edits/adds/removes as
// plain text than to keep an array of line-divs in lockstep. The polished
// bulleted look comes back the moment editable is off (i.e. in the actual
// generated files).
function renderLabeledTextBlock(heading, bodyText, field, editable, extraClass) {
  if (editable) {
    return `
      <div class="notes-block${extraClass ? ` ${extraClass}` : ''}">
        <div class="notes-heading">${esc(heading)}</div>
        <div class="notes-text"${editableAttrs(field, true)}>${esc(bodyText || '')}</div>
      </div>
    `;
  }

  if (!bodyText || !bodyText.trim()) return '';
  const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
  const body =
    lines.length > 1
      ? lines.map((l) => `<div class="bullet notes-text"><span class="dash">–</span><span>${esc(l)}</span></div>`).join('')
      : `<div class="notes-text">${esc(lines[0] || '')}</div>`;
  return `
    <div class="notes-block${extraClass ? ` ${extraClass}` : ''}">
      <div class="notes-heading">${esc(heading)}</div>
      ${body}
    </div>
  `;
}

function renderNotes(notesText, editable) {
  return renderLabeledTextBlock('Additional Notes & Exclusions', notesText, 'notes', editable);
}

function renderTerms(termsText, editable) {
  return renderLabeledTextBlock('Terms & Conditions', termsText, 'termsAndConditions', editable, 'terms-box');
}

function renderPaymentTerms(paymentTerms, editable) {
  const { lines, note } = paymentTerms;
  const linesHtml = lines
    .map((line, i) => `
      <div class="payment-terms-line">
        <span class="payment-terms-label"${editable ? editableAttrs(`paymentTerms.lines.${i}.label`) : ''}>${esc(line.label)}</span>
        <span class="payment-terms-amount"${editable ? editableAttrs(`paymentTerms.lines.${i}.amount`) : ''}>${esc(formatCurrency(line.amount))}</span>
        ${editable ? removeControl('remove-payment-line', { index: i }) : ''}
      </div>
    `)
    .join('');
  const noteHtml = editable
    ? `<div class="payment-terms-note"${editableAttrs('paymentTerms.note', true)}>${esc(note || '')}</div>`
    : (note ? `<div class="payment-terms-note">${esc(note)}</div>` : '');
  return `
    <td class="commitment-box payment-terms-box">
      <div class="commitment-label">PAYMENT TERMS</div>
      ${linesHtml}
      ${editable ? addControl('add-payment-line', {}, 'Add line') : ''}
      ${noteHtml}
    </td>
  `;
}

// Bridges edits made inside this <iframe> document back to app.js in the
// parent window. Text edits post on blur/Enter (not on every keystroke) so
// a debounced sidebar-triggered re-render never yanks focus mid-edit; the
// add/remove controls post immediately on click.
function renderEditableBridgeScript() {
  return `
  <script>
  (function() {
    function post(msg) {
      window.parent.postMessage(Object.assign({ source: 'fbpg-preview' }, msg), '*');
    }

    document.addEventListener('focusout', function(e) {
      var el = e.target;
      if (el && el.hasAttribute && el.hasAttribute('data-field') && el.getAttribute('contenteditable') === 'true') {
        post({ type: 'edit', field: el.getAttribute('data-field'), value: el.innerText });
      }
    }, true);

    document.addEventListener('keydown', function(e) {
      var el = e.target;
      if (el && el.hasAttribute && el.hasAttribute('data-field') && el.getAttribute('contenteditable') === 'true') {
        if (e.key === 'Enter' && el.getAttribute('data-multiline') !== 'true') {
          e.preventDefault();
          el.blur();
        }
      }
    });

    document.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.preventDefault();
      var payload = {};
      ['section', 'side', 'index'].forEach(function(key) {
        var v = btn.getAttribute('data-' + key);
        if (v !== null) payload[key] = (v !== '' && !isNaN(v)) ? Number(v) : v;
      });
      post({ type: 'structural', action: btn.getAttribute('data-action'), payload: payload });
    });
  })();
  </script>
  `;
}

function renderEditableStyles() {
  return `
  /* min-width/min-height matter: an empty contenteditable span has zero
     box size by default and is otherwise unclickable -- there'd be
     nothing to click to start typing into a just-added empty bullet. */
  [contenteditable="true"] { display: inline-block; min-width: 24px; min-height: 1.2em; outline: none; border-radius: 2px; cursor: text; transition: background 0.15s; }
  [contenteditable="true"]:hover { background: rgba(217, 79, 12, 0.06); }
  [contenteditable="true"]:focus { background: rgba(217, 79, 12, 0.1); box-shadow: 0 0 0 1px rgba(217, 79, 12, 0.45); }
  div[contenteditable="true"] { display: block; min-width: auto; }
  .fbpg-remove { cursor: pointer; color: #b3261e; font-size: 8pt; font-weight: bold; margin-left: 8px; opacity: 0.35; user-select: none; white-space: nowrap; }
  .fbpg-remove:hover { opacity: 1; }
  .fbpg-add { cursor: pointer; display: inline-block; color: ${ORANGE}; font-size: 9pt; font-weight: bold; margin: 6px 0; user-select: none; }
  .fbpg-add:hover { text-decoration: underline; }
  .fbpg-room { position: relative; margin-bottom: 4px; }
  .fbpg-room-controls { text-align: right; margin-bottom: 4px; }
  .fbpg-add-room { margin: 12px 0; }
  `;
}

function renderProposalHtml(data, { editable = false } = {}) {
  const {
    client, sections = [], clientSupplied = [], notes = '', totalLabel = '', totalAmount, investmentNote,
    proposalNum, date, updated, paymentTerms, expirationDate, termsAndConditions,
  } = data;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: ${FONT}, sans-serif;
    color: #1a1a1a;
    margin: 0;
    padding: 32px 40px;
    font-size: 10pt;
  }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: middle; padding: 0; }

  /* Keeps each of these boxed sections intact across a PDF page boundary --
     without this, Chromium's print engine can split a box mid-content the
     same way Word can split a table row (see cantSplit in generator/*.js).
     Deliberately excludes .scope and .notes-block -- long-form content
     needs to be able to paginate normally, or it'd get pushed whole to the
     next page with a large blank gap whenever it's just short of fitting. */
  .header-table, .meta-bar, .banner,
  .totals-table, .contact-table, .signature-table {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .header-table td { padding-bottom: 6px; }
  .logo { height: 50px; }
  .header-right { text-align: right; color: ${NAVY}; font-weight: bold; font-size: 11pt; letter-spacing: 1.5px; }
  .header-rule { border: none; border-top: 2pt solid ${ORANGE}; margin: 10pt 0 20pt; }

  /* Refined rather than a solid tinted block -- clean whitespace with a
     hairline divider between each field reads calmer than a filled bar. */
  .meta-bar td { padding: 4px 20px; width: 25%; border-left: 1pt solid #e4e4e4; }
  .meta-bar td:first-child { padding-left: 0; border-left: none; }
  .meta-label { color: ${GRAY}; font-size: 7.5pt; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
  .meta-value { color: ${NAVY}; font-size: 10pt; font-weight: bold; }
  .meta-value.client-name { font-family: ${ACCENT_FONT}, serif; font-size: 13pt; font-weight: normal; margin-bottom: 2px; }
  .meta-rule { display: none; }

  .banner { margin: 20px 0 0; }
  /* Numbered badge is now a light outline rather than a solid orange
     square -- one strong dark block per section (the title cell) reads as
     a more deliberate, confident anchor than several competing fills. */
  .badge { background: #fff; border: 1pt solid ${ORANGE}; color: ${ORANGE}; font-family: ${ACCENT_FONT}, serif; font-weight: normal; font-size: 15pt; text-align: center; width: 56px; padding: 10px; }
  .banner-title { background: ${NAVY_DARK}; color: #fff; font-family: ${ACCENT_FONT}, serif; font-weight: normal; font-size: 22pt; letter-spacing: 0.2px; padding: 20px 26px; }
  .banner-subtitle { font-family: ${FONT}, sans-serif; color: #bfd4ee; font-weight: normal; font-size: 9.5pt; letter-spacing: normal; margin-top: 4px; }
  .banner-price { background: ${NAVY_LITE}; text-align: right; padding: 20px 26px; width: 24%; }
  .investment-label { color: ${GRAY}; font-size: 7.5pt; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; }
  .investment-amount { font-family: ${ACCENT_FONT}, serif; color: ${NAVY}; font-size: 17pt; margin-top: 2px; }
  /* Single-section "hero" banner variant (spec confirmed against real
     reference proposals): no numbered badge, orange price cell. */
  .banner-price.hero { background: ${ORANGE}; }
  .investment-label.hero { color: #fff; }
  .investment-amount.hero { color: #fff; }

  .scope { margin: 16px 0 24px; }
  .scope-col { width: 49.8%; vertical-align: top; padding-right: 20px; }
  .divider { width: 1px; background: #d9d9d9; }
  .trade-label { color: ${NAVY}; font-size: 9.5pt; font-weight: bold; margin: 12px 0 6px; }
  .trade-label:first-child { margin-top: 0; }
  .bullet { display: flex; gap: 6px; font-size: 9pt; color: ${BULLET_TEXT_COLOR}; margin-bottom: 7px; }
  .dash { color: ${NAVY}; font-weight: bold; }

  .section-label { color: ${NAVY}; font-size: 10.5pt; font-weight: bold; letter-spacing: 0.5px; border-bottom: 1pt solid ${LGRAY}; padding-bottom: 5px; margin: 20px 0 10px; }

  /* Plain labeled text block, not a box -- see generator/sections.js's
     buildLabeledTextBlock comment for why. */
  .notes-block { margin: 20px 0; }
  .notes-heading { color: ${NAVY}; font-size: 9pt; font-weight: bold; letter-spacing: 0.5px; border-bottom: 1pt solid ${LGRAY}; padding-bottom: 7px; margin-bottom: 10px; }
  .notes-text, .notes-block .bullet { font-style: italic; color: ${GRAY}; font-size: 9.5pt; white-space: pre-wrap; }

  .totals-table { margin: 24px 0; }
  .investment-box { background: ${NAVY_DARK}; color: #fff; padding: 24px; width: 50%; vertical-align: middle; }
  .investment-box-label { color: #bfd4ee; font-size: 9pt; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; }
  .investment-box-sub { color: #bfd4ee; font-size: 11pt; margin-bottom: 12px; }
  .investment-box-amount { font-family: ${ACCENT_FONT}, serif; color: #fff; font-size: 34pt; margin-top: 2px; }
  .investment-box-note { color: #bfd4ee; font-style: italic; font-size: 9pt; margin-top: 10px; white-space: pre-wrap; }
  .commitment-box { background: ${NOTES_BG}; padding: 24px; width: 50%; vertical-align: middle; }
  .commitment-label { color: ${NAVY}; font-size: 9pt; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; }
  .commitment-text { font-style: italic; color: ${GRAY}; font-size: 10pt; }

  .payment-terms-line { display: flex; justify-content: space-between; font-size: 10pt; margin-bottom: 5px; }
  .payment-terms-label { color: ${GRAY}; }
  .payment-terms-amount { color: ${NAVY_DARK}; font-weight: bold; }
  .payment-terms-note { font-style: italic; color: ${GRAY}; font-size: 9pt; margin-top: 10px; white-space: pre-wrap; }

  .expiration-line { text-align: center; font-style: italic; color: ${GRAY}; font-size: 9pt; margin: 6px 0 10px; }

  .footer-rule { border: none; border-top: 1pt solid ${LGRAY}; margin: 24px 0 12px; }
  .contact-table td { width: 33%; padding-right: 16px; }
  .contact-label { color: ${GRAY}; font-size: 7.5pt; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 3px; }
  .contact-value { color: ${NAVY}; font-size: 10pt; font-weight: bold; }
  .address-line { color: ${GRAY}; font-size: 9pt; margin-top: 5px; }

  .signature-table { margin-top: 32px; }
  .signature-cell { width: 47%; }
  .signature-line { border-bottom: 1pt solid ${LGRAY}; height: 30px; }
  .signature-caption { color: ${LGRAY}; font-size: 8pt; letter-spacing: 0.5px; margin-top: 5px; }

  ${editable ? renderEditableStyles() : ''}
</style>
</head>
<body>

  <table class="header-table">
    <tr>
      <td><img class="logo" src="${getLogoDataUri()}" alt="FB Construction"></td>
      <td class="header-right">${updated ? 'UPDATED PROPOSAL' : 'PROJECT PROPOSAL'}</td>
    </tr>
  </table>
  <hr class="header-rule">

  <table class="meta-bar">
    <tr>
      <td>
        <div class="meta-label">Prepared For</div>
        <div class="meta-value client-name"${editable ? editableAttrs('client.name') : ''}>${esc(client.name)}</div>
        <div class="meta-value">
          ${editable
            ? `<span${editableAttrs('client.phone')}>${esc(client.phone || '')}</span>  •  <span${editableAttrs('client.email')}>${esc(client.email || '')}</span>`
            : esc([client.phone, client.email].filter(Boolean).join('  •  '))}
        </div>
      </td>
      <td>
        <div class="meta-label">Property</div>
        <div class="meta-value"${editable ? editableAttrs('client.address') : ''}>${esc(client.address)}</div>
      </td>
      <td>
        <div class="meta-label">Proposal No.</div>
        <div class="meta-value"${editable ? editableAttrs('proposalNum') : ''}>${esc(proposalNum)}</div>
      </td>
      <td>
        <div class="meta-label">Date</div>
        <div class="meta-value"${editable ? editableAttrs('date') : ''}>${esc(date)}</div>
      </td>
    </tr>
  </table>
  <hr class="meta-rule">

  ${sections.map((s, i) => renderSection(s, sections.length === 1, editable, i)).join('')}

  ${editable ? `<div class="fbpg-add-room">${addControl('add-room', {}, 'Add Room')}</div>` : ''}

  ${renderClientSupplied(clientSupplied, editable)}
  ${renderNotes(notes, editable)}

  <table class="totals-table">
    <tr>
      <td class="investment-box">
        <div class="investment-box-label">TOTAL PROJECT INVESTMENT</div>
        ${editable
          ? `<div class="investment-box-sub"${editableAttrs('totalLabel')}>${esc(totalLabel)}</div>`
          : (totalLabel ? `<div class="investment-box-sub">${esc(totalLabel)}</div>` : '')}
        <div class="investment-box-amount">${esc(formatCurrency(totalAmount))}</div>
        ${editable
          ? `<div class="investment-box-note"${editableAttrs('investmentNote', true)}>${esc(investmentNote || '')}</div>`
          : (investmentNote ? `<div class="investment-box-note">${esc(investmentNote)}</div>` : '')}
      </td>
      ${
        paymentTerms
          ? renderPaymentTerms(paymentTerms, editable)
          : `
      <td class="commitment-box">
        <div class="commitment-label">OUR COMMITMENT</div>
        <div class="commitment-text">${esc(COMMITMENT_TEXT)}</div>
      </td>
      `
      }
    </tr>
  </table>

  ${renderTerms(termsAndConditions, editable)}

  <hr class="footer-rule">
  <table class="contact-table">
    <tr>
      <td>
        <div class="contact-label">PHONE</div>
        <div class="contact-value">${esc(CONTACT.phone)}</div>
      </td>
      <td>
        <div class="contact-label">EMAIL</div>
        <div class="contact-value">${esc(CONTACT.email)}</div>
      </td>
      <td>
        <div class="contact-label">WEBSITE</div>
        <div class="contact-value">${esc(CONTACT.website)}</div>
      </td>
    </tr>
  </table>
  <div class="address-line">${esc(CONTACT.address)}</div>

  ${(expirationDate || editable) ? `<div class="expiration-line">This proposal is valid until ${editable ? `<span${editableAttrs('expirationDate')}>${esc(expirationDate || '')}</span>` : esc(expirationDate)}. Pricing is subject to change after this date.</div>` : ''}

  <table class="signature-table">
    <tr>
      <td class="signature-cell">
        <div class="signature-line"></div>
        <div class="signature-caption">FB CONSTRUCTION — AUTHORIZED SIGNATURE &amp; DATE</div>
      </td>
      <td style="width: 6%;"></td>
      <td class="signature-cell">
        <div class="signature-line"></div>
        <div class="signature-caption">CLIENT ACCEPTANCE &amp; DATE</div>
      </td>
    </tr>
  </table>

  ${editable ? renderEditableBridgeScript() : ''}

</body>
</html>`;
}

module.exports = { renderProposalHtml, esc };
