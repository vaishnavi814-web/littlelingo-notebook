const initSqlJs = require('sql.js').default
const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

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

// DATA_DIR lets hosted deployments (e.g. a Render persistent disk) keep the
// database and uploads outside the ephemeral app directory.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(appRoot, 'data')
fs.mkdirSync(dataDir, { recursive: true })

const uploadDir = path.join(dataDir, 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })

const DB_PATH = path.join(dataDir, 'notebook.db')
let db
let initialized = false

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    content TEXT DEFAULT '',
    favorite INTEGER DEFAULT 0,
    tags TEXT DEFAULT '[]',
    difficulty TEXT DEFAULT '',
    learning_goal TEXT DEFAULT '',
    deleted_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vocabulary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    item_index INTEGER NOT NULL,
    word TEXT NOT NULL,
    meaning TEXT NOT NULL,
    example TEXT DEFAULT '',
    examples TEXT DEFAULT '[]',
    phonetic TEXT DEFAULT '',
    part_of_speech TEXT DEFAULT '',
    synonyms TEXT DEFAULT '[]',
    antonyms TEXT DEFAULT '[]',
    category TEXT DEFAULT 'word',
    favorite INTEGER DEFAULT 0,
    tags TEXT DEFAULT '[]',
    difficulty TEXT DEFAULT '',
    learning_goal TEXT DEFAULT '',
    review_due_at TEXT DEFAULT NULL,
    review_interval INTEGER DEFAULT 0,
    review_repetitions INTEGER DEFAULT 0,
    review_ease REAL DEFAULT 2.5,
    reviewed_at TEXT DEFAULT NULL,
    review_total INTEGER DEFAULT 0,
    review_correct INTEGER DEFAULT 0
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_vocab_entry ON vocabulary(entry_id, item_index);
`

const nowIso = () => new Date().toISOString()
const bool = (value) => value === 1 || value === true
const json = (value) => {
  try { return JSON.parse(value || '[]') } catch { return [] }
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql)
  if (params.length) stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

function queryRow(sql, params = []) {
  const stmt = db.prepare(sql)
  if (params.length) stmt.bind(params)
  let row = null
  if (stmt.step()) row = stmt.getAsObject()
  stmt.free()
  return row
}

function persist() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()))
}

const toEntry = (row, items) => ({
  _id: row.id,
  title: row.title,
  entryDate: row.entry_date,
  content: row.content,
  favorite: bool(row.favorite),
  tags: json(row.tags),
  difficulty: row.difficulty || '',
  learningGoal: row.learning_goal || '',
  deletedAt: row.deleted_at || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  vocabulary: items.map((item) => ({
    word: item.word,
    meaning: item.meaning,
    example: item.example || '',
    examples: json(item.examples),
    phonetic: item.phonetic || '',
    partOfSpeech: item.part_of_speech || '',
    synonyms: json(item.synonyms),
    antonyms: json(item.antonyms),
    category: item.category || 'word',
    favorite: bool(item.favorite),
    tags: json(item.tags),
    difficulty: item.difficulty || '',
    learningGoal: item.learning_goal || '',
    reviewDueAt: item.review_due_at || null,
    reviewInterval: item.review_interval || 0,
    reviewRepetitions: item.review_repetitions || 0,
    reviewEase: item.review_ease == null ? 2.5 : item.review_ease,
    reviewedAt: item.reviewed_at || null,
    reviewTotal: item.review_total || 0,
    reviewCorrect: item.review_correct || 0,
  })),
})

const getItems = (entryId) => queryAll(
  'SELECT * FROM vocabulary WHERE entry_id = ? ORDER BY item_index ASC',
  [entryId]
)

async function init() {
  if (initialized) return
  const sql = await initSqlJs()
  if (fs.existsSync(DB_PATH)) {
    db = new sql.Database(fs.readFileSync(DB_PATH))
  } else {
    db = new sql.Database()
  }
  db.exec(SCHEMA)
  persist()
  initialized = true
}

const getAll = () => {
  const rows = queryAll(
    'SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY entry_date DESC, updated_at DESC'
  )
  return rows.map((row) => toEntry(row, getItems(row.id)))
}

const getTrash = () => {
  const rows = queryAll(
    'SELECT * FROM entries WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
  )
  return rows.map((row) => toEntry(row, getItems(row.id)))
}

const getById = (id) => {
  const row = queryRow('SELECT * FROM entries WHERE id = ?', [id])
  if (!row) return null
  return toEntry(row, getItems(row.id))
}

const INSERT_ENTRY = `INSERT INTO entries (id, title, entry_date, content, favorite, tags, difficulty, learning_goal, deleted_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
const INSERT_ITEM = `INSERT INTO vocabulary (entry_id, item_index, word, meaning, example, examples, phonetic, part_of_speech, synonyms, antonyms, category, favorite, tags, difficulty, learning_goal, review_due_at, review_interval, review_repetitions, review_ease, reviewed_at, review_total, review_correct)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const create = (value) => {
  const id = randomUUID()
  const now = nowIso()
  db.run(INSERT_ENTRY, [
    id, value.title, value.entryDate, value.content, value.favorite ? 1 : 0,
    JSON.stringify(value.tags || []), value.difficulty, value.learningGoal, now, now,
  ])
  value.vocabulary.forEach((item, index) => {
    db.run(INSERT_ITEM, [
      id, index, item.word, item.meaning, item.example || '',
      JSON.stringify(item.examples || []), item.phonetic || '', item.partOfSpeech || '',
      JSON.stringify(item.synonyms || []), JSON.stringify(item.antonyms || []),
      item.category || 'word', item.favorite ? 1 : 0, JSON.stringify(item.tags || []),
      item.difficulty || '', item.learningGoal || '',
      item.reviewDueAt || null, item.reviewInterval || 0, item.reviewRepetitions || 0,
      item.reviewEase == null ? 2.5 : item.reviewEase,
      item.reviewedAt || null, item.reviewTotal || 0, item.reviewCorrect || 0,
    ])
  })
  persist()
  return getById(id)
}

const UPDATE_ENTRY = `UPDATE entries SET title = ?, entry_date = ?, content = ?, favorite = ?, tags = ?, difficulty = ?, learning_goal = ?, updated_at = ? WHERE id = ?`
const UPSERT_ITEM = `INSERT INTO vocabulary (entry_id, item_index, word, meaning, example, examples, phonetic, part_of_speech, synonyms, antonyms, category, favorite, tags, difficulty, learning_goal, review_due_at, review_interval, review_repetitions, review_ease, reviewed_at, review_total, review_correct)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(entry_id, item_index) DO UPDATE SET
    word = excluded.word, meaning = excluded.meaning, example = excluded.example,
    examples = excluded.examples, phonetic = excluded.phonetic,
    part_of_speech = excluded.part_of_speech, synonyms = excluded.synonyms,
    antonyms = excluded.antonyms, category = excluded.category, favorite = excluded.favorite,
    tags = excluded.tags, difficulty = excluded.difficulty, learning_goal = excluded.learning_goal,
    review_due_at = excluded.review_due_at, review_interval = excluded.review_interval,
    review_repetitions = excluded.review_repetitions, review_ease = excluded.review_ease,
    reviewed_at = excluded.reviewed_at, review_total = excluded.review_total,
    review_correct = excluded.review_correct`

const update = (id, value) => {
  const row = queryRow('SELECT * FROM entries WHERE id = ?', [id])
  if (!row) return null
  const now = nowIso()
  db.run(UPDATE_ENTRY, [
    value.title, value.entryDate, value.content, value.favorite ? 1 : 0,
    JSON.stringify(value.tags || []), value.difficulty, value.learningGoal, now, id,
  ])
  value.vocabulary.forEach((item, index) => {
    db.run(UPSERT_ITEM, [
      id, index, item.word, item.meaning, item.example || '',
      JSON.stringify(item.examples || []), item.phonetic || '', item.partOfSpeech || '',
      JSON.stringify(item.synonyms || []), JSON.stringify(item.antonyms || []),
      item.category || 'word', item.favorite ? 1 : 0, JSON.stringify(item.tags || []),
      item.difficulty || '', item.learningGoal || '',
      item.reviewDueAt || null, item.reviewInterval || 0, item.reviewRepetitions || 0,
      item.reviewEase == null ? 2.5 : item.reviewEase,
      item.reviewedAt || null, item.reviewTotal || 0, item.reviewCorrect || 0,
    ])
  })
  persist()
  return getById(id)
}

const toggleFavorite = (id, favorite) => {
  const row = queryRow('SELECT * FROM entries WHERE id = ?', [id])
  if (!row) return null
  db.run('UPDATE entries SET favorite = ?, updated_at = ? WHERE id = ?',
    [favorite ? 1 : 0, nowIso(), id])
  persist()
  return getById(id)
}

const softDelete = (id) => {
  const row = queryRow('SELECT * FROM entries WHERE id = ?', [id])
  if (!row || row.deleted_at != null) return null
  db.run('UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ?',
    [nowIso(), nowIso(), id])
  persist()
  return getById(id)
}

const restore = (id) => {
  const row = queryRow('SELECT * FROM entries WHERE id = ?', [id])
  if (!row || row.deleted_at == null) return null
  db.run('UPDATE entries SET deleted_at = NULL, updated_at = ? WHERE id = ?',
    [nowIso(), id])
  persist()
  return getById(id)
}

const permanentDelete = (id) => {
  const row = queryRow('SELECT * FROM entries WHERE id = ?', [id])
  if (!row || row.deleted_at == null) return false
  db.run('DELETE FROM entries WHERE id = ?', [id])
  persist()
  return true
}

const updateVocabularyItem = (id, index, value) => {
  const row = queryRow('SELECT * FROM entries WHERE id = ?', [id])
  if (!row) return null
  const items = getItems(row.id)
  if (index < 0 || index >= items.length) return null
  const existing = items[index]
  const next = {
    ...existing,
    ...value,
    examples: value.examples ?? existing.examples,
    synonyms: value.synonyms ?? existing.synonyms,
    antonyms: value.antonyms ?? existing.antonyms,
    tags: value.tags ?? existing.tags,
  }
  db.run(
    `UPDATE vocabulary SET
      word = ?, meaning = ?, example = ?, examples = ?, phonetic = ?, part_of_speech = ?,
      synonyms = ?, antonyms = ?, category = ?, favorite = ?, tags = ?, difficulty = ?,
      learning_goal = ?, review_due_at = ?, review_interval = ?, review_repetitions = ?,
      review_ease = ?, reviewed_at = ?, review_total = ?, review_correct = ?
     WHERE entry_id = ? AND item_index = ?`,
    [
      next.word, next.meaning, next.example || '', JSON.stringify(next.examples || []),
      next.phonetic || '', next.partOfSpeech || '',
      JSON.stringify(next.synonyms || []), JSON.stringify(next.antonyms || []),
      next.category || 'word', next.favorite ? 1 : 0, JSON.stringify(next.tags || []),
      next.difficulty || '', next.learningGoal || '',
      next.reviewDueAt || null, next.reviewInterval || 0, next.reviewRepetitions || 0,
      next.reviewEase == null ? 2.5 : next.reviewEase, next.reviewedAt || null,
      next.reviewTotal || 0, next.reviewCorrect || 0, id, index,
    ]
  )
  persist()
  return getById(id)
}

const deleteVocabularyItem = (id, index) => {
  const row = queryRow('SELECT * FROM entries WHERE id = ?', [id])
  if (!row) return null
  const items = getItems(row.id)
  if (index < 0 || index >= items.length) return null
  db.run('DELETE FROM vocabulary WHERE entry_id = ? AND item_index = ?', [id, index])
  db.run('UPDATE vocabulary SET item_index = item_index - 1 WHERE entry_id = ? AND item_index > ?', [id, index])
  persist()
  return { entry: getById(id), message: 'Vocabulary item deleted.' }
}

const recordReview = (id, index, rating) => {
  const row = queryRow('SELECT * FROM entries WHERE id = ?', [id])
  if (!row) return null
  const items = getItems(row.id)
  if (index < 0 || index >= items.length) return null
  const item = items[index]
  const now = new Date()
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
    reviewDueAt = new Date(now.getTime() + 10 * 60 * 1000)
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
    reviewDueAt = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000)
  }

  db.run(
    `UPDATE vocabulary SET
      review_repetitions = ?, review_total = ?, review_correct = ?, review_ease = ?,
      review_interval = ?, review_due_at = ?, reviewed_at = ?
     WHERE entry_id = ? AND item_index = ?`,
    [
      reviewRepetitions, reviewTotal, reviewCorrect, reviewEase,
      interval, reviewDueAt.toISOString(), now.toISOString(), id, index,
    ]
  )
  persist()
  return getById(id)
}

const syncApi = {
  init,
  db,
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
const asyncWrap = (fn) => async (...args) => fn(...args)
module.exports = Object.fromEntries(Object.entries(syncApi).map(([key, value]) => [
  key,
  typeof value === 'function' ? asyncWrap(value) : value,
]))
