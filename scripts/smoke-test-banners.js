// Dev-only smoke test for the hero (single-section) vs standard
// (multi-section) banner variants, plus subtitle/priceLabel support.
// Writes docx + renders HTML->PNG via puppeteer for visual inspection.
const fs = require('fs');
const path = require('path');
const { buildProposal } = require('../generator/buildProposal');
const { renderProposalHtml } = require('../generator/renderHtml');

const heroSample = {
  proposalNum: '1899',
  date: 'July 15, 2026',
  client: { name: 'Mike Nash', address: '2551 Shannon Rd, Northbrook, IL 60062', phone: '773-558-7772' },
  sections: [
    {
      num: 1,
      title: 'Basement Flooring',
      subtitle: 'Remove & replace — 2551 Shannon Rd, Northbrook',
      price: 3200,
      leftScope: [
        { type: 'tradeLabel', text: 'Scope of Work' },
        { type: 'bullet', text: 'Remove all existing flooring throughout basement' },
        { type: 'bullet', text: 'Full debris and garbage haul-away included' },
      ],
      rightScope: [
        { type: 'tradeLabel', text: 'Client-Supplied Items' },
        { type: 'bullet', text: 'Free-floating vinyl flooring — supplied by owner, installed by FB Construction' },
      ],
    },
  ],
  totalLabel: 'Basement Flooring Replacement',
  totalAmount: 3200,
};

const multiSample = {
  proposalNum: '1895',
  date: 'July 10, 2026',
  client: { name: 'Cameron Sullivan', address: '506 S Dryden Pln, Arlington Heights, IL' },
  sections: [
    {
      num: 1,
      title: 'Kitchen Renovation',
      price: 42400,
      leftScope: [
        { type: 'tradeLabel', text: 'Demo & Structural' },
        { type: 'bullet', text: 'Create larger opening between kitchen and front room, pending structural feasibility assessment' },
      ],
      rightScope: [
        { type: 'tradeLabel', text: 'Installation & Finishes' },
        { type: 'bullet', text: 'Install new customer-supplied cabinets and appliances' },
      ],
    },
    {
      num: 2,
      title: 'Hardwood Flooring — Refinish',
      subtitle: 'Kitchen area & mudroom',
      price: 5600,
      leftScope: [{ type: 'bullet', text: 'Fill all gaps in existing hardwood prior to sanding' }],
      rightScope: [{ type: 'bullet', text: 'Stain per client color selection' }],
    },
    {
      num: 3,
      title: 'Cabinet Allowance',
      subtitle: 'Ballpark estimate — pending final layout & selection',
      price: 16500,
      priceLabel: 'Estimate',
      leftScope: [],
      rightScope: [],
    },
  ],
  clientSupplied: ['Kitchen cabinets & hardware', 'All appliances'],
  notes: 'Permit fees and drawings not included — FB Construction will manage the permit process as required by the village.',
  totalLabel: 'Kitchen • Flooring • Cabinets',
  totalAmount: 64500,
  investmentNote: 'Cabinet pricing subject to finalization',
};

async function main() {
  const outDir = path.join(__dirname, '..', 'scratch');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [name, data] of [['hero-mike-nash', heroSample], ['multi-cameron-sullivan', multiSample]]) {
    const docxBuffer = await buildProposal(data);
    fs.writeFileSync(path.join(outDir, `${name}.docx`), docxBuffer);
    fs.writeFileSync(path.join(outDir, `${name}.html`), renderProposalHtml(data));
    console.log(`Wrote ${name}.docx and ${name}.html`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
