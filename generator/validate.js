function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateScopeItems(items, label, errors) {
  if (!Array.isArray(items)) {
    errors.push(`${label} must be an array`);
    return;
  }
  items.forEach((item, i) => {
    if (!item || (item.type !== 'tradeLabel' && item.type !== 'bullet')) {
      errors.push(`${label}[${i}].type must be "tradeLabel" or "bullet"`);
    }
    if (!isNonEmptyString(item && item.text)) {
      errors.push(`${label}[${i}].text must be a non-empty string`);
    }
  });
}

function validateProposalData(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  if (!isNonEmptyString(body.proposalNum)) errors.push('proposalNum is required');
  if (!isNonEmptyString(body.date)) errors.push('date is required');

  if (!body.client || typeof body.client !== 'object') {
    errors.push('client is required');
  } else if (!isNonEmptyString(body.client.name)) {
    errors.push('client.name is required');
  }

  if (!Array.isArray(body.sections) || body.sections.length === 0) {
    errors.push('sections must be a non-empty array');
  } else {
    body.sections.forEach((section, i) => {
      if (typeof section.num !== 'number') errors.push(`sections[${i}].num must be a number`);
      if (!isNonEmptyString(section.title)) errors.push(`sections[${i}].title is required`);
      if (typeof section.price !== 'number') errors.push(`sections[${i}].price must be a number`);
      validateScopeItems(section.leftScope || [], `sections[${i}].leftScope`, errors);
      validateScopeItems(section.rightScope || [], `sections[${i}].rightScope`, errors);
    });
  }

  if (typeof body.totalAmount !== 'number') errors.push('totalAmount must be a number');

  if (body.clientSupplied !== undefined && !Array.isArray(body.clientSupplied)) {
    errors.push('clientSupplied must be an array if provided');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateProposalData };
