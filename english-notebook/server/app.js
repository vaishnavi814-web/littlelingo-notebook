// Shared Express app. The same app serves the desktop engine (via index.js,
// which starts the HTTP listener) and Vercel serverless functions (via
// api/[...slug].js). Everything — /api/entries, /api/ai, /api/uploads and
// /api/health — is identical either way.
require('dotenv').config()

const express = require('express')
const multer = require('multer')
const path = require('path')
const { randomUUID } = require('crypto')
const { init, uploadDir } = require('./store')
const entriesRouter = require('./routes/entries')
const aiRouter = require('./routes/ai')

const app = express()
const publicDir = path.join(__dirname, 'public')
const imageExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

app.use(express.json({ limit: '1mb' }))

// Allow cross-origin browser calls (e.g. Vercel frontend -> this API).
// Same-origin calls always work regardless of this setting.
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*'
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', database: 'connected' })
})

app.use('/api/entries', entriesRouter)
app.use('/api/ai', aiRouter)

// 404 for unknown API routes
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'That API route does not exist.' })
})

// Static UI (desktop / local dev). On Vercel, filesystem routing serves the
// client build instead, and this never runs.
app.use(express.static(publicDir))

// SPA fallback for non-API paths (desktop only).
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next()
  res.sendFile(path.join(publicDir, 'index.html'), (error) => { if (error) next(error) })
})

// Uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, callback) => callback(null, `${randomUUID()}${imageExtensions[file.mimetype] || ''}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Choose a JPG, PNG, or WebP image.')
      error.code = 'INVALID_IMAGE_TYPE'
      return callback(error)
    }
    callback(null, true)
  },
})

app.post('/api/uploads', upload.single('image'), (req, res, next) => {
  if (!req.file) return res.status(400).json({ message: 'Choose an image to upload.' })
  res.status(201).json({ url: `/uploads/${req.file.filename}` })
})

// Global error handler
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      message: error.code === 'LIMIT_FILE_SIZE' ? 'Images must be smaller than 8 MB.' : error.message,
    })
  }
  if (error.code === 'INVALID_IMAGE_TYPE') return res.status(400).json({ message: error.message })
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return res.status(400).json({ message: error.message })
  }
  console.error('API error:', error.message)
  res.status(500).json({ message: 'Something went wrong while handling that request.' })
})

// Connect to the store (MongoDB Atlas when MONGO_URI is set, else SQLite).
// Exported so serverless handlers can `await started` before serving traffic.
const started = init()

module.exports = { app, started }
