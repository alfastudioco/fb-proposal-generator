const {
  Table, TableRow, TableCell, Paragraph, TextRun, ImageRun,
  WidthType, VerticalAlign, AlignmentType,
} = require('docx');
const {
  NAVY, NAVY_DARK, ORANGE, GRAY, LGRAY, BULLET_TEXT_COLOR,
  FONT, ACCENT_FONT, COL_WIDTHS, FULL_WIDTH_DXA,
  pt, spacingPt, cellBorders, thinBorder, thickBorder, shade, formatCurrency,
} = require('./styles');

// ---- 4.1 Header --------------------------------------------------------

function buildHeader(logoBuffer, { updated = false } = {}) {
  const table = new Table({
    width: { size: FULL_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: [5040, 5040],
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 5040, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            borders: cellBorders(),
            children: [
              new Paragraph({
                children: [
                  new ImageRun({
                    data: logoBuffer,
                    transformation: { width: 162, height: 50 },
                    // Without altText, docx emits <wp:docPr name="" descr="" title=""/> --
                    // an empty name fails strict OOXML validation and Word "repairs" the
                    // file on open, which can visibly mangle formatting. `title` is left
                    // empty and stripped entirely in buildProposal.js's post-process --
                    // older Word versions reject that attribute outright regardless of value.
                    altText: { name: 'FB Construction Logo', description: 'FB Construction Logo', title: '' },
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 5040, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            borders: cellBorders(),
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: updated ? 'UPDATED PROPOSAL' : 'PROJECT PROPOSAL',
                    font: FONT, size: pt(11), bold: true, color: NAVY, characterSpacing: 30,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const rule = new Paragraph({
    spacing: { before: spacingPt(10), after: spacingPt(20) },
    border: { bottom: thinBorder(ORANGE) },
    children: [],
  });

  return [table, rule];
}

// ---- 4.2 Meta bar -------------------------------------------------------
//
// Clean whitespace with a hairline divider between each field, not a solid
// tinted block -- reads calmer than a filled bar. `accentFirstLine` gives
// the "Prepared For" cell's client name a serif treatment (a small,
// deliberate luxury touch); every other cell stays plain.

function metaCell(label, lines, width, { isFirst = false, accentFirstLine = false } = {}) {
  const valueParagraphs = lines
    .filter(Boolean)
    .map((line, i) => {
      const useAccent = accentFirstLine && i === 0;
      return new Paragraph({
        spacing: { after: i === lines.length - 1 ? 0 : spacingPt(useAccent ? 3 : 1) },
        children: [
          new TextRun({
            text: line,
            font: useAccent ? ACCENT_FONT : FONT,
            size: useAccent ? pt(13) : pt(9.5),
            bold: useAccent ? false : i === 0,
            color: NAVY,
          }),
        ],
      });
    });

  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBorders(isFirst ? {} : { left: thinBorder('E4E4E4') }),
    margins: { top: 100, bottom: 100, left: isFirst ? 0 : 260, right: 260 },
    children: [
      new Paragraph({
        spacing: { after: spacingPt(4) },
        children: [new TextRun({ text: label.toUpperCase(), font: FONT, size: pt(7.5), bold: true, color: GRAY, characterSpacing: 12 })],
      }),
      ...valueParagraphs,
    ],
  });
}

function buildMetaBar({ client, proposalNum, date }) {
  const [w1, w2, w3, w4] = COL_WIDTHS.metaBar;
  const table = new Table({
    width: { size: w1 + w2 + w3 + w4, type: WidthType.DXA },
    columnWidths: COL_WIDTHS.metaBar,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          metaCell('Prepared For', [client.name, [client.phone, client.email].filter(Boolean).join('  •  ')], w1, { isFirst: true, accentFirstLine: true }),
          metaCell('Property', [client.address], w2),
          metaCell('Proposal No.', [proposalNum], w3),
          metaCell('Date', [date], w4),
        ],
      }),
    ],
  });

  // No hard bottom rule -- the hairline column dividers plus generous
  // whitespace already delineate the bar without adding another block edge.
  const spacerAfter = new Paragraph({ spacing: { after: spacingPt(16) }, children: [] });

  return [table, spacerAfter];
}

// ---- 4.3 Section banner --------------------------------------------------

// Clean "rule" banner: no filled blocks -- a small orange section number,
// the room name in the accent serif with its subtitle inline in gray, the
// price right-aligned, and one thin orange rule under the whole row (drawn
// as each cell's bottom border, which Word joins into a single line).
// Single-section ("hero") proposals use the same row without the number.
const BANNER_MARGINS = { top: 0, bottom: 110, left: 0, right: 0 };

function bannerCell(width, children) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.BOTTOM,
    margins: BANNER_MARGINS,
    borders: cellBorders({ bottom: thickBorder(ORANGE, 1.5) }),
    children,
  });
}

