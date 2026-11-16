const express = require('express')
const {
  getAll, getTrash, getById, create, update, toggleFavorite,
  softDelete, restore, permanentDelete, updateVocabularyItem,
  deleteVocabularyItem, recordReview,
} = require('../store')

const router = express.Router()
const vocabularyCategories = new Set([
  'word', 'sentence', 'phrase', 'phrasal-verb', 'idiom', 'collocation', 'expression',
])
const difficulties = new Set(['', 'beginner', 'intermediate', 'advanced'])
const isValidId = (id) => typeof id === 'string' && id.length > 0
const parseStringList = (value, { maximumItems, maximumLength }) => {
  if (value === undefined) return { value: [] }
  if (!Array.isArray(value) || value.length > maximumItems || value.some((item) => typeof item !== 'string' || item.trim().length > maximumLength)) {
    return { error: 'A tag or vocabulary detail list is invalid.' }
  }
  return { value: [...new Set(value.map((item) => item.trim()).filter(Boolean))] }
}

const parseEntry = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Page data must be a JSON object.' }
  }
  const { title, entryDate, content = '', vocabulary = [], favorite = false, tags = [], difficulty = '', learningGoal = '' } = body
  if (typeof title !== 'string' || !title.trim()) return { error: 'A page title is required.' }
  if (typeof entryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    return { error: 'Enter a valid page date.' }
  }
  const parsedDate = new Date(`${entryDate}T00:00:00.000Z`)
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== entryDate) {
    return { error: 'Enter a valid page date.' }
  }
  if (typeof content !== 'string') return { error: 'Page content must be text.' }
  if (typeof favorite !== 'boolean') return { error: 'Favorite must be true or false.' }
  if (!difficulties.has(difficulty)) return { error: 'Choose a valid difficulty.' }
  if (typeof learningGoal !== 'string' || learningGoal.trim().length > 100) return { error: 'Learning goal must be under 100 characters.' }
  const parsedTags = parseStringList(tags, { maximumItems: 20, maximumLength: 30 })
  if (parsedTags.error) return parsedTags
  if (!Array.isArray(vocabulary)) return { error: 'Vocabulary must be a list.' }
  if (vocabulary.some((item) => (
    !item
    || typeof item.word !== 'string'
    || typeof item.meaning !== 'string'
    || (item.example !== undefined && typeof item.example !== 'string')
  ))) {
    return { error: 'Each vocabulary item needs a word and meaning.' }
  }
  if (vocabulary.some((item) => item.category !== undefined && !vocabularyCategories.has(item.category))) {
    return { error: 'Choose a valid vocabulary category.' }
  }
  if (vocabulary.some((item) => (
    (item.phonetic !== undefined && (typeof item.phonetic !== 'string' || item.phonetic.length > 80))
    || (item.partOfSpeech !== undefined && (typeof item.partOfSpeech !== 'string' || item.partOfSpeech.length > 40))
    || (item.learningGoal !== undefined && (typeof item.learningGoal !== 'string' || item.learningGoal.trim().length > 100))
    || (item.favorite !== undefined && typeof item.favorite !== 'boolean')
    || (item.difficulty !== undefined && !difficulties.has(item.difficulty))
  ))) return { error: 'A vocabulary detail is invalid.' }
  const parsedVocabularyLists = vocabulary.map((item) => ({
    examples: parseStringList(item.examples, { maximumItems: 20, maximumLength: 500 }),
    synonyms: parseStringList(item.synonyms, { maximumItems: 30, maximumLength: 100 }),
    antonyms: parseStringList(item.antonyms, { maximumItems: 30, maximumLength: 100 }),
    tags: parseStringList(item.tags, { maximumItems: 20, maximumLength: 30 }),
  }))
  if (parsedVocabularyLists.some((lists) => lists.examples.error || lists.synonyms.error || lists.antonyms.error || lists.tags.error)) {
    return { error: 'A vocabulary detail list is invalid.' }
  }
  if (vocabulary.some((item) => (
    (item.reviewDueAt !== undefined && (typeof item.reviewDueAt !== 'string' || Number.isNaN(new Date(item.reviewDueAt).getTime())))
    || (item.reviewedAt != null && (typeof item.reviewedAt !== 'string' || Number.isNaN(new Date(item.reviewedAt).getTime())))
    || (item.reviewInterval !== undefined && (!Number.isSafeInteger(item.reviewInterval) || item.reviewInterval < 0 || item.reviewInterval > 36500))
    || (item.reviewRepetitions !== undefined && (!Number.isSafeInteger(item.reviewRepetitions) || item.reviewRepetitions < 0 || item.reviewRepetitions > 100000))
    || (item.reviewEase !== undefined && (!Number.isFinite(item.reviewEase) || item.reviewEase < 1.3 || item.reviewEase > 5))
  ))) {
    return { error: 'A vocabulary review schedule is invalid.' }
  }
  return {
    value: {
      title: title.trim(),
      entryDate,
      content,
      favorite,
      tags: parsedTags.value,
      difficulty,
      learningGoal: learningGoal.trim(),
      vocabulary: vocabulary.map((item, index) => ({
        word: item.word,
        meaning: item.meaning,
        example: item.example || '',
        examples: parsedVocabularyLists[index].examples.value,
        phonetic: item.phonetic || '',
        partOfSpeech: item.partOfSpeech || '',
        synonyms: parsedVocabularyLists[index].synonyms.value,
        antonyms: parsedVocabularyLists[index].antonyms.value,
        category: item.category || 'word',
        favorite: item.favorite === true,
        tags: parsedVocabularyLists[index].tags.value,
        difficulty: item.difficulty || '',
        learningGoal: item.learningGoal?.trim() || '',
        ...(item.reviewDueAt !== undefined ? { reviewDueAt: item.reviewDueAt } : {}),
        ...(item.reviewInterval !== undefined ? { reviewInterval: item.reviewInterval } : {}),
        ...(item.reviewRepetitions !== undefined ? { reviewRepetitions: item.reviewRepetitions } : {}),
        ...(item.reviewEase !== undefined ? { reviewEase: item.reviewEase } : {}),
        ...(item.reviewedAt !== undefined ? { reviewedAt: item.reviewedAt } : {}),
        ...(item.reviewTotal !== undefined ? { reviewTotal: item.reviewTotal } : {}),
        ...(item.reviewCorrect !== undefined ? { reviewCorrect: item.reviewCorrect } : {}),
      })),
    },
  }
}

