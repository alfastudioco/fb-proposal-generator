// Exercises api/generate-full-proposal.js's mode=edit branch end to end
// against the real Claude API: a notes-only instruction should change
// notes and leave sections untouched; a price-only instruction should
// change one room's price and leave notes/scope untouched.
require('./load-env-local');
const handler = require('../api/generate-full-proposal');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}

async function callEdit(body) {
  const res = mockRes();
  await handler({ method: 'POST', query: { mode: 'edit' }, body }, res);
  return res;
}

const BASE_PROPOSAL = {
  proposalNum: '1901',
  date: 'January 1, 2026',
  client: { name: 'Jane Smith', address: '123 Main St', phone: '', email: '' },
  sections: [
    {
      title: 'Kitchen',
      subtitle: '',
      price: 40000,
      priceLabel: '',
      leftScope: [
        { type: 'tradeLabel', text: 'Demo & Structural' },
        { type: 'bullet', text: 'Demo existing kitchen cabinets' },
      ],
      rightScope: [
        { type: 'tradeLabel', text: 'Finishes' },
        { type: 'bullet', text: 'Paint two coats Benjamin Moore' },
      ],
    },
  ],
  clientSupplied: ['Kitchen sink'],
  notes: 'Permit fees not included.',
  totalLabel: 'Kitchen Remodel',
  investmentNote: '',
  expirationDate: '',
  termsAndConditions: '',
  paymentTerms: undefined,
};

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  const res1 = await callEdit({
    proposal: BASE_PROPOSAL,
    instruction: 'Add a note that our vendor network gives 25-40% discounts at Studio41 for plumbing fixtures.',
  });
  if (res1.statusCode !== 200) throw new Error(`Note edit failed: ${res1.statusCode} ${JSON.stringify(res1.body)}`);
  if (!deepEqual(res1.body.sections, BASE_PROPOSAL.sections)) throw new Error('Sections changed on a notes-only instruction');
  if (res1.body.notes === BASE_PROPOSAL.notes) throw new Error('Notes did not change');
  if (!/studio41|discount/i.test(res1.body.notes)) throw new Error(`New notes text doesn't look right: ${res1.body.notes}`);
  console.log('Case 1 passed: note added, sections untouched.');
  console.log('  New notes:', res1.body.notes);

  const res2 = await callEdit({
    proposal: BASE_PROPOSAL,
    instruction: 'Change the Kitchen price to 45000.',
  });
  if (res2.statusCode !== 200) throw new Error(`Price edit failed: ${res2.statusCode} ${JSON.stringify(res2.body)}`);
  if (res2.body.notes !== BASE_PROPOSAL.notes) throw new Error('Notes changed on a price-only instruction');
  const kitchen = res2.body.sections.find((s) => s.title === 'Kitchen');
  if (!kitchen) throw new Error('Kitchen section missing from response');
  if (Number(kitchen.price) !== 45000) throw new Error(`Kitchen price is ${kitchen.price}, expected 45000`);
  if (!deepEqual(kitchen.leftScope, BASE_PROPOSAL.sections[0].leftScope) || !deepEqual(kitchen.rightScope, BASE_PROPOSAL.sections[0].rightScope)) {
    throw new Error('Scope bullets changed on a price-only instruction');
  }
  console.log('Case 2 passed: Kitchen price updated to 45000, scope/notes untouched.');

  console.log('\ngenerate-full-proposal-edit smoke test passed.');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message || err);
  process.exit(1);
});
