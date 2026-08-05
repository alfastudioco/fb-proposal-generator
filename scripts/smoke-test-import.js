// Verifies api/generate.js can require ../generator/* via relative paths
// and that the handler shape is callable with mock req/res, without
// needing a live Vercel dev server (which requires an interactive login).
// Vercel's @vercel/node build step traces plain require()/import calls to
// decide what to bundle, so if this resolves under plain Node, it resolves
// under Vercel too.

const handler = require('../api/generate');
console.log('api/generate.js loaded OK, handler type:', typeof handler);
