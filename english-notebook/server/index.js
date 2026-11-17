// Desktop / local-dev entry point: serve the shared Express app on a port.
// Vercel serverless functions use the same app via api/[...slug].js instead.
const { app, started } = require('./app')

const port = process.env.PORT === '0' ? 0 : Number(process.env.PORT) || 5000
const host = process.env.HOST || '127.0.0.1'

let server
const startedServer = started.then(() => new Promise((resolve, reject) => {
  server = app.listen(port, host, () => {
    const actualPort = server.address().port
    console.log(`English notebook API listening on http://${host}:${actualPort}`)
    resolve(actualPort)
  })
  server.on('error', reject)
})).catch((error) => {
  console.error(`English notebook API failed to start: ${error.message}`)
  process.exit(1)
})

const stop = async () => {
  if (!server?.listening) return
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

module.exports = { app, started: startedServer, stop }
