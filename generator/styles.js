// Single source of truth for FB Construction brand values and the docx
// unit-conversion helpers. Every other generator module (and renderHtml.js)
// pulls its constants from here so a palette/spacing change only happens
// in one place.
//
// UNIT NOTE: the source spec uses "pt" loosely for three different docx
// units. Always go through the named helpers below instead of a raw number:
//   - run.size            -> half-points        -> pt(n)
//   - paragraph.spacing   -> twentieths-of-a-pt  -> spacingPt(n)
//   - border.size         -> eighths-of-a-pt     -> borderPt(n)

const { BorderStyle, ShadingType, LevelFormat, AlignmentType } = require('docx');

const NAVY = '1B3A6B';
const NAVY_DARK = '122951';
const NAVY_LITE = 'EEF3FA';
const ORANGE = 'D94F0C';
const GRAY = '555555';
const LGRAY = '888888';
const WHITE = 'FFFFFF';
const NOTES_BG = 'F4F7FB';
const BULLET_TEXT_COLOR = '1A1A1A';

const FONT = 'Arial';
// Reserved for a small, deliberate set of "hero" moments (section title,
// client name, dollar amounts) -- not sprinkled across every italic aside
// the way it previously was. Georgia specifically because it's a safe,
// widely-available serif on both Word (any version) and any OS Chromium
// runs on, without needing font embedding to render consistently.
const ACCENT_FONT = 'Georgia';

// Letter page, twips (spec 10.1)
const PAGE = {
  size: { width: 12240, height: 15840 },
  margin: { top: 600, right: 1080, bottom: 600, left: 1080 },
};

// Full width in DXA/twips for an edge-to-edge table (spec 10.2)
const FULL_WIDTH_DXA = 10080;

const COL_WIDTHS = {
  twoColSplit: [4990, 20, 4990],
  banner: [720, 6480, 2880],
  // Single-section "hero" banner variant (spec confirmed against real
  // reference proposals: Mike Nash, Michelle Finch, Meghan Hamann) --
  // no numbered badge, title takes the badge's width back.
  heroBanner: [7200, 2880],
  metaBar: [2520, 2520, 2520, 2520],
  investment: [5040, 5040],
  contactFooter: [3360, 3360, 3360],
  signature: [4680, 720, 4680],
  pricingTable: [7560, 2520],
};

function pt(n) {
  return n * 2;
}

function spacingPt(n) {
  return n * 20;
}

function borderPt(n) {
  return n * 8;
}

function noBorder() {
  return { style: BorderStyle.NONE, size: 0, color: WHITE };
}

function thinBorder(color) {
  return { style: BorderStyle.SINGLE, size: borderPt(0.75), color };
}

function thickBorder(color, sizePt = 6) {
  return { style: BorderStyle.SINGLE, size: borderPt(sizePt), color };
}

// Builds a full 4-side TableCellBorders object. Any side omitted from
// `sides` gets noBorder() so cells don't inherit stray table borders.
function cellBorders(sides = {}) {
  const { top, bottom, left, right } = sides;
  return {
    top: top || noBorder(),
    bottom: bottom || noBorder(),
    left: left || noBorder(),
    right: right || noBorder(),
  };
}

function shade(fillHex) {
  return { type: ShadingType.CLEAR, fill: fillHex, color: 'auto' };
}

function formatCurrency(amount) {
  const n = Math.round(Number(amount) || 0);
  return `$${n.toLocaleString('en-US')}`;
}

// Bullet numbering config (spec §6) — consumed once by
// `new Document({ numbering: numberingConfig })` in buildProposal.js.
const numberingConfig = {
  config: [
    {
      reference: 'sq',
      levels: [
        {
          level: 0,
          format: LevelFormat.BULLET,
          text: '–',
          alignment: AlignmentType.LEFT,
          style: {
            // Navy rather than orange -- orange was previously repeated on
            // every bullet, every trade label, and every section heading
            // throughout the document; restrained to a few deliberate
            // accents (badge, hero price panel, header rule) elsewhere.
            run: { font: FONT, size: pt(16), color: NAVY, bold: true },
            paragraph: { indent: { left: 520, hanging: 260 } },
          },
        },
      ],
    },
  ],
};

module.exports = {
  NAVY,
  NAVY_DARK,
  NAVY_LITE,
  ORANGE,
  GRAY,
  LGRAY,
  WHITE,
  NOTES_BG,
  BULLET_TEXT_COLOR,
  FONT,
  ACCENT_FONT,
  PAGE,
  FULL_WIDTH_DXA,
  COL_WIDTHS,
  pt,
  spacingPt,
  borderPt,
  noBorder,
  thinBorder,
  thickBorder,
  cellBorders,
  shade,
  formatCurrency,
  numberingConfig,
};
