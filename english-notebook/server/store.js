// Façade: use MongoDB (Atlas) when reachable, otherwise fall back to the
// local sql.js database so the desktop app keeps working offline.
//
// Env switches:
//   MONGO_URI       - Atlas connection string (atlas://..., mongodb+srv://...)
//   REQUIRE_MONGO   - when 'true', a MongoDB failure is fatal (used for Render)
const fs = require('fs')
const path = require('path')

const isElectron = typeof process.versions.electron === 'string'
const isPackagedExe = !isElectron
  && process.execPath.toLowerCase().endsWith('.exe')
  && !path.basename(process.execPath).toLowerCase().includes('node')

let appRoot
if (isElectron) {
  const { app } = require('electron')
  appRoot = app.getPath('userData')
} else if (isPackagedExe) {
  appRoot = path.dirname(process.execPath)
} else {
  appRoot = path.resolve(__dirname, '..')
}
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(appRoot, 'data')
fs.mkdirSync(dataDir, { recursive: true })
const uploadDir = path.join(dataDir, 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })

const mongoStore = require('./store-mongo')
const sqliteStore = require('./store-sqlite')

let active = null

// Name of the store currently serving requests ('mongodb' | 'sqlite' | null).
// Used by /api/health so a deploy that silently fell back is visible.
const getActiveName = () => {
  if (active === mongoStore) return 'mongodb'
  if (active === sqliteStore) return 'sqlite'
  return null
}

const init = async () => {
  if (process.env.VERCEL && !process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set on Vercel. Add it in Project Settings -> Environment Variables, then redeploy.')
  }
  if (process.env.MONGO_URI) {
    try {
      await mongoStore.init()
      active = mongoStore
      console.log('MongoDB connected (Atlas).')
      return
    } catch (error) {
      if (process.env.REQUIRE_MONGO === 'true' || process.env.VERCEL) {
        throw new Error(`MongoDB connection failed: ${error.message}`)
      }
      console.error(`MongoDB unavailable (${error.message}). Falling back to local SQLite storage.`)
    }
  } else {
    console.log('MONGO_URI is not set; using local SQLite storage (offline mode).')
  }
  await sqliteStore.init()
  active = sqliteStore
  console.log('Using local SQLite database.')
}

// Proxy every public store function to the active implementation.
const names = [
  'getAll', 'getTrash', 'getById', 'create', 'update', 'toggleFavorite',
  'softDelete', 'restore', 'permanentDelete', 'updateVocabularyItem',
  'deleteVocabularyItem', 'recordReview',
]
const facade = { init, uploadDir, dataDir, getActiveName }
for (const name of names) {
  facade[name] = (...args) => active[name](...args)
}

module.exports = facade
