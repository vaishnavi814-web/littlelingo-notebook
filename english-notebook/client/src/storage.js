// Hybrid storage:
//  - talks to the Express API (/api/entries) when it is reachable (desktop served by the server, or any host via VITE_API_URL)
//  - falls back to the browser's IndexedDB when it is not (offline desktop / preview builds)

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
const local = {
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
    const existing = await local.getById(id)
    if (!existing) return null
    const item = { ...existing, ...entry, _id: id, updatedAt: nowIso() }
    return withStore('readwrite', (store) => {
      store.put(item)
      return item
    }).then(() => item)
  },

  async toggleFavorite(id, favorite) {
    const existing = await local.getById(id)
    if (!existing) return null
    const item = { ...existing, favorite: !!favorite, updatedAt: nowIso() }
    return withStore('readwrite', (store) => {
      store.put(item)
      return item
    }).then(() => item)
  },

  async softDelete(id) {
    const existing = await local.getById(id)
    if (!existing || existing.deletedAt) return null
    const item = { ...existing, deletedAt: nowIso(), updatedAt: nowIso() }
    return withStore('readwrite', (store) => {
      store.put(item)
      return item
    }).then(() => item)
  },

  async restore(id) {
    const existing = await local.getById(id)
    if (!existing || !existing.deletedAt) return null
    const item = { ...existing, deletedAt: null, updatedAt: nowIso() }
    return withStore('readwrite', (store) => {
      store.put(item)
      return item
    }).then(() => item)
  },

  async permanentDelete(id) {
    const existing = await local.getById(id)
    if (!existing || !existing.deletedAt) return false
    return withStore('readwrite', (store) => {
      store.delete(id)
      return true
    })
  },

  async updateVocabularyItem(id, index, updates) {
    const existing = await local.getById(id)
    if (!existing) return null
    const items = existing.vocabulary || []
    if (index < 0 || index >= items.length) return null
    items[index] = { ...items[index], ...updates }
    return local.update(id, { ...existing, vocabulary: items })
  },

  async deleteVocabularyItem(id, index) {
    const existing = await local.getById(id)
    if (!existing) return null
    const items = existing.vocabulary || []
    if (index < 0 || index >= items.length) return null
    items.splice(index, 1)
    const entry = await local.update(id, { ...existing, vocabulary: items })
    return { entry, message: 'Vocabulary item deleted.' }
  },

  async recordReview(id, index, rating) {
    const existing = await local.getById(id)
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
    return local.update(id, { ...existing, vocabulary: items })
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

// API resolution order:
//   1. VITE_API_URL (if set in .env)
//   2. same-origin (used when the UI is served by the Express server, e.g. Electron/local dev)
//   3. the production Render service (fallback for static hosts like Vercel)
const ENV_API = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
const PRODUCTION_API = 'https://littlelingo-5lfy.onrender.com'
const API_CANDIDATES = [...new Set([ENV_API, '', PRODUCTION_API])]
const REMOTE_TIMEOUT_MS = 2500
const REMOTE_PROBE_TTL_MS = 60 * 1000 // re-probe after 60s so cold starts recover

let remoteState = { available: false, checkedAt: 0, base: '' }

const fetchWithTimeout = (url, options = {}) => {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Request timed out')), REMOTE_TIMEOUT_MS)
  })
  return Promise.race([fetch(url, options), timeout]).finally(() => clearTimeout(timer))
}

const getRemoteBase = async () => {
  const now = Date.now()
  if (now - remoteState.checkedAt < REMOTE_PROBE_TTL_MS) {
    return remoteState.available ? remoteState.base : null
  }
  for (const base of API_CANDIDATES) {
    if (await probeApi(base)) {
      remoteState = { available: true, checkedAt: now, base }
      return base
    }
  }
  remoteState = { available: false, checkedAt: now, base: '' }
  return null
}

