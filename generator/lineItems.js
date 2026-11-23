// Priced line items inside a room/section -- e.g. one "Cabinetry & Millwork"
// block listing Master Bath / Closet / Entry / Laundry, or a "Materials
// Purchased" block listing small items bought for the client.
//
// Shape (stored inside the sections jsonb, so no migration):
//   section.lineItems = [{ text, detail?, qty?, price }]
//   - price is the price of ONE unit; the line's total is qty x price
//     (qty blank/1 means the price is the line total).
//   - when a section has any line items, its own price is always the sum of
//     the line totals -- applyLineItemTotals() enforces that server-side, so
//     the banner, the grand total and the itemized lines can never disagree.

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function lineQty(item) {
  const q = Number(item && item.qty);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function lineTotal(item) {
  return round2(lineQty(item) * (Number(item && item.price) || 0));
}

function hasLineItems(section) {
  return Array.isArray(section && section.lineItems) && section.lineItems.length > 0;
}

function sectionLineTotal(section) {
  return round2((section.lineItems || []).reduce((sum, item) => sum + lineTotal(item), 0));
}

// Mutates and returns data: each section with line items gets price = sum
// of its lines, and totalAmount is re-summed if any section changed.
function applyLineItemTotals(data) {
  if (!data || !Array.isArray(data.sections)) return data;
  let changed = false;
  for (const section of data.sections) {
    if (!hasLineItems(section)) continue;
    const sum = sectionLineTotal(section);
    if (section.price !== sum) {
      section.price = sum;
      changed = true;
    }
  }
  if (changed || data.sections.some(hasLineItems)) {
    data.totalAmount = round2(data.sections.reduce((sum, s) => sum + (Number(s.price) || 0), 0));
  }
  return data;
}

module.exports = { lineQty, lineTotal, hasLineItems, sectionLineTotal, applyLineItemTotals };
