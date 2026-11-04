const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, VerticalAlign, AlignmentType, TabStopType } = require('docx');
const {
  NAVY_DARK, ORANGE, GRAY, LGRAY, FONT, ACCENT_FONT,
  COL_WIDTHS, pt, spacingPt, cellBorders, thinBorder, thickBorder, formatCurrency,
} = require('./styles');

// Open, ruled layout (matches the room banners): no filled boxes -- a thin
// navy rule on top, the orange rule below, and a hairline between the
// total and the payment-terms / commitment column.
const RULES = () => ({ top: thickBorder(NAVY_DARK, 1), bottom: thickBorder(ORANGE, 1.5) });
const LEFT_MARGINS = { top: 300, bottom: 280, left: 0, right: 400 };
const RIGHT_MARGINS = { top: 300, bottom: 280, left: 400, right: 0 };
// Right edge of the payment-terms column's text area, for the amount tab stop.
const PAYMENT_TAB_POS = COL_WIDTHS.investment[1] - RIGHT_MARGINS.left - 20;

function rightColumnCell(children) {
  return new TableCell({
    width: { size: COL_WIDTHS.investment[1], type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: RIGHT_MARGINS,
    borders: cellBorders({ ...RULES(), left: thinBorder('DDDDDD') }),
    children,
  });
}

function columnLabel(text) {
  return new Paragraph({
    spacing: { after: spacingPt(8) },
    children: [new TextRun({ text, font: FONT, size: pt(8), bold: true, color: LGRAY, characterSpacing: 16 })],
  });
}

const COMMITMENT_TEXT =
  'Single point of contact, daily site cleanliness, and transparent communication at every ' +
  'milestone — from first demo to final walkthrough.';

function investmentCell(totalLabel, totalAmount, note) {
  const children = [columnLabel('TOTAL PROJECT INVESTMENT')];

  if (totalLabel) {
    children.push(
      new Paragraph({
        spacing: { after: spacingPt(4) },
        children: [new TextRun({ text: totalLabel, font: FONT, size: pt(10), color: GRAY })],
      }),
    );
  }

  children.push(
    new Paragraph({
      spacing: { after: note ? spacingPt(10) : 0 },
      children: [new TextRun({ text: formatCurrency(totalAmount), font: ACCENT_FONT, size: pt(30), color: NAVY_DARK })],
    }),
  );

  if (note) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: note, font: FONT, italics: true, size: pt(9), color: GRAY })],
      }),
    );
  }

  return new TableCell({
    width: { size: COL_WIDTHS.investment[0], type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: LEFT_MARGINS,
    borders: cellBorders(RULES()),
    children,
  });
}

function commitmentCell() {
  return rightColumnCell([
    columnLabel('OUR COMMITMENT'),
    new Paragraph({
      children: [new TextRun({ text: COMMITMENT_TEXT, font: FONT, italics: true, size: pt(10), color: GRAY })],
    }),
  ]);
}

function buildInvestmentAndCommitmentBox({ totalLabel, totalAmount, note, paymentTerms }) {
  const rightCell = paymentTerms ? buildPaymentTermsBox(paymentTerms) : commitmentCell();
  return new Table({
    width: { size: COL_WIDTHS.investment[0] + COL_WIDTHS.investment[1], type: WidthType.DXA },
    columnWidths: COL_WIDTHS.investment,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [investmentCell(totalLabel, totalAmount, note), rightCell],
      }),
    ],
  });
}

// Replaces the "Our Commitment" cell with a flexible list of payment lines
// (deposit/milestones/balance -- the split varies per job, so this is a
// free-form {label, amount} list rather than a fixed deposit/balance split).
function buildPaymentTermsBox(paymentTerms) {
  const { lines, note } = paymentTerms;

  const children = [columnLabel('PAYMENT TERMS')];

  lines.forEach((line, i) => {
    children.push(
      new Paragraph({
        spacing: { after: i === lines.length - 1 ? 0 : spacingPt(4) },
        tabStops: [{ type: TabStopType.RIGHT, position: PAYMENT_TAB_POS }],
        children: [
          new TextRun({ text: line.label, font: FONT, size: pt(10), color: GRAY }),
          new TextRun({ text: `\t${formatCurrency(line.amount)}`, font: FONT, size: pt(10), bold: true, color: NAVY_DARK }),
        ],
      }),
    );
  });

  if (note) {
    children.push(
      new Paragraph({
        spacing: { before: spacingPt(8) },
        children: [new TextRun({ text: note, font: FONT, italics: true, size: pt(9), color: GRAY })],
      }),
    );
  }

  return rightColumnCell(children);
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
