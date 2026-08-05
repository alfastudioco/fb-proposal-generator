const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, VerticalAlign, AlignmentType } = require('docx');
const {
  NAVY_DARK, ORANGE, GRAY, NOTES_BG, FONT, ACCENT_FONT,
  COL_WIDTHS, pt, spacingPt, cellBorders, thinBorder, shade, formatCurrency,
} = require('./styles');

const COMMITMENT_TEXT =
  'Single point of contact, daily site cleanliness, and transparent communication at every ' +
  'milestone — from first demo to final walkthrough.';

function investmentCell(totalLabel, totalAmount, note) {
  const children = [
    new Paragraph({
      spacing: { after: spacingPt(6) },
      children: [
        new TextRun({
          text: 'TOTAL PROJECT INVESTMENT',
          font: FONT, size: pt(10), bold: true, color: 'BFD4EE', characterSpacing: 20,
        }),
      ],
    }),
  ];

  if (totalLabel) {
    children.push(
      new Paragraph({
        spacing: { after: spacingPt(10) },
        children: [new TextRun({ text: totalLabel, font: FONT, size: pt(11), color: 'BFD4EE' })],
      }),
    );
  }

  children.push(
    new Paragraph({
      spacing: { after: note ? spacingPt(8) : 0 },
      children: [new TextRun({ text: formatCurrency(totalAmount), font: FONT, size: pt(36), bold: true, color: 'FFFFFF' })],
    }),
  );

  if (note) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: note, font: ACCENT_FONT, italics: true, size: pt(9), color: 'BFD4EE' })],
      }),
    );
  }

  return new TableCell({
    width: { size: COL_WIDTHS.investment[0], type: WidthType.DXA },
    shading: shade(NAVY_DARK),
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 260, bottom: 260, left: 300, right: 300 },
    borders: cellBorders(),
    children,
  });
}

function commitmentCell() {
  return new TableCell({
    width: { size: COL_WIDTHS.investment[1], type: WidthType.DXA },
    shading: shade(NOTES_BG),
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 260, bottom: 260, left: 300, right: 300 },
    borders: cellBorders({
      top: thinBorder('1B3A6B'),
      bottom: thinBorder('1B3A6B'),
      right: thinBorder('1B3A6B'),
      left: thinBorder('1B3A6B'),
    }),
    children: [
      new Paragraph({
        spacing: { after: spacingPt(8) },
        children: [
          new TextRun({ text: 'OUR COMMITMENT', font: FONT, size: pt(11), bold: true, color: ORANGE, characterSpacing: 20 }),
        ],
      }),
      new Paragraph({
        children: [new TextRun({ text: COMMITMENT_TEXT, font: ACCENT_FONT, italics: true, size: pt(10), color: GRAY })],
      }),
    ],
  });
}

function buildInvestmentAndCommitmentBox({ totalLabel, totalAmount, note }) {
  return new Table({
    width: { size: COL_WIDTHS.investment[0] + COL_WIDTHS.investment[1], type: WidthType.DXA },
    columnWidths: COL_WIDTHS.investment,
    rows: [
      new TableRow({
        children: [investmentCell(totalLabel, totalAmount, note), commitmentCell()],
      }),
    ],
  });
}

// Phase 2 — spec §5.3. Not implemented; kept as a documented stub so the
// module's shape already anticipates the payment-terms box replacing the
// commitment box when `paymentTerms` is present on the proposal data.
function buildPaymentTermsBox() {
  throw new Error('buildPaymentTermsBox is not implemented in Phase 1 (spec §5.3)');
}

// Phase 2 — spec §5.4 (addendum/updated proposal line-items + payment
// summary tables). Not implemented; same treatment as buildPaymentTermsBox.
function buildAddendumTables() {
  throw new Error('buildAddendumTables is not implemented in Phase 1 (spec §5.4)');
}

module.exports = {
  COMMITMENT_TEXT,
  buildInvestmentAndCommitmentBox,
  buildPaymentTermsBox,
  buildAddendumTables,
};
