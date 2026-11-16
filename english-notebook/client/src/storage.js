const DB_NAME = 'littlelingo-notebook'
const DB_VERSION = 1
const STORE = 'entries'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: '_id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function withStore(mode, action) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const store = tx.objectStore(STORE)
    const result = action(store)
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    db.close()
  }))
}

const nowIso = () => new Date().toISOString()

export const storage = {
  async getAll() {
    return withStore('readonly', (store) => new Promise((resolve, reject) => {
      const req = store.getAll()
      req.onsuccess = () => resolve((req.result || []).sort((a, b) =>
        b.entryDate.localeCompare(a.entryDate) || (b.updatedAt || '').localeCompare(a.updatedAt || '')))
      req.onerror = () => reject(req.error)
    }))
  },

  async getTrash() {
    return withStore('readonly', (store) => new Promise((resolve, reject) => {
      const req = store.getAll()
      req.onsuccess = () => resolve((req.result || [])
        .filter((e) => e.deletedAt)
        .sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || '')))
      req.onerror = () => reject(req.error)
    }))
  },

  async getById(id) {
    return withStore('readonly', (store) => new Promise((resolve, reject) => {
      const req = store.get(id)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    }))
  },

  async create(entry) {
    const item = { ...entry, _id: entry._id || crypto.randomUUID(), createdAt: nowIso(), updatedAt: nowIso(), deletedAt: null }
    return withStore('readwrite', (store) => {
      store.add(item)
      return item
    }).then(() => item)
  },

  async update(id, entry) {
    const existing = await storage.getById(id)
    if (!existing) return null
    const item = { ...existing, ...entry, _id: id, updatedAt: nowIso() }
    return withStore('readwrite', (store) => {
      store.put(item)
      return item
    }).then(() => item)
  },

  async toggleFavorite(id, favorite) {
    const existing = await storage.getById(id)
    if (!existing) return null
    const item = { ...existing, favorite: !!favorite, updatedAt: nowIso() }
    return withStore('readwrite', (store) => {
      store.put(item)
      return item
    }).then(() => item)
  },

  async softDelete(id) {
    const existing = await storage.getById(id)
    if (!existing || existing.deletedAt) return null
    const item = { ...existing, deletedAt: nowIso(), updatedAt: nowIso() }
    return withStore('readwrite', (store) => {
      store.put(item)
      return item
    }).then(() => item)
  },

  async restore(id) {
    const existing = await storage.getById(id)
    if (!existing || !existing.deletedAt) return null
    const item = { ...existing, deletedAt: null, updatedAt: nowIso() }
    return withStore('readwrite', (store) => {
      store.put(item)
      return item
    }).then(() => item)
  },

  async permanentDelete(id) {
    const existing = await storage.getById(id)
    if (!existing || !existing.deletedAt) return false
    return withStore('readwrite', (store) => {
      store.delete(id)
      return true
    })
  },

  async updateVocabularyItem(id, index, updates) {
    const existing = await storage.getById(id)
    if (!existing) return null
    const items = existing.vocabulary || []
    if (index < 0 || index >= items.length) return null
    const next = { ...items[index], ...updates }
    items[index] = next
    return storage.update(id, { ...existing, vocabulary: items })
  },

  async deleteVocabularyItem(id, index) {
    const existing = await storage.getById(id)
    if (!existing) return null
    const items = existing.vocabulary || []
    if (index < 0 || index >= items.length) return null
    items.splice(index, 1)
    const entry = await storage.update(id, { ...existing, vocabulary: items })
    return { entry, message: 'Vocabulary item deleted.' }
  },

  async recordReview(id, index, rating) {
    const existing = await storage.getById(id)
    if (!existing) return null
    const items = existing.vocabulary || []
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

    items[index] = {
      ...item,
      reviewRepetitions,
      reviewTotal,
      reviewCorrect,
      reviewEase,
      reviewInterval: interval,
      reviewDueAt: reviewDueAt.toISOString(),
      reviewedAt: now.toISOString(),
    }
    return storage.update(id, { ...existing, vocabulary: items })
  },

  async uploadImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
  },
}
