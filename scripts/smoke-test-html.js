const fs = require('fs');
const path = require('path');
const { renderProposalHtml } = require('../generator/renderHtml');

// Reuse the same sample data shapes as smoke-test.js (kept inline here to
// avoid coupling the two scratch scripts together).
const sample = {
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
      title: 'Master Bathroom Remodel',
      price: 48600,
      leftScope: [
        { type: 'tradeLabel', text: 'Demo & Structural' },
        { type: 'bullet', text: 'Full demolition of existing bathroom finishes and fixtures' },
        { type: 'bullet', text: 'Reframe for new walk-in shower footprint' },
      ],
      rightScope: [
        { type: 'tradeLabel', text: 'Installation & Finishes' },
        { type: 'bullet', text: 'Install tile shower surround and floor tile' },
        { type: 'bullet', text: 'Install vanity, mirror, and lighting fixtures' },
      ],
    },
  ],
  clientSupplied: ['All tile (shower, walls, floor)', 'Vanity and fixtures'],
  notes: 'Countertop pricing pending stone selection.',
  totalLabel: 'Master Bath',
  totalAmount: 48600,
};

const outDir = path.join(__dirname, '..', 'scratch');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'preview.html');
fs.writeFileSync(outPath, renderProposalHtml(sample));
console.log(`Wrote ${outPath}`);
