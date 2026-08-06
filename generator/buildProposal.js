const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { Document, Packer, Paragraph } = require('docx');

const { PAGE, numberingConfig } = require('./styles');
const {
  buildHeader,
  buildMetaBar,
  buildSectionBanner,
  buildTwoColumnScope,
  buildClientSuppliedItems,
  buildNotesBox,
  buildTermsBox,
} = require('./sections');
const { buildInvestmentAndCommitmentBox } = require('./totals');
const { buildContactFooter, buildSignatureLines, buildExpirationLine } = require('./footer');

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo_rgb.png');

function spacer(twips) {
  return new Paragraph({ spacing: { after: twips }, children: [] });
}

// Two `docx`-library quirks in the embedded logo's XML, both confirmed via
// direct Word COM automation testing (Word rejects the raw output outright
// with "Word encountered an error processing the XML file" -- it doesn't
// just warn, it silently "repairs" the file on open, which is what actually
// mangles formatting for the end user):
//   1. ImageRun always emits <pic:cNvPr id="0" name="" descr=""/> for the
//      embedded picture's non-visual properties -- hardcoded inside the
//      library with no constructor option to fill it in (unlike the outer
//      <wp:docPr>, which IS configurable via ImageRun's `altText` option,
//      set in sections.js). An empty required `name` fails validation.
//   2. Even with `altText` supplying name/description, the library also
//      emits a `title` attribute on <wp:docPr> -- a DrawingML attribute
//      added in a later OOXML revision than the one older Word versions
//      (confirmed: Word 2007) validate against. Its mere presence, empty
//      or not, is rejected outright by those versions.
// Both patched here as a targeted post-process on the generated zip rather
// than forking/patching the library.
async function patchDrawingXmlForCompatibility(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) return docxBuffer;

  const xml = await docXmlFile.async('string');
  const patched = xml
    .replace(
      /<pic:cNvPr id="(\d+)" name="" descr=""\s*\/>/g,
      '<pic:cNvPr id="$1" name="FB Construction Logo" descr="FB Construction Logo"/>',
    )
    .replace(/(<wp:docPr\b[^>]*?)\s+title="[^"]*"/g, '$1');
  if (patched === xml) return docxBuffer;

  zip.file('word/document.xml', patched);
  return zip.generateAsync({ type: 'nodebuffer' });
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

  const isSingleSection = data.sections.length === 1;

  for (const section of data.sections) {
    children.push(
      buildSectionBanner({
        num: section.num,
        title: section.title,
        subtitle: section.subtitle,
        price: section.price,
        priceLabel: section.priceLabel,
        hero: isSingleSection,
      }),
    );
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
      paymentTerms: data.paymentTerms,
    }),
  );
  children.push(spacer(240));

  children.push(...buildTermsBox(data.termsAndConditions));
  if (data.termsAndConditions && data.termsAndConditions.trim()) children.push(spacer(200));

  children.push(...buildContactFooter());
  children.push(spacer(240));

  if (data.expirationDate) {
    children.push(buildExpirationLine(data.expirationDate));
  }

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

  const docxBuffer = await Packer.toBuffer(doc);
  return patchDrawingXmlForCompatibility(docxBuffer);
}

module.exports = { buildProposal };
