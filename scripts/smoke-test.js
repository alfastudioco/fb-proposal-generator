// Dev-only smoke test: builds sample proposals and writes the resulting
// .docx buffers to a local scratch folder for manual visual inspection.
// Not part of the deployed app.

const fs = require('fs');
const path = require('path');
const { buildProposal } = require('../generator/buildProposal');

const OUT_DIR = path.join(__dirname, '..', 'scratch');

const mikeNash = {
  proposalNum: '2203',
  date: 'August 4, 2026',
  client: {
    name: 'Mike Nash',
    address: '412 Elm St, Northbrook, IL 60062',
    phone: '847-555-0134',
    email: 'mike.nash@example.com',
  },
  sections: [
    {
      num: 1,
      title: 'Basement Flooring',
      price: 3200,
      leftScope: [
        { type: 'tradeLabel', text: 'Demo & Prep' },
        { type: 'bullet', text: 'Remove existing carpet and pad, haul away debris' },
        { type: 'bullet', text: 'Level and prep subfloor as needed' },
      ],
      rightScope: [
        { type: 'tradeLabel', text: 'Installation & Finishes' },
        { type: 'bullet', text: 'Install luxury vinyl plank flooring throughout' },
        { type: 'bullet', text: 'Install matching baseboard trim' },
      ],
    },
  ],
  clientSupplied: ['Flooring material selection (LVP)'],
  notes:
    'Permit fees not included — FB Construction will manage all permit paperwork.\n' +
    'All client-supplied materials should be on site prior to scheduled installation.',
  totalLabel: 'Basement Flooring',
  totalAmount: 3200,
};

const erikaDillon = {
  proposalNum: '1901',
  date: 'August 3, 2026',
  client: {
    name: 'Erika Dillon',
    address: '1325 N Astor St, Chicago, IL 60610',
    phone: '847-922-8665',
    email: 'erika@example.com',
  },
  sections: [
    {
      num: 1,
      title: 'Structural Engineering',
      price: 8600,
      leftScope: [
        { type: 'tradeLabel', text: 'Engineering & Permitting' },
        { type: 'bullet', text: 'Structural engineering review and stamped drawings' },
        { type: 'bullet', text: 'Permit application and coordination with village' },
      ],
      rightScope: [
        { type: 'tradeLabel', text: 'Site Assessment' },
        { type: 'bullet', text: 'Load-bearing wall assessment for proposed layout change' },
      ],
    },
    {
      num: 2,
      title: 'Master Bathroom Remodel',
      price: 48600,
      leftScope: [
        { type: 'tradeLabel', text: 'Demo & Structural' },
        { type: 'bullet', text: 'Full demolition of existing bathroom finishes and fixtures' },
        { type: 'bullet', text: 'Reframe for new walk-in shower footprint' },
        { type: 'tradeLabel', text: 'Plumbing' },
        { type: 'bullet', text: 'Relocate supply and drain lines for new layout' },
      ],
      rightScope: [
        { type: 'tradeLabel', text: 'Installation & Finishes' },
        { type: 'bullet', text: 'Install tile shower surround and floor tile' },
        { type: 'bullet', text: 'Install vanity, mirror, and lighting fixtures' },
        { type: 'bullet', text: 'Paint and final trim' },
      ],
    },
    {
      num: 3,
      title: 'Laundry & Closet Renovation',
      price: 19600,
      leftScope: [
        { type: 'tradeLabel', text: 'Demo & Rough Work' },
        { type: 'bullet', text: 'Demo existing laundry closet and adjacent storage' },
      ],
      rightScope: [
        { type: 'tradeLabel', text: 'Installation & Finishes' },
        { type: 'bullet', text: 'Install custom shelving and cabinetry' },
        { type: 'bullet', text: 'New flooring and paint throughout' },
      ],
    },
  ],
  clientSupplied: ['All tile (shower, walls, floor)', 'Vanity and fixtures', 'Closet shelving hardware finish selection'],
  notes: 'Countertop pricing pending stone selection — countertop fabrication and installation to be contracted separately through preferred vendor.',
  totalLabel: 'Engineering • Master Bath • Laundry',
  totalAmount: 76800,
  investmentNote: 'Countertop pricing subject to finalization',
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [name, data] of [
    ['mike-nash', mikeNash],
    ['erika-dillon', erikaDillon],
  ]) {
    const buffer = await buildProposal(data);
    const outPath = path.join(OUT_DIR, `${name}.docx`);
    fs.writeFileSync(outPath, buffer);
    console.log(`Wrote ${outPath} (${buffer.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
