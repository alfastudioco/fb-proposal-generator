// Recorded payments (fbpg_payments) as they appear on the proposal itself:
// short "Paid Oct 2, 2026 · Check  −$20,000" lines under the Total Project
// Investment, then Balance Due (or Paid in Full / Credit). Shared by the
// PDF (renderHtml.js) and Word (totals.js) renderers so both read the same.
//
// Only the date, method and amount are shown -- a payment's note is for the
// contractor (check numbers, reminders) and stays off the client's copy.

function formatPaidOn(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return String(iso || '');
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

// Returns null when there are no payments (the proposal renders exactly as
// before). Otherwise { lines: [{ label, amount }], paid, balance,
// balanceLabel, showBalanceAmount }.
function buildPaymentSummary(payments, totalAmount) {
  const list = (Array.isArray(payments) ? payments : [])
    .filter((p) => p && Number(p.amount) > 0)
    .slice()
    .sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on))
      || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  if (!list.length) return null;

  const lines = list.map((p) => ({
    label: `Paid ${formatPaidOn(p.paid_on)}${p.method ? ` · ${p.method}` : ''}`,
    amount: Number(p.amount),
  }));
  const paid = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
  const balance = Math.round(((Number(totalAmount) || 0) - paid) * 100) / 100;

  let balanceLabel = 'Balance Due';
  let showBalanceAmount = true;
  if (balance === 0) {
    balanceLabel = 'Paid in Full';
    showBalanceAmount = false;
  } else if (balance < 0) {
    balanceLabel = 'Credit';
  }
  return { lines, paid, balance: Math.abs(balance), balanceLabel, showBalanceAmount };
}

module.exports = { buildPaymentSummary, formatPaidOn };
