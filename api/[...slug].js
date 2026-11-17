// Single Vercel catch-all function for the entire API.
// The Express app in english-notebook/server/app.js handles every /api/* route.
// Desktop / Electron never uses this file; it uses the same app through
// english-notebook/server/index.js (a real HTTP listener).
const { app, started } = require('../english-notebook/server/app')

module.exports = async (req, res) => {
  await started
  return app(req, res)
}
