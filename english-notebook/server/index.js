require('dotenv').config()

const express = require('express')
const multer = require('multer')
const path = require('path')
const { randomUUID } = require('crypto')
const { init, uploadDir } = require('./store')
const entriesRouter = require('./routes/entries')
const aiRouter = require('./routes/ai')

const app = express()
const port = process.env.PORT === '0' ? 0 : Number(process.env.PORT) || 5000
const host = process.env.HOST || '127.0.0.1'
const imageExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

const publicDir = path.join(__dirname, 'public')

app.use(express.json({ limit: '1mb' }))
app.use('/uploads', express.static(uploadDir, { dotfiles: 'deny', index: false }))

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', database: 'connected' })
})

app.use('/api/entries', entriesRouter)
app.use('/api/ai', aiRouter)

app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'That API route does not exist.' })
})

app.use(express.static(publicDir))

app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return res.status(404).json({ message: 'Not found.' })
  }
  res.sendFile(path.join(publicDir, 'index.html'))
})

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

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, callback) => {
      callback(null, `${randomUUID()}${imageExtensions[file.mimetype] || ''}`)
    },
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

let server
const started = init().then(() => new Promise((resolve, reject) => {
  server = app.listen(port, host, () => {
    const actualPort = server.address().port
    console.log(`English notebook API listening on http://${host}:${actualPort}`)
    resolve(actualPort)
  })
  server.on('error', reject)
}))

const stop = async () => {
  if (!server?.listening) return
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

module.exports = { app, started, stop }