function buildSectionBanner({ num, title, subtitle, price, priceLabel, hidePrice, hero }) {
  const [wNum, wTitle, wPrice] = COL_WIDTHS.banner;
  const showNum = !hero;
  const titleWidth = wTitle + (showNum ? 0 : wNum) + (hidePrice ? wPrice : 0);

  const titleRuns = [new TextRun({ text: title || '', font: ACCENT_FONT, size: pt(18), color: NAVY_DARK })];
  if (subtitle) {
    titleRuns.push(new TextRun({ text: `   ${subtitle}`, font: FONT, size: pt(9), color: LGRAY }));
  }

  const cells = [];
  const widths = [];
  if (showNum) {
    cells.push(bannerCell(wNum, [
      new Paragraph({
        children: [new TextRun({ text: String(num).padStart(2, '0'), font: FONT, size: pt(10.5), bold: true, color: ORANGE, characterSpacing: 20 })],
      }),
    ]));
    widths.push(wNum);
  }
  cells.push(bannerCell(titleWidth, [new Paragraph({ children: titleRuns })]));
  widths.push(titleWidth);
  if (!hidePrice) {
    cells.push(bannerCell(wPrice, [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: `${(priceLabel || 'INVESTMENT').toUpperCase()}   `, font: FONT, size: pt(7.5), bold: true, color: LGRAY, characterSpacing: 12 }),
          new TextRun({ text: formatCurrency(price), font: ACCENT_FONT, size: pt(15), color: NAVY_DARK }),
        ],
      }),
    ]));
    widths.push(wPrice);
  }

  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: [new TableRow({ cantSplit: true, children: cells })],
  });
}

// ---- 4.4 Two-column scope -------------------------------------------------

function renderScopeItems(items = []) {
  return items.map((item) => {
    if (item.type === 'tradeLabel') {
      return new Paragraph({
        spacing: { before: spacingPt(10), after: spacingPt(5) },
        children: [
          new TextRun({ text: item.text, font: FONT, size: pt(9.5), bold: true, color: NAVY }),
        ],
      });
    }
    return new Paragraph({
      numbering: { reference: 'sq', level: 0 },
      spacing: { after: spacingPt(6) },
      children: [new TextRun({ text: item.text, font: FONT, size: pt(9), color: BULLET_TEXT_COLOR })],
    });
  });
}

function scopeColumnCell(items, width) {
  const children = renderScopeItems(items);
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBorders(),
    margins: { top: 100, bottom: 100, left: 0, right: 200 },
    children: children.length ? children : [new Paragraph({ children: [] })],
  });
}

function dividerCell(width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: shade('D9D9D9'),
    borders: cellBorders(),
    children: [new Paragraph({ children: [] })],
  });
}

function buildTwoColumnScope({ leftScope, rightScope }) {
  const [wLeft, wDivider, wRight] = COL_WIDTHS.twoColSplit;
  return new Table({
    width: { size: wLeft + wDivider + wRight, type: WidthType.DXA },
    columnWidths: COL_WIDTHS.twoColSplit,
    rows: [
      // Deliberately NOT cantSplit, unlike the other rows in this file -- a
      // long scope list needs to be able to paginate normally; forcing it
      // to stay atomic would push the whole section to the next page and
      // leave a large blank gap whenever it's just short of fitting.
      new TableRow({
        children: [
          scopeColumnCell(leftScope, wLeft),
          dividerCell(wDivider),
          scopeColumnCell(rightScope, wRight),
        ],
      }),
    ],
  });
}

function buildSectionLabel(text) {
  return new Paragraph({
    spacing: { before: spacingPt(8), after: spacingPt(4) },
    border: { bottom: thinBorder(LGRAY) },
    children: [
      new TextRun({ text, font: FONT, size: pt(10.5), bold: true, color: NAVY, characterSpacing: 5 }),
    ],
  });
}

// ---- 4.6 Client-supplied items --------------------------------------------

function buildClientSuppliedItems(items = []) {
  if (!items.length) return [];
  const bullets = items.map(
    (text) =>
      new Paragraph({
        numbering: { reference: 'sq', level: 0 },
        spacing: { after: spacingPt(6) },
        children: [new TextRun({ text, font: FONT, size: pt(9), color: BULLET_TEXT_COLOR })],
      }),
  );
  return [buildSectionLabel('Client-Supplied Items'), ...bullets];
}

// ---- 4.5 Notes & terms & conditions ---------------------------------------
//
// Plain labeled text blocks, not boxes -- previously both of these used the
// same heavy bordered/tinted box treatment, which sandwiched the dark
// investment/payment box between two near-identical light boxes and read as
// a busy stack of competing containers. The investment/payment box is the
// one deliberate "box" left in the document; everything else uses
// typography and a hairline rule for hierarchy instead.

function buildLabeledTextBlock(heading, bodyText) {
  if (!bodyText || !bodyText.trim()) return [];

  const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);

  const headingParagraph = new Paragraph({
    spacing: { before: spacingPt(8), after: spacingPt(6) },
    border: { bottom: thinBorder(LGRAY) },
    children: [
      new TextRun({ text: heading, font: FONT, size: pt(9), bold: true, color: NAVY, characterSpacing: 5 }),
    ],
  });

  const bodyParagraphs =
    lines.length > 1
      ? lines.map(
          (line) =>
            new Paragraph({
              numbering: { reference: 'sq', level: 0 },
              spacing: { after: spacingPt(5) },
              children: [new TextRun({ text: line, font: FONT, italics: true, size: pt(9.5), color: GRAY })],
            }),
        )
      : [
          new Paragraph({
            children: [new TextRun({ text: lines[0] || '', font: FONT, italics: true, size: pt(9.5), color: GRAY })],
          }),
        ];

  return [headingParagraph, ...bodyParagraphs];
}

function buildNotesBox(notesText) {
  return buildLabeledTextBlock('Additional Notes & Exclusions', notesText);
}

function buildTermsBox(termsText) {
  return buildLabeledTextBlock('Terms & Conditions', termsText);
}

module.exports = {
  buildHeader,
  buildMetaBar,
  buildSectionBanner,
  buildTwoColumnScope,
  renderScopeItems,
  buildSectionLabel,
  buildClientSuppliedItems,
  buildNotesBox,
  buildTermsBox,
};
