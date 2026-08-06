const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, VerticalAlign, AlignmentType } = require('docx');
const { NAVY, ORANGE, GRAY, LGRAY, ACCENT_FONT, FONT, COL_WIDTHS, pt, spacingPt, cellBorders, thinBorder } = require('./styles');

const CONTACT = {
  phone: '(847) 962-8955',
  email: 'max@fbconstructioninc.com',
  website: 'www.fbcoinc.com',
  address: '3026 Commercial Ave, Northbrook, IL 60062',
};

function contactCell(label, value, width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBorders(),
    margins: { top: 120, bottom: 40, left: 0, right: 200 },
    children: [
      new Paragraph({
        spacing: { after: spacingPt(2) },
        children: [new TextRun({ text: label, font: FONT, size: pt(8), bold: true, color: ORANGE, characterSpacing: 20 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: value, font: FONT, size: pt(10), bold: true, color: NAVY })],
      }),
    ],
  });
}

function buildContactFooter() {
  const [w1, w2, w3] = COL_WIDTHS.contactFooter;
  const table = new Table({
    width: { size: w1 + w2 + w3, type: WidthType.DXA },
    columnWidths: COL_WIDTHS.contactFooter,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          contactCell('PHONE', CONTACT.phone, w1),
          contactCell('EMAIL', CONTACT.email, w2),
          contactCell('WEBSITE', CONTACT.website, w3),
        ],
      }),
    ],
  });

  const addressLine = new Paragraph({
    spacing: { before: spacingPt(4) },
    children: [new TextRun({ text: CONTACT.address, font: FONT, size: pt(9), color: GRAY })],
  });

  const topRule = new Paragraph({
    spacing: { before: spacingPt(8), after: spacingPt(4) },
    border: { top: thinBorder(LGRAY) },
    children: [],
  });

  return [topRule, table, addressLine];
}

function buildExpirationLine(expirationDate) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: spacingPt(4) },
    children: [
      new TextRun({
        text: `This proposal is valid until ${expirationDate}. Pricing is subject to change after this date.`,
        font: ACCENT_FONT,
        italics: true,
        size: pt(9),
        color: GRAY,
      }),
    ],
  });
}

function signatureCell(caption, width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBorders(),
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: [
      new Paragraph({
        spacing: { before: spacingPt(30) },
        border: { bottom: thinBorder(LGRAY) },
        children: [new TextRun({ text: ' ' })],
      }),
      new Paragraph({
        spacing: { before: spacingPt(4) },
        children: [new TextRun({ text: caption, font: FONT, size: pt(8), color: LGRAY, characterSpacing: 15 })],
      }),
    ],
  });
}

function spacerCell(width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBorders(),
    children: [new Paragraph({ children: [] })],
  });
}

function buildSignatureLines() {
  const [w1, w2, w3] = COL_WIDTHS.signature;
  return new Table({
    width: { size: w1 + w2 + w3, type: WidthType.DXA },
    columnWidths: COL_WIDTHS.signature,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          signatureCell('FB CONSTRUCTION — AUTHORIZED SIGNATURE & DATE', w1),
          spacerCell(w2),
          signatureCell('CLIENT ACCEPTANCE & DATE', w3),
        ],
      }),
    ],
  });
}

module.exports = { CONTACT, buildContactFooter, buildSignatureLines, buildExpirationLine };