const parseVocabularyItem = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Item data must be a JSON object.' }
  }
  const { word, meaning, example = '', examples, phonetic = '', partOfSpeech = '', synonyms, antonyms, favorite = false, tags, difficulty = '', learningGoal = '', category = 'word' } = body
  if (typeof word !== 'string' || !word.trim()) return { error: 'Enter a word or phrase.' }
  if (typeof meaning !== 'string' || !meaning.trim()) return { error: 'Enter a meaning.' }
  if (typeof example !== 'string') return { error: 'The example must be text.' }
  if (typeof category !== 'string' || !vocabularyCategories.has(category)) {
    return { error: 'Choose a valid vocabulary category.' }
  }
  if (typeof favorite !== 'boolean') return { error: 'Favorite must be true or false.' }
  if (typeof phonetic !== 'string' || phonetic.length > 80) return { error: 'Phonetics must be under 80 characters.' }
  if (typeof partOfSpeech !== 'string' || partOfSpeech.length > 40) return { error: 'Part of speech must be under 40 characters.' }
  if (!difficulties.has(difficulty)) return { error: 'Choose a valid difficulty.' }
  if (typeof learningGoal !== 'string' || learningGoal.trim().length > 100) return { error: 'Learning goal must be under 100 characters.' }
  const lists = {
    examples: parseStringList(examples === undefined ? (example ? [example] : []) : examples, { maximumItems: 20, maximumLength: 500 }),
    synonyms: parseStringList(synonyms, { maximumItems: 30, maximumLength: 100 }),
    antonyms: parseStringList(antonyms, { maximumItems: 30, maximumLength: 100 }),
    tags: parseStringList(tags, { maximumItems: 20, maximumLength: 30 }),
  }
  if (Object.values(lists).some((list) => list.error)) return { error: 'A vocabulary detail list is invalid.' }
  return {
    value: {
      word: word.trim(),
      meaning: meaning.trim(),
      example: (lists.examples.value[0] || '').trim(),
      examples: lists.examples.value,
      phonetic: phonetic.trim(),
      partOfSpeech: partOfSpeech.trim(),
      synonyms: lists.synonyms.value,
      antonyms: lists.antonyms.value,
      favorite,
      tags: lists.tags.value,
      difficulty,
      learningGoal: learningGoal.trim(),
      category,
    },
  }
}

const parseVocabularyIndex = (value) => {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null
  const index = Number(value)
  return Number.isSafeInteger(index) ? index : null
}

