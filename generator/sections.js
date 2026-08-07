const {
  Table, TableRow, TableCell, Paragraph, TextRun, ImageRun,
  WidthType, VerticalAlign, AlignmentType,
} = require('docx');
const {
  NAVY, NAVY_DARK, NAVY_LITE, ORANGE, GRAY, LGRAY, BULLET_TEXT_COLOR,
  FONT, COL_WIDTHS, FULL_WIDTH_DXA,
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
    spacing: { before: spacingPt(6), after: spacingPt(10) },
    border: { bottom: thickBorder(ORANGE, 6) },
    children: [],
  });

  return [table, rule];
}

// ---- 4.2 Meta bar -------------------------------------------------------

function metaCell(label, lines, width) {
  const valueParagraphs = lines
    .filter(Boolean)
    .map(
      (line, i) =>
        new Paragraph({
          spacing: { after: i === lines.length - 1 ? 0 : spacingPt(1) },
          children: [new TextRun({ text: line, font: FONT, size: pt(9.5), bold: i === 0, color: NAVY })],
        }),
    );

  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: shade(NAVY_LITE),
    borders: cellBorders(),
    margins: { top: 140, bottom: 140, left: 160, right: 160 },
    children: [
      new Paragraph({
        spacing: { after: spacingPt(3) },
        children: [new TextRun({ text: label, font: FONT, size: pt(8), bold: true, color: GRAY, characterSpacing: 10 })],
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
          metaCell('PREPARED FOR', [client.name, [client.phone, client.email].filter(Boolean).join('  •  ')], w1),
          metaCell('PROPERTY', [client.address], w2),
          metaCell('PROPOSAL NO.', [proposalNum], w3),
          metaCell('DATE', [date], w4),
        ],
      }),
    ],
  });

  const rule = new Paragraph({
    spacing: { before: spacingPt(2), after: spacingPt(14) },
    border: { bottom: thinBorder(NAVY) },
    children: [],
  });

  return [table, rule];
}

// ---- 4.3 Section banner --------------------------------------------------

function titleCellChildren(title, subtitle) {
  const children = [
    new Paragraph({
      spacing: subtitle ? { after: spacingPt(2) } : undefined,
      children: [
        new TextRun({ text: title.toUpperCase(), font: FONT, size: pt(18), bold: true, color: 'FFFFFF', characterSpacing: 10 }),
      ],
    }),
  ];
  if (subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: subtitle, font: FONT, size: pt(9.5), color: 'BFD4EE' })],
      }),
    );
  }
  return children;
}

// Multi-section proposals (spec §4.3): numbered orange badge, navy title
// (+ optional subtitle), light-navy price cell with orange label.
function buildStandardBanner({ num, title, subtitle, price, priceLabel }) {
  const [wBadge, wTitle, wPrice] = COL_WIDTHS.banner;

  const badgeCell = new TableCell({
    width: { size: wBadge, type: WidthType.DXA },
    shading: shade(ORANGE),
    verticalAlign: VerticalAlign.CENTER,
    borders: cellBorders(),
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: String(num).padStart(2, '0'), font: FONT, size: pt(16), bold: true, color: 'FFFFFF' }),
        ],
      }),
    ],
  });

  const titleCell = new TableCell({
    width: { size: wTitle, type: WidthType.DXA },
    shading: shade(NAVY_DARK),
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 120, bottom: 120, left: 220, right: 220 },
    borders: cellBorders(),
    children: titleCellChildren(title, subtitle),
  });

  const priceCell = new TableCell({
    width: { size: wPrice, type: WidthType.DXA },
    shading: shade(NAVY_LITE),
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 120, bottom: 120, left: 220, right: 220 },
    borders: cellBorders(),
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: spacingPt(2) },
        children: [new TextRun({ text: (priceLabel || 'INVESTMENT').toUpperCase(), font: FONT, size: pt(8), bold: true, color: GRAY, characterSpacing: 10 })],
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: formatCurrency(price), font: FONT, size: pt(14), bold: true, color: NAVY })],
      }),
    ],
  });

  return new Table({
    width: { size: wBadge + wTitle + wPrice, type: WidthType.DXA },
    columnWidths: COL_WIDTHS.banner,
    rows: [new TableRow({ cantSplit: true, children: [badgeCell, titleCell, priceCell] })],
  });
}

// Single-section proposals (confirmed against real reference proposals --
// Mike Nash, Michelle Finch, Meghan Hamann): no numbered badge, orange
// price cell instead of light-navy.
function buildHeroBanner({ title, subtitle, price, priceLabel }) {
  const [wTitle, wPrice] = COL_WIDTHS.heroBanner;

  const titleCell = new TableCell({
    width: { size: wTitle, type: WidthType.DXA },
    shading: shade(NAVY_DARK),
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 120, bottom: 120, left: 220, right: 220 },
    borders: cellBorders(),
    children: titleCellChildren(title, subtitle),
  });

  const priceCell = new TableCell({
    width: { size: wPrice, type: WidthType.DXA },
    shading: shade(ORANGE),
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 120, bottom: 120, left: 220, right: 220 },
    borders: cellBorders(),
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: spacingPt(2) },
        children: [new TextRun({ text: (priceLabel || 'INVESTMENT').toUpperCase(), font: FONT, size: pt(8), bold: true, color: 'FFFFFF', characterSpacing: 15 })],
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: formatCurrency(price), font: FONT, size: pt(14), bold: true, color: 'FFFFFF' })],
      }),
    ],
  });

  return new Table({
    width: { size: wTitle + wPrice, type: WidthType.DXA },
    columnWidths: COL_WIDTHS.heroBanner,
    rows: [new TableRow({ cantSplit: true, children: [titleCell, priceCell] })],
  });
}

function buildSectionBanner({ num, title, subtitle, price, priceLabel, hero }) {
  return hero
    ? buildHeroBanner({ title, subtitle, price, priceLabel })
    : buildStandardBanner({ num, title, subtitle, price, priceLabel });
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
    margins: { top: 100, bottom: 100, left: 0, right: 160 },
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
