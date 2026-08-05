const { formatCurrency } = require('../generator/styles');

module.exports = async function handler(req, res) {
  res.status(200).json({ ok: true, sample: formatCurrency(75250) });
};