router.get('/trash', (req, res, next) => {
  try {
    res.json(getTrash())
  } catch (error) { next(error) }
})

router.get('/', (req, res, next) => {
  try {
    res.json(getAll())
  } catch (error) { next(error) }
})

router.patch('/:id/favorite', (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid page ID.' })
  if (typeof req.body?.favorite !== 'boolean') return res.status(400).json({ message: 'Favorite must be true or false.' })
  try {
    const entry = toggleFavorite(req.params.id, req.body.favorite)
    if (!entry) return res.status(404).json({ message: 'Page not found.' })
    res.json(entry)
  } catch (error) { next(error) }
})

router.patch('/:id/vocabulary/:index/favorite', (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid page ID.' })
  const index = parseVocabularyIndex(req.params.index)
  if (index === null) return res.status(400).json({ message: 'Invalid vocabulary item index.' })
  if (typeof req.body?.favorite !== 'boolean') return res.status(400).json({ message: 'Favorite must be true or false.' })
  try {
    const entry = updateVocabularyItem(req.params.id, index, { favorite: req.body.favorite })
    if (!entry) return res.status(404).json({ message: 'Page not found.' })
    res.json(entry)
  } catch (error) { next(error) }
})

router.patch('/:id/restore', (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid page ID.' })
  try {
    const entry = restore(req.params.id)
    if (!entry) return res.status(404).json({ message: 'Deleted page not found.' })
    res.json(entry)
  } catch (error) { next(error) }
})

router.delete('/:id/permanent', (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid page ID.' })
  try {
    const ok = permanentDelete(req.params.id)
    if (!ok) return res.status(404).json({ message: 'Deleted page not found.' })
    res.json({ message: 'Page permanently deleted.' })
  } catch (error) { next(error) }
})

router.post('/', (req, res, next) => {
  const parsed = parseEntry(req.body)
  if (parsed.error) return res.status(400).json({ message: parsed.error })
  try {
    const entry = create(parsed.value)
    res.status(201).json(entry)
  } catch (error) { next(error) }
})

router.put('/:id/vocabulary/:index', (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid page ID.' })
  const index = parseVocabularyIndex(req.params.index)
  if (index === null) return res.status(400).json({ message: 'Invalid vocabulary item index.' })
  const parsed = parseVocabularyItem(req.body)
  if (parsed.error) return res.status(400).json({ message: parsed.error })
  try {
    const entry = updateVocabularyItem(req.params.id, index, parsed.value)
    if (!entry) return res.status(404).json({ message: 'Page not found.' })
    res.json(entry)
  } catch (error) { next(error) }
})

router.post('/:id/vocabulary/:index/review', (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid page ID.' })
  const index = parseVocabularyIndex(req.params.index)
  if (index === null) return res.status(400).json({ message: 'Invalid vocabulary item index.' })
  const { rating } = req.body || {}
  if (!['again', 'hard', 'remembered'].includes(rating)) {
    return res.status(400).json({ message: 'Choose Again, Hard, or Remembered.' })
  }
  try {
    const entry = recordReview(req.params.id, index, rating)
    if (!entry) return res.status(404).json({ message: 'Page not found.' })
    res.json(entry)
  } catch (error) { next(error) }
})

router.delete('/:id/vocabulary/:index', (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid page ID.' })
  const index = parseVocabularyIndex(req.params.index)
  if (index === null) return res.status(400).json({ message: 'Invalid vocabulary item index.' })
  try {
    const result = deleteVocabularyItem(req.params.id, index)
    if (!result) return res.status(404).json({ message: 'Page not found.' })
    res.json(result)
  } catch (error) { next(error) }
})

router.get('/:id', (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid page ID.' })
  try {
    const entry = getById(req.params.id)
    if (!entry || entry.deletedAt != null) return res.status(404).json({ message: 'Page not found.' })
    res.json(entry)
  } catch (error) { next(error) }
})

router.put('/:id', (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid page ID.' })
  const parsed = parseEntry(req.body)
  if (parsed.error) return res.status(400).json({ message: parsed.error })
  try {
    const entry = update(req.params.id, parsed.value)
    if (!entry) return res.status(404).json({ message: 'Page not found.' })
    res.json(entry)
  } catch (error) { next(error) }
})

router.delete('/:id', (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid page ID.' })
  try {
    const entry = softDelete(req.params.id)
    if (!entry) return res.status(404).json({ message: 'Page not found.' })
    res.json({ entry, message: 'Page moved to the recycle bin.' })
  } catch (error) { next(error) }
})

module.exports = router