const probeApi = async (base) => {
  try {
    const response = await fetchWithTimeout(`${base}/api/health`, { method: 'GET', cache: 'no-store' })
    const body = await response.json().catch(() => null)
    // On static hosts (Vercel), /api/health is rewritten to index.html with status 200.
    // Only trust it when the API returns the JSON shape we built.
    return Boolean(response.ok && body && body.status === 'ok')
  } catch {
    return false
  }
}

const apiFetch = async (path, { method = 'GET', json } = {}) => {
  const base = await getRemoteBase()
  if (!base) throw new Error('API unavailable')
  const options = { method, headers: {} }
  if (json !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(json)
  }
  const response = await fetchWithTimeout(`${base}${path}`, options)
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      if (body?.message) detail = body.message
    } catch { /* ignore non-JSON error bodies */ }
    throw new Error(`Request failed (${response.status}): ${detail}`)
  }
  return response.status === 204 ? null : response.json()
}

// Wrap a remote call with fallback to the local implementation.
const remoteOrLocal = (localFn, remoteFn) => async (...args) => {
  try {
    const base = await getRemoteBase()
    if (base === null) return localFn(...args)
    return await remoteFn(base, ...args)
  } catch (error) {
    console.warn('Online notebook unavailable — using offline storage.', error?.message)
    return localFn(...args)
  }
}

const mergingRemoteItem = async (_base, id, index, updates) => {
  const entry = await apiFetch(`/api/entries/${id}`)
  const item = entry.vocabulary?.[index]
  if (!item) throw new Error('Vocabulary item not found.')
  return apiFetch(`/api/entries/${id}/vocabulary/${index}`, {
    method: 'PUT',
    json: { ...item, ...updates },
  })
}

const storage = {
  getAll: remoteOrLocal(local.getAll, (_base) => apiFetch('/api/entries')),
  getTrash: remoteOrLocal(local.getTrash, (_base) => apiFetch('/api/entries/trash')),
  getById: remoteOrLocal(local.getById, (_base, id) => apiFetch(`/api/entries/${id}`)),
  create: remoteOrLocal(local.create, (_base, entry) => apiFetch('/api/entries', { method: 'POST', json: entry })),
  update: remoteOrLocal(local.update, (_base, id, entry) => apiFetch(`/api/entries/${id}`, { method: 'PUT', json: entry })),
  toggleFavorite: remoteOrLocal(local.toggleFavorite, (_base, id, favorite) => apiFetch(`/api/entries/${id}/favorite`, { method: 'PATCH', json: { favorite: Boolean(favorite) } })),
  softDelete: remoteOrLocal(local.softDelete, async (_base, id) => { const result = await apiFetch(`/api/entries/${id}`, { method: 'DELETE' }); return result?.entry ?? result }),
  restore: remoteOrLocal(local.restore, (_base, id) => apiFetch(`/api/entries/${id}/restore`, { method: 'PATCH' })),
  permanentDelete: remoteOrLocal(local.permanentDelete, async (_base, id) => { await apiFetch(`/api/entries/${id}/permanent`, { method: 'DELETE' }); return true }),
  updateVocabularyItem: remoteOrLocal(local.updateVocabularyItem, mergingRemoteItem),
  deleteVocabularyItem: remoteOrLocal(local.deleteVocabularyItem, async (_base, id, index) => {
    const entry = await apiFetch(`/api/entries/${id}/vocabulary/${index}`, { method: 'DELETE' })
    return { entry, message: 'Vocabulary item deleted.' }
  }),
  recordReview: remoteOrLocal(local.recordReview, (_base, id, index, rating) => apiFetch(`/api/entries/${id}/vocabulary/${index}/review`, { method: 'POST', json: { rating } })),
  uploadImage: remoteOrLocal(local.uploadImage, async (base, file) => {
    const form = new FormData()
    form.append('image', file)
    const response = await fetchWithTimeout(`${base}/api/uploads`, { method: 'POST', body: form })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body?.message || 'Image upload failed.')
    }
    const result = await response.json()
    return `${base}${result.url}`
  }),
}

export { storage }
