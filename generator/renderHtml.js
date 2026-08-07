// Shared HTML/CSS template for the proposal. Used two ways:
//   1. Fed into headless Chromium to print the PDF deliverable.
//   2. Returned as-is by POST /api/preview for the browser's live preview.
// There is deliberately no third, browser-only copy of this template.
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

function renderScopeColumn(items = []) {
  return items
    .map((item) => {
      if (item.type === 'tradeLabel') {
        return `<div class="trade-label">${esc(item.text)}</div>`;
      }
      return `<div class="bullet"><span class="dash">–</span><span>${esc(item.text)}</span></div>`;
    })
    .join('');
}

function renderSection(section, isHero) {
  const priceLabel = (section.priceLabel || 'INVESTMENT').toUpperCase();
  const subtitleHtml = section.subtitle
    ? `<div class="banner-subtitle">${esc(section.subtitle)}</div>`
    : '';

  const bannerHtml = isHero
    ? `
    <table class="banner banner-hero">
      <tr>
        <td class="banner-title hero">${esc(section.title || '')}${subtitleHtml}</td>
        <td class="banner-price hero">
          <div class="investment-label hero">${esc(priceLabel)}</div>
          <div class="investment-amount hero">${esc(formatCurrency(section.price))}</div>
        </td>
      </tr>
    </table>
  `
    : `
    <table class="banner">
      <tr>
        <td class="badge">${esc(String(section.num).padStart(2, '0'))}</td>
        <td class="banner-title">${esc(section.title || '')}${subtitleHtml}</td>
        <td class="banner-price">
          <div class="investment-label">${esc(priceLabel)}</div>
          <div class="investment-amount">${esc(formatCurrency(section.price))}</div>
        </td>
      </tr>
    </table>
  `;

  return `
    ${bannerHtml}
    <table class="scope">
      <tr>
        <td class="scope-col">${renderScopeColumn(section.leftScope)}</td>
        <td class="divider"></td>
        <td class="scope-col">${renderScopeColumn(section.rightScope)}</td>
      </tr>
    </table>
  `;
}

function renderClientSupplied(items = []) {
  if (!items.length) return '';
  return `
    <div class="section-label">Client-Supplied Items</div>
    ${items.map((t) => `<div class="bullet"><span class="dash">–</span><span>${esc(t)}</span></div>`).join('')}
  `;
}

// Plain labeled text blocks, not boxes -- see the matching comment in
// generator/sections.js's buildLabeledTextBlock for why: two identical
// bordered/tinted boxes sandwiching the dark investment/payment box read as
// a busy stack of competing containers. The investment/payment box is the
// one deliberate "box" left in the document.
function renderLabeledTextBlock(heading, bodyText, extraClass) {
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

function renderNotes(notesText) {
  return renderLabeledTextBlock('Additional Notes & Exclusions', notesText);
}

function renderTerms(termsText) {
  return renderLabeledTextBlock('Terms & Conditions', termsText, 'terms-box');
}

function renderPaymentTerms(paymentTerms) {
  const { lines, note } = paymentTerms;
  return `
    <td class="commitment-box payment-terms-box">
      <div class="commitment-label">PAYMENT TERMS</div>
      ${lines
        .map(
          (line) => `
        <div class="payment-terms-line">
          <span class="payment-terms-label">${esc(line.label)}</span>
          <span class="payment-terms-amount">${esc(formatCurrency(line.amount))}</span>
        </div>
      `,
        )
        .join('')}
      ${note ? `<div class="payment-terms-note">${esc(note)}</div>` : ''}
    </td>
  `;
}

function renderProposalHtml(data) {
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
  .notes-text, .notes-block .bullet { font-style: italic; color: ${GRAY}; font-size: 9.5pt; }

  .totals-table { margin: 24px 0; }
  .investment-box { background: ${NAVY_DARK}; color: #fff; padding: 24px; width: 50%; vertical-align: middle; }
  .investment-box-label { color: #bfd4ee; font-size: 9pt; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; }
  .investment-box-sub { color: #bfd4ee; font-size: 11pt; margin-bottom: 12px; }
  .investment-box-amount { font-family: ${ACCENT_FONT}, serif; color: #fff; font-size: 34pt; margin-top: 2px; }
  .investment-box-note { color: #bfd4ee; font-style: italic; font-size: 9pt; margin-top: 10px; }
  .commitment-box { background: ${NOTES_BG}; padding: 24px; width: 50%; vertical-align: middle; }
  .commitment-label { color: ${NAVY}; font-size: 9pt; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; }
  .commitment-text { font-style: italic; color: ${GRAY}; font-size: 10pt; }

  .payment-terms-line { display: flex; justify-content: space-between; font-size: 10pt; margin-bottom: 5px; }
  .payment-terms-label { color: ${GRAY}; }
  .payment-terms-amount { color: ${NAVY_DARK}; font-weight: bold; }
  .payment-terms-note { font-style: italic; color: ${GRAY}; font-size: 9pt; margin-top: 10px; }

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
        <div class="meta-value client-name">${esc(client.name)}</div>
        <div class="meta-value">${esc([client.phone, client.email].filter(Boolean).join('  •  '))}</div>
      </td>
      <td>
        <div class="meta-label">PROPERTY</div>
        <div class="meta-value">${esc(client.address)}</div>
      </td>
      <td>
        <div class="meta-label">PROPOSAL NO.</div>
        <div class="meta-value">${esc(proposalNum)}</div>
      </td>
      <td>
        <div class="meta-label">DATE</div>
        <div class="meta-value">${esc(date)}</div>
      </td>
    </tr>
  </table>
  <hr class="meta-rule">

  ${sections.map((s) => renderSection(s, sections.length === 1)).join('')}

  ${renderClientSupplied(clientSupplied)}
  ${renderNotes(notes)}

  <table class="totals-table">
    <tr>
      <td class="investment-box">
        <div class="investment-box-label">TOTAL PROJECT INVESTMENT</div>
        ${totalLabel ? `<div class="investment-box-sub">${esc(totalLabel)}</div>` : ''}
        <div class="investment-box-amount">${esc(formatCurrency(totalAmount))}</div>
        ${investmentNote ? `<div class="investment-box-note">${esc(investmentNote)}</div>` : ''}
      </td>
      ${
        paymentTerms
          ? renderPaymentTerms(paymentTerms)
          : `
      <td class="commitment-box">
        <div class="commitment-label">OUR COMMITMENT</div>
        <div class="commitment-text">${esc(COMMITMENT_TEXT)}</div>
      </td>
      `
      }
    </tr>
  </table>

  ${renderTerms(termsAndConditions)}

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

  ${expirationDate ? `<div class="expiration-line">This proposal is valid until ${esc(expirationDate)}. Pricing is subject to change after this date.</div>` : ''}

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

</body>
</html>`;
}

module.exports = { renderProposalHtml, esc };
