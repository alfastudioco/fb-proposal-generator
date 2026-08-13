// Shared JSON-schema shape for the "sections" field in the AI tool-use
// output used by api/generate-full-proposal.js (draft from description),
// api/import-quickbooks.js (extract from PDF), and
// api/generate-budget-from-blueprints.js (draft from blueprint files).
// All three ask the model to return the same rooms/sections structure --
// title + price + scope items grouped under trade labels -- so the shape
// is shared here while each endpoint supplies its own wording for what
// it's asking the model to do.
function buildSectionsProperty({ sectionsDescription, priceDescription, itemsDescription }) {
  return {
    type: 'array',
    description: sectionsDescription,
    items: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Room or area name, e.g. "Kitchen" or "Hall Bathroom".' },
        price: { type: 'number', description: priceDescription },
        items: {
          type: 'array',
          description: itemsDescription,
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['tradeLabel', 'bullet'] },
              text: { type: 'string' },
            },
            required: ['type', 'text'],
          },
        },
      },
      required: ['title', 'price', 'items'],
    },
  };
}

module.exports = { buildSectionsProperty };
