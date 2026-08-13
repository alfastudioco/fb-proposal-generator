// Verifies api/generate-budget-from-blueprints.js resolves under plain
// Node (so Vercel's build-time tracing will bundle it correctly) without
// making a real (paid) Anthropic API call -- matches this repo's existing
// scripts/smoke-test-import.js convention for AI-calling endpoints.
const handler = require('../api/generate-budget-from-blueprints');
if (typeof handler !== 'function') {
  throw new Error('api/generate-budget-from-blueprints.js did not export a handler function');
}
console.log('api/generate-budget-from-blueprints.js loaded OK, handler type:', typeof handler);
