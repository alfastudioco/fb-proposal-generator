const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph } = require('docx');

const { PAGE, numberingConfig } = require('./styles');
const {
  buildHeader,
  buildMetaBar,
  buildSectionBanner,
  buildTwoColumnScope,
  buildClientSuppliedItems,
  buildNotesBox,
} = require('./sections');
const { buildInvestmentAndCommitmentBox } = require('./totals');
const { buildContactFooter, buildSignatureLines } = require('./footer');

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo_rgb.png');

function spacer(twips) {
  return new Paragraph({ spacing: { after: twips }, children: [] });
}

async function buildProposal(proposalData) {
  const logoBuffer = fs.readFileSync(LOGO_PATH);

  const data = {
    clientSupplied: [],
    notes: '',
    totalLabel: '',
    ...proposalData,
  };

  const children = [];

  children.push(...buildHeader(logoBuffer, { updated: !!data.updated }));
  children.push(
    ...buildMetaBar({
      client: data.client,
      proposalNum: data.proposalNum,
      date: data.date,
    }),
  );

  for (const section of data.sections) {
    children.push(buildSectionBanner({ num: section.num, title: section.title, price: section.price }));
    children.push(spacer(120));
    children.push(buildTwoColumnScope({ leftScope: section.leftScope || [], rightScope: section.rightScope || [] }));
    children.push(spacer(240));
  }

  children.push(...buildClientSuppliedItems(data.clientSupplied));
  if (data.clientSupplied.length) children.push(spacer(160));

  children.push(...buildNotesBox(data.notes));
  if (data.notes && data.notes.trim()) children.push(spacer(200));

  children.push(
    buildInvestmentAndCommitmentBox({
      totalLabel: data.totalLabel,
      totalAmount: data.totalAmount,
      note: data.investmentNote,
    }),
  );
  children.push(spacer(240));

  children.push(...buildContactFooter());
  children.push(spacer(240));
  children.push(buildSignatureLines());

  const doc = new Document({
    numbering: numberingConfig,
    sections: [
      {
        properties: { page: PAGE },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildProposal };
