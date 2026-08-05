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
        <td class="banner-title hero">${esc((section.title || '').toUpperCase())}${subtitleHtml}</td>
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
        <td class="banner-title">${esc((section.title || '').toUpperCase())}${subtitleHtml}</td>
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

function renderNotes(notesText) {
  if (!notesText || !notesText.trim()) return '';
  const lines = notesText.split('\n').map((l) => l.trim()).filter(Boolean);
  const body =
    lines.length > 1
      ? lines.map((l) => `<div class="bullet"><span class="dash">–</span><span>${esc(l)}</span></div>`).join('')
      : `<div class="notes-text">${esc(lines[0] || '')}</div>`;
  return `
    <div class="notes-box">
      <div class="notes-heading">ADDITIONAL NOTES &amp; EXCLUSIONS</div>
      ${body}
    </div>
  `;
}

function renderProposalHtml(data) {
  const { client, sections = [], clientSupplied = [], notes = '', totalLabel = '', totalAmount, investmentNote, proposalNum, date, updated } = data;

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
    padding: 24px 32px;
    font-size: 10pt;
  }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: middle; padding: 0; }

  .header-table td { padding-bottom: 4px; }
  .logo { height: 50px; }
  .header-right { text-align: right; color: ${NAVY}; font-weight: bold; font-size: 11pt; letter-spacing: 1.5px; }
  .header-rule { border: none; border-top: 6pt solid ${ORANGE}; margin: 6pt 0 10pt; }

  .meta-bar { margin-bottom: 4px; }
  .meta-bar td { background: ${NAVY_LITE}; padding: 8px 10px; width: 25%; }
  .meta-label { color: ${ORANGE}; font-size: 8pt; font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
  .meta-value { color: ${NAVY}; font-size: 9.5pt; font-weight: bold; }
  .meta-rule { border: none; border-bottom: 1pt solid ${NAVY}; margin: 2px 0 14px; }

  .banner { margin-top: 6px; }
  .badge { background: ${ORANGE}; color: #fff; font-weight: bold; font-size: 16pt; text-align: center; width: 60px; padding: 10px; }
  .banner-title { background: ${NAVY_DARK}; color: #fff; font-weight: bold; font-size: 18pt; letter-spacing: 0.5px; padding: 10px 16px; }
  .banner-subtitle { color: #bfd4ee; font-weight: normal; font-size: 9.5pt; letter-spacing: normal; margin-top: 2px; }
  .banner-price { background: ${NAVY_LITE}; text-align: right; padding: 10px 16px; width: 24%; }
  .investment-label { color: ${ORANGE}; font-size: 8pt; font-weight: bold; letter-spacing: 1px; }
  .investment-amount { color: ${NAVY}; font-size: 14pt; font-weight: bold; }
  /* Single-section "hero" banner variant (spec confirmed against real
     reference proposals): no numbered badge, orange price cell. */
  .banner-price.hero { background: ${ORANGE}; }
  .investment-label.hero { color: #fff; }
  .investment-amount.hero { color: #fff; }

  .scope { margin: 8px 0 16px; }
  .scope-col { width: 49%; vertical-align: top; padding-right: 12px; }
  .divider { width: 2%; background: #d9d9d9; }
  .trade-label { color: ${ORANGE}; font-size: 9.5pt; font-weight: bold; letter-spacing: 1px; margin: 10px 0 5px; }
  .trade-label:first-child { margin-top: 0; }
  .bullet { display: flex; gap: 6px; font-size: 9pt; color: ${BULLET_TEXT_COLOR}; margin-bottom: 6px; }
  .dash { color: ${ORANGE}; font-weight: bold; }

  .section-label { color: ${NAVY}; font-size: 11pt; font-weight: bold; letter-spacing: 1px; border-bottom: 1.5pt solid ${ORANGE}; padding-bottom: 3px; margin: 14px 0 8px; }

  .notes-box { background: ${NOTES_BG}; border: 1pt solid ${NAVY}; border-left: 18pt solid ${ORANGE}; padding: 12px 16px; margin: 16px 0; }
  .notes-heading { color: ${ORANGE}; font-size: 10pt; font-weight: bold; letter-spacing: 1px; text-decoration: underline; border-bottom: 1pt solid ${ORANGE}; padding-bottom: 6px; margin-bottom: 8px; }
  .notes-text, .notes-box .bullet { font-family: ${ACCENT_FONT}, serif; font-style: italic; color: ${GRAY}; font-size: 9.5pt; }

  .totals-table { margin: 16px 0; }
  .investment-box { background: ${NAVY_DARK}; color: #fff; padding: 16px; width: 50%; vertical-align: middle; }
  .investment-box-label { color: #bfd4ee; font-size: 10pt; font-weight: bold; letter-spacing: 1px; margin-bottom: 4px; }
  .investment-box-sub { color: #bfd4ee; font-size: 11pt; margin-bottom: 10px; }
  .investment-box-amount { color: #fff; font-size: 36pt; font-weight: bold; }
  .investment-box-note { color: #bfd4ee; font-family: ${ACCENT_FONT}, serif; font-style: italic; font-size: 9pt; margin-top: 8px; }
  .commitment-box { background: ${NOTES_BG}; border: 1pt solid ${NAVY}; padding: 16px; width: 50%; vertical-align: middle; }
  .commitment-label { color: ${ORANGE}; font-size: 11pt; font-weight: bold; letter-spacing: 1px; margin-bottom: 8px; }
  .commitment-text { font-family: ${ACCENT_FONT}, serif; font-style: italic; color: ${GRAY}; font-size: 10pt; }

  .footer-rule { border: none; border-top: 1pt solid ${LGRAY}; margin: 16px 0 8px; }
  .contact-table td { width: 33%; padding-right: 16px; }
  .contact-label { color: ${ORANGE}; font-size: 8pt; font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
  .contact-value { color: ${NAVY}; font-size: 10pt; font-weight: bold; }
  .address-line { color: ${GRAY}; font-size: 9pt; margin-top: 4px; }

  .signature-table { margin-top: 24px; }
  .signature-cell { width: 47%; }
  .signature-line { border-bottom: 1pt solid ${LGRAY}; height: 30px; }
  .signature-caption { color: ${LGRAY}; font-size: 8pt; letter-spacing: 0.5px; margin-top: 4px; }
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
        <div class="meta-label">PREPARED FOR</div>
        <div class="meta-value">${esc(client.name)}</div>
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
      <td class="commitment-box">
        <div class="commitment-label">OUR COMMITMENT</div>
        <div class="commitment-text">${esc(COMMITMENT_TEXT)}</div>
      </td>
    </tr>
  </table>

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
