// Confirms the shared sections-schema factory produces the expected
// shape, and that the two endpoints that now depend on it still load.
const { buildSectionsProperty } = require('../lib/proposalDraftTool');

function main() {
  const schema = buildSectionsProperty({
    sectionsDescription: 'desc',
    priceDescription: 'price desc',
    itemsDescription: 'items desc',
    titleDescription: 'title desc',
  });
  if (schema.type !== 'array') throw new Error('Expected sections schema type "array"');
  const itemProps = schema.items.properties;
  if (!itemProps.title || !itemProps.price || !itemProps.items) {
    throw new Error('Missing expected section properties (title/price/items)');
  }
  if (itemProps.title.description !== 'title desc') {
    throw new Error(`Expected titleDescription to flow through to title.description, got: ${itemProps.title.description}`);
  }
  const scopeItemEnum = itemProps.items.items.properties.type.enum;
  if (scopeItemEnum.join(',') !== 'tradeLabel,bullet') {
    throw new Error(`Unexpected scope item type enum: ${scopeItemEnum}`);
  }

  const fullProposalHandler = require('../api/generate-full-proposal');
  const importHandler = require('../api/import-quickbooks');
  if (typeof fullProposalHandler !== 'function') throw new Error('generate-full-proposal.js handler not callable');
  if (typeof importHandler !== 'function') throw new Error('import-quickbooks.js handler not callable');

  console.log('proposalDraftTool smoke test passed.');
}

main();
