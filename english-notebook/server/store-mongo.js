// MongoDB store: requires MONGO_URI (Atlas or any reachable mongod).
// The older sql.js implementation was replaced; it is kept in
// C:\Users\Admin\AppData\Local\Temp\opencode\mongo-migration-backup\store.js
const mongoose = require('mongoose')
const fs = require('fs')
const path = require('path')

// Keep the same upload-folder logic as before, so images still persist to disk.
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

const Entry = require('./models/Entry')

const toIso = (value) => value instanceof Date ? value.toISOString() : value
const toEntry = (doc) => {
  if (!doc) return null
  const item = doc.toObject({ versionKey: false })
  return {
    ...item,
    _id: String(item._id),
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt),
    deletedAt: toIso(item.deletedAt),
    vocabulary: (item.vocabulary || []).map((entry) => ({
      ...entry,
      reviewDueAt: toIso(entry.reviewDueAt),
      reviewedAt: toIso(entry.reviewedAt),
    })),
  }
}
const toEntryLean = toEntry

let initialized = false
const init = async () => {
  if (initialized) return
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set. Add it to server/.env (see server/.env.example) pointing at your MongoDB Atlas cluster.')
  }
  await mongoose.connect(process.env.MONGO_URI)
  initialized = true
}

const getAll = async () => {
  const rows = await Entry.find({ deletedAt: null }).sort({ entryDate: -1, updatedAt: -1 })
  return rows.map(toEntry)
}

const getTrash = async () => {
  const rows = await Entry.find({ deletedAt: { $ne: null } }).sort({ deletedAt: -1 })
  return rows.map(toEntry)
}

const isValidObjectId = (id) => mongoose.isValidObjectId(id)

const getById = async (id) => {
  if (!isValidObjectId(id)) return null
  const row = await Entry.findById(id)
  return toEntry(row)
}

const create = async (value) => {
  const entry = await Entry.create(value)
  return toEntry(entry)
}

const update = async (id, value) => {
  if (!isValidObjectId(id)) return null
  const entry = await Entry.findById(id)
  if (!entry) return null
  entry.title = value.title
  entry.entryDate = value.entryDate
  entry.content = value.content
  entry.favorite = Boolean(value.favorite)
  entry.tags = value.tags
  entry.difficulty = value.difficulty
  entry.learningGoal = value.learningGoal
  entry.vocabulary = value.vocabulary.map((item) => ({
    ...item,
    examples: item.examples ?? [],
    synonyms: item.synonyms ?? [],
    antonyms: item.antonyms ?? [],
    tags: item.tags ?? [],
  }))
  await entry.save()
  return toEntry(entry)
}

const toggleFavorite = async (id, favorite) => {
  if (!isValidObjectId(id)) return null
  const entry = await Entry.findById(id)
  if (!entry) return null
  entry.favorite = Boolean(favorite)
  await entry.save()
  return toEntry(entry)
}

const softDelete = async (id) => {
  if (!isValidObjectId(id)) return null
  const entry = await Entry.findById(id)
  if (!entry || entry.deletedAt != null) return null
  entry.deletedAt = new Date()
  await entry.save()
  return toEntry(entry)
}

const restore = async (id) => {
  if (!isValidObjectId(id)) return null
  const entry = await Entry.findById(id)
  if (!entry || entry.deletedAt == null) return null
  entry.deletedAt = null
  await entry.save()
  return toEntry(entry)
}

const permanentDelete = async (id) => {
  if (!isValidObjectId(id)) return false
  const entry = await Entry.findById(id)
  if (!entry || entry.deletedAt == null) return false
  await Entry.deleteOne({ _id: entry._id })
  return true
}

const updateVocabularyItem = async (id, index, value) => {
  if (!isValidObjectId(id)) return null
  const entry = await Entry.findById(id)
  if (!entry) return null
  if (index < 0 || index >= entry.vocabulary.length) return null
  const existing = entry.vocabulary[index].toObject()
  const next = {
    ...existing,
    ...value,
    examples: value.examples ?? existing.examples,
    synonyms: value.synonyms ?? existing.synonyms,
    antonyms: value.antonyms ?? existing.antonyms,
    tags: value.tags ?? existing.tags,
  }
  entry.vocabulary[index] = next
  await entry.save()
  return toEntry(entry)
}

const deleteVocabularyItem = async (id, index) => {
  if (!isValidObjectId(id)) return null
  const entry = await Entry.findById(id)
  if (!entry) return null
  if (index < 0 || index >= entry.vocabulary.length) return null
  entry.vocabulary.splice(index, 1)
  await entry.save()
  return { entry: toEntry(entry), message: 'Vocabulary item deleted.' }
}

const recordReview = async (id, index, rating) => {
  if (!isValidObjectId(id)) return null
  const entry = await Entry.findById(id)
  if (!entry) return null
  if (index < 0 || index >= entry.vocabulary.length) return null
  const item = entry.vocabulary[index]

  const now = Date.now()
  const previousRepetitions = item.reviewRepetitions || 0
  let interval = item.reviewInterval || 0
  let reviewRepetitions = previousRepetitions
  let reviewEase = item.reviewEase == null ? 2.5 : item.reviewEase
  let reviewCorrect = item.reviewCorrect || 0
  let reviewTotal = (item.reviewTotal || 0) + 1
  let reviewDueAt

  if (rating === 'again') {
    reviewRepetitions = 0
    interval = 0
    reviewDueAt = new Date(now + 10 * 60 * 1000)
  } else {
    reviewRepetitions = previousRepetitions + 1
    reviewCorrect += 1
    if (rating === 'hard') {
      reviewEase = Math.max(1.3, reviewEase - 0.15)
      interval = previousRepetitions === 0 ? 1 : Math.min(36500, Math.max(interval + 1, Math.round(interval * 1.2)))
    } else {
      interval = previousRepetitions === 0 ? 1
        : previousRepetitions === 1 ? 3
        : Math.min(36500, Math.max(1, Math.round(interval * reviewEase)))
    }
    reviewDueAt = new Date(now + interval * 24 * 60 * 60 * 1000)
  }

  item.reviewRepetitions = reviewRepetitions
  item.reviewTotal = reviewTotal
  item.reviewCorrect = reviewCorrect
  item.reviewEase = reviewEase
  item.reviewInterval = interval
  item.reviewDueAt = reviewDueAt
  item.reviewedAt = new Date(now)
  await entry.save()
  return toEntry(entry)
}

module.exports = {
  init,
  uploadDir,
  dataDir,
  getAll,
  getTrash,
  getById,
  create,
  update,
  toggleFavorite,
  softDelete,
  restore,
  permanentDelete,
  updateVocabularyItem,
  deleteVocabularyItem,
  recordReview,
}
