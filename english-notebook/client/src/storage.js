// Server-backed storage client: sends all operations directly to the Express API
// using VITE_API_URL (when set), same-origin (when served by Express), or
// https://littlelingo-notebook.onrender.com.

const ENV_API = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
const PRODUCTION_API = 'https://littlelingo-notebook.onrender.com'
const API_CANDIDATES = [...new Set([ENV_API, '', PRODUCTION_API].filter((v) => v !== undefined))]

// Render free instances can take ~50s to wake from sleep on cold starts
const REMOTE_TIMEOUT_MS = 55000
const REMOTE_PROBE_TTL_MS = 60 * 1000

let remoteState = { available: false, checkedAt: 0, base: '' }

const fetchWithTimeout = (url, options = {}) => {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Server request timed out')), REMOTE_TIMEOUT_MS)
  })
  return Promise.race([fetch(url, options), timeout]).finally(() => clearTimeout(timer))
}

const probeApi = async (base) => {
  try {
    const response = await fetchWithTimeout(`${base}/api/health`, { method: 'GET', cache: 'no-store' })
    const body = await response.json().catch(() => null)
    // On static hosts (Vercel), /api/health may rewrite to index.html with 200;
    // only accept a genuine API health payload.
    return Boolean(response.ok && body && body.status === 'ok')
  } catch {
    return false
  }
}

const getRemoteBase = async () => {
  const now = Date.now()
  if (now - remoteState.checkedAt < REMOTE_PROBE_TTL_MS && remoteState.available) {
    return remoteState.base
  }
  for (const base of API_CANDIDATES) {
    if (await probeApi(base)) {
      remoteState = { available: true, checkedAt: now, base }
      return base
    }
  }
  remoteState = { available: false, checkedAt: now, base: '' }
  throw new Error('Unable to reach the backend server. Please check that the server is running.')
}

const apiFetch = async (path, { method = 'GET', json } = {}) => {
  const base = await getRemoteBase()
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

const mergingRemoteItem = async (id, index, updates) => {
  const entry = await apiFetch(`/api/entries/${id}`)
  const item = entry.vocabulary?.[index]
  if (!item) throw new Error('Vocabulary item not found.')
  return apiFetch(`/api/entries/${id}/vocabulary/${index}`, {
    method: 'PUT',
    json: { ...item, ...updates },
  })
}

const storage = {
  getAll: () => apiFetch('/api/entries'),
  getTrash: () => apiFetch('/api/entries/trash'),
  getById: (id) => apiFetch(`/api/entries/${id}`),
  create: (entry) => apiFetch('/api/entries', { method: 'POST', json: entry }),
  update: (id, entry) => apiFetch(`/api/entries/${id}`, { method: 'PUT', json: entry }),
  toggleFavorite: (id, favorite) => apiFetch(`/api/entries/${id}/favorite`, {
    method: 'PATCH',
    json: { favorite: Boolean(favorite) },
  }),
  softDelete: async (id) => {
    const result = await apiFetch(`/api/entries/${id}`, { method: 'DELETE' })
    return result?.entry ?? result
  },
  restore: (id) => apiFetch(`/api/entries/${id}/restore`, { method: 'PATCH' }),
  permanentDelete: async (id) => {
    await apiFetch(`/api/entries/${id}/permanent`, { method: 'DELETE' })
    return true
  },
  updateVocabularyItem: (id, index, updates) => mergingRemoteItem(id, index, updates),
  deleteVocabularyItem: async (id, index) => {
    const entry = await apiFetch(`/api/entries/${id}/vocabulary/${index}`, { method: 'DELETE' })
    return { entry, message: 'Vocabulary item deleted.' }
  },
  recordReview: (id, index, rating) => apiFetch(`/api/entries/${id}/vocabulary/${index}/review`, {
    method: 'POST',
    json: { rating },
  }),
  uploadImage: async (file) => {
    const base = await getRemoteBase()
    const form = new FormData()
    form.append('image', file)
    const response = await fetchWithTimeout(`${base}/api/uploads`, { method: 'POST', body: form })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body?.message || 'Image upload failed.')
    }
    const result = await response.json()
    return `${base}${result.url}`
  },
}

export { storage }