import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { grammarLessons, grammarLevels } from './grammarLessons'
import { extractSubtitleText, loadGeneratedLessons } from './lessonSources'
import { storage } from './storage'

const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const today = () => dateKey(new Date())
const initialCalendarMonth = new Date()
const hasLocalDraft = () => {
  try {
    return Boolean(localStorage.getItem('littlelingo-draft'))
  } catch {
    return false
  }
}
const loadGrammarProgress = () => {
  try {
    const stored = JSON.parse(localStorage.getItem('littlelingo-grammar-progress') || '{}')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(Object.entries(stored)
      .filter(([id, result]) => (grammarLessons.some((lesson) => lesson.id === id) || id.startsWith('generated-') || id.startsWith('custom-'))
        && result && typeof result === 'object' && !Array.isArray(result))
      .map(([id, result]) => [id, {
        attempts: Number.isInteger(result.attempts) && result.attempts >= 0 ? result.attempts : 0,
        bestScore: result.bestScore === 1 ? 1 : 0,
        completed: result.completed === true,
      }]))
  } catch {
    return {}
  }
}

const emptyEntry = () => ({
  title: '',
  entryDate: today(),
  content: '',
  favorite: false,
  tags: [],
  difficulty: '',
  learningGoal: '',
  vocabulary: [],
})
const emptyVocabularyForm = (category = 'word') => ({
  word: '', meaning: '', example: '', examplesText: '', phonetic: '', partOfSpeech: '',
  synonymsText: '', antonymsText: '', category, favorite: false, tagsText: '',
  difficulty: '', learningGoal: '',
  // Category-specific details
  verb: '', particle: '', separable: '', register: '', literalMeaning: '',
  collocatesText: '', collocationType: '', usageNote: '', origin: '',
  context: '', translation: '',
})
const splitList = (value) => value.split(',').map((item) => item.trim()).filter(Boolean)
const splitLines = (value) => value.split('\n').map((item) => item.trim()).filter(Boolean)
const createCustomLessonId = () => `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const nowIso = () => new Date().toISOString()
const quizOptionKeys = ['optionA', 'optionB', 'optionC', 'optionD']
const quizOptionLetters = ['A', 'B', 'C', 'D']
const emptyCustomLesson = () => ({
  title: '',
  date: today(),
  level: 'Beginner',
  summary: '',
  explanation: '',
  examplesText: '',
  mistakesText: '',
  questionPrompt: '',
  optionA: '',
  optionB: '',
  optionC: '',
  optionD: '',
  correctOption: '',
  questionExplanation: '',
})
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const createSentenceQuizCards = (cards, entries) => {
  const choices = [...new Map(entries.flatMap((entry) => entry.vocabulary || [])
    .map((item) => [item.word.trim().toLocaleLowerCase(), item.word.trim()])
    .filter(([normalized]) => normalized)).values()]
    .sort((a, b) => a.localeCompare(b))

  return cards.flatMap((card) => {
    const word = card.item.word.trim()
    if (!word) return []
    const wordPattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escapeRegExp(word)})(?=$|[^\\p{L}\\p{N}_])`, 'iu')
    const examples = card.item.examples?.length ? card.item.examples : card.item.example ? [card.item.example] : []
    const example = examples.find((sentence) => wordPattern.test(sentence))
    if (!example) return []

    const distractors = choices.filter((choice) => choice.toLocaleLowerCase() !== word.toLocaleLowerCase())
    const distractorStart = distractors.length ? card.itemIndex % distractors.length : 0
    const rotatedDistractors = [...distractors.slice(distractorStart), ...distractors.slice(0, distractorStart)]
    const selectedDistractors = rotatedDistractors.slice(0, 3)
    const options = [...selectedDistractors]
    options.splice((card.itemIndex + examples.indexOf(example)) % (options.length + 1), 0, word)

    return [{
      ...card,
      sentence: example.replace(wordPattern, (_, prefix) => `${prefix}_____`),
      options,
    }]
  })
}

const downloadFile = (name, content, type) => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const formatTags = (tags = []) => tags.join(', ')

const vocabularyCategories = [
  { id: 'word', label: 'Words', icon: 'book', tone: 'rose' },
  { id: 'sentence', label: 'Sentences', icon: 'bookOpen', tone: 'blue' },
  { id: 'phrase', label: 'Phrases', icon: 'sparkle', tone: 'violet' },
  { id: 'phrasal-verb', label: 'Phrasal verbs', icon: 'arrow', tone: 'amber' },
  { id: 'idiom', label: 'Idioms', icon: 'sparkle', tone: 'coral' },
  { id: 'collocation', label: 'Collocations', icon: 'link', tone: 'teal' },
  { id: 'expression', label: 'Expressions', icon: 'bookOpen', tone: 'green' },
]

const isPhoneLayout = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches

const categoryLabel = (category) => vocabularyCategories.find((item) => item.id === category)?.label || 'Words'
const categorySingular = {
  word: 'word',
  sentence: 'sentence',
  phrase: 'phrase',
  'phrasal-verb': 'phrasal verb',
  idiom: 'idiom',
  collocation: 'collocation',
  expression: 'expression',
}
const categoryDescription = {
  word: 'Collect new words, their meanings, and examples that help them stick.',
  sentence: 'Save useful sentences and learn how their words fit together.',
  phrase: 'Keep handy phrases for everyday conversations and writing.',
  'phrasal-verb': 'Learn verb combinations like “look after” and how to use them.',
  idiom: 'Collect expressions whose meanings are more than the words themselves.',
  collocation: 'Notice words that naturally go together, like “make a decision.”',
  expression: 'Save useful turns of phrase you want to remember and use.',
}

// Each collection gets its own entry form: the fields, labels and hints change
// with the kind of item being saved.
const categoryForms = {
  word: {
    entryLabel: 'Word',
    entryPlaceholder: 'e.g. serendipity',
    meaningLabel: 'Meaning',
    meaningPlaceholder: 'What does this word mean?',
    exampleLabel: 'Example sentences',
    examplePlaceholder: 'One sentence per line, using the word…',
    fields: ['phonetic', 'partOfSpeech', 'synonyms', 'antonyms', 'translation', 'usageNote'],
  },
  sentence: {
    entryLabel: 'Sentence',
    entryPlaceholder: 'e.g. I would rather stay in tonight.',
    meaningLabel: 'What it means / when to use it',
    meaningPlaceholder: 'Explain the sentence in your own words…',
    exampleLabel: 'Variations',
    examplePlaceholder: 'Rewrite the sentence in your own way (one per line)…',
    fields: ['context', 'register', 'translation', 'usageNote'],
  },
  phrase: {
    entryLabel: 'Phrase',
    entryPlaceholder: 'e.g. a piece of cake',
    meaningLabel: 'Meaning',
    meaningPlaceholder: 'What does this phrase mean?',
    exampleLabel: 'Example sentences',
    examplePlaceholder: 'One sentence per line, using the phrase…',
    fields: ['register', 'synonyms', 'translation', 'usageNote'],
  },
  'phrasal-verb': {
    entryLabel: 'Phrasal verb',
    entryPlaceholder: 'e.g. look after',
    meaningLabel: 'Meaning',
    meaningPlaceholder: 'What does this phrasal verb mean?',
    exampleLabel: 'Example sentences',
    examplePlaceholder: 'One sentence per line, using the phrasal verb…',
    fields: ['verb', 'particle', 'separable', 'register', 'synonyms', 'translation', 'usageNote'],
  },
  idiom: {
    entryLabel: 'Idiom',
    entryPlaceholder: 'e.g. break the ice',
    meaningLabel: 'Figurative meaning',
    meaningPlaceholder: 'What does this idiom really mean?',
    exampleLabel: 'Example sentences',
    examplePlaceholder: 'One sentence per line, using the idiom…',
    fields: ['literalMeaning', 'origin', 'register', 'synonyms', 'translation', 'usageNote'],
  },
  collocation: {
    entryLabel: 'Collocation',
    entryPlaceholder: 'e.g. make a decision',
    meaningLabel: 'Meaning',
    meaningPlaceholder: 'What does this word combination mean?',
    exampleLabel: 'Example sentences',
    examplePlaceholder: 'One sentence per line, using the collocation…',
    fields: ['collocationType', 'collocates', 'register', 'synonyms', 'translation', 'usageNote'],
  },
  expression: {
    entryLabel: 'Expression',
    entryPlaceholder: 'e.g. long time no see',
    meaningLabel: 'Meaning',
    meaningPlaceholder: 'What does this expression mean?',
    exampleLabel: 'Example sentences',
    examplePlaceholder: 'One sentence per line, using the expression…',
    fields: ['register', 'context', 'synonyms', 'translation', 'usageNote'],
  },
}
const categoryForm = (category) => categoryForms[category] || categoryForms.word
const articleFor = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a')
const registerOptions = ['', 'informal', 'neutral', 'formal', 'slang', 'academic', 'business']
const collocationTypeOptions = ['', 'verb + noun', 'adjective + noun', 'noun + noun', 'verb + adverb', 'adverb + adjective', 'prepositional']
const separableOptions = ['', 'separable', 'inseparable']
const categoryDetailFields = {
  phonetic: { label: 'Phonetics', placeholder: 'e.g. /ˌserənˈdɪpəti/' },
  partOfSpeech: { label: 'Part of speech', placeholder: 'e.g. noun, verb, adjective' },
  verb: { label: 'Base verb', placeholder: 'e.g. look' },
  particle: { label: 'Particle', placeholder: 'e.g. after, up, off' },
  separable: { label: 'Separable?', options: separableOptions, optionLabels: { '': 'Not set', separable: 'Separable', inseparable: 'Inseparable' } },
  register: { label: 'Register', options: registerOptions, optionLabels: { '': 'Not set', informal: 'Informal', neutral: 'Neutral', formal: 'Formal', slang: 'Slang', academic: 'Academic', business: 'Business' } },
  literalMeaning: { label: 'Literal meaning', placeholder: 'What the words say on their own' },
  collocationType: { label: 'Pattern', options: collocationTypeOptions, optionLabels: { '': 'Not set', 'verb + noun': 'Verb + noun', 'adjective + noun': 'Adjective + noun', 'noun + noun': 'Noun + noun', 'verb + adverb': 'Verb + adverb', 'adverb + adjective': 'Adverb + adjective', prepositional: 'Prepositional' } },
  collocates: { label: 'Words that go with it', placeholder: 'e.g. a decision, a mistake, progress (comma-separated)' },
  usageNote: { label: 'Usage note', placeholder: 'When to use it, or a common mistake to avoid' },
  origin: { label: 'Origin / story', placeholder: 'Where does this idiom come from?' },
  context: { label: 'Context', placeholder: 'e.g. at work, when apologising, in emails' },
  translation: { label: 'Translation', placeholder: 'Your language, if it helps' },
  synonyms: { label: 'Synonyms / similar', placeholder: 'Comma-separated' },
  antonyms: { label: 'Antonyms / opposite', placeholder: 'Comma-separated' },
}
const categoryDetailValue = (form, field) => (field === 'collocates' ? form.collocatesText : form[field] || '')
const categoryDetailUpdate = (form, field, value) => ({ ...form, [field === 'collocates' ? 'collocatesText' : field]: value })
const categoryItemToForm = (item) => ({
  ...emptyVocabularyForm(item.category || 'word'),
  word: item.word || '',
  meaning: item.meaning || '',
  example: item.example || '',
  examplesText: (item.examples || (item.example ? [item.example] : [])).join('\n'),
  phonetic: item.phonetic || '',
  partOfSpeech: item.partOfSpeech || '',
  synonymsText: (item.synonyms || []).join(', '),
  antonymsText: (item.antonyms || []).join(', '),
  favorite: item.favorite === true,
  tagsText: formatTags(item.tags || []),
  difficulty: item.difficulty || '',
  learningGoal: item.learningGoal || '',
  verb: item.verb || '',
  particle: item.particle || '',
  separable: item.separable || '',
  register: item.register || '',
  literalMeaning: item.literalMeaning || '',
  collocatesText: (item.collocates || []).join(', '),
  collocationType: item.collocationType || '',
  usageNote: item.usageNote || '',
  origin: item.origin || '',
  context: item.context || '',
  translation: item.translation || '',
})
const vocabularyFormToItem = (form, previousItem = null) => {
  const examples = splitLines(form.examplesText || '')
  if (!examples.length && form.example.trim()) examples.push(form.example.trim())
  return {
    word: form.word.trim(),
    meaning: form.meaning.trim(),
    example: examples[0] || '',
    examples,
    phonetic: form.phonetic.trim(),
    partOfSpeech: form.partOfSpeech.trim(),
    synonyms: splitList(form.synonymsText),
    antonyms: splitList(form.antonymsText),
    category: form.category,
    favorite: form.favorite,
    tags: splitList(form.tagsText),
    difficulty: form.difficulty,
    learningGoal: form.learningGoal.trim(),
    verb: form.verb.trim(),
    particle: form.particle.trim(),
    separable: form.separable,
    register: form.register,
    literalMeaning: form.literalMeaning.trim(),
    collocates: splitList(form.collocatesText),
    collocationType: form.collocationType,
    usageNote: form.usageNote.trim(),
    origin: form.origin.trim(),
    context: form.context.trim(),
    translation: form.translation.trim(),
    ...(previousItem ? {
      reviewDueAt: previousItem.reviewDueAt,
      reviewInterval: previousItem.reviewInterval,
      reviewRepetitions: previousItem.reviewRepetitions,
      reviewEase: previousItem.reviewEase,
      reviewedAt: previousItem.reviewedAt,
      reviewTotal: previousItem.reviewTotal,
      reviewCorrect: previousItem.reviewCorrect,
    } : {}),
  }
}

const stickerGroups = [
  {
    id: 'cottagecore',
    label: 'Aesthetic & cottagecore',
    description: 'Little cozy things for your pages.',
    stickers: [
      ['cottage', 'Rose cottage', '🏡'], ['mushroom', 'Storybook mushroom', '🍄'], ['teacup', 'Garden tea cup', '🫖'],
      ['open-book', 'Flowering book', '📖'], ['jam-jar', 'Rosehip jam', '🍓'], ['window', 'Garden window', '🪟'],
      ['basket', 'Wildflower basket', '🧺'], ['watering-can', 'Watering can', '🪴'], ['bow', 'Gingham bow', '🎀'],
      ['lantern', 'Golden lantern', '🏮'],
    ],
  },
  {
    id: 'botanicals',
    label: 'Flowers & botanicals',
    description: 'Individual blooms and leafy stems.',
    stickers: [
      ['lavender-bunch', 'Lavender bunch', '💐'], ['daisy-stem', 'Daisy stem', '🌼'], ['tulip', 'Pink tulip', '🌷'],
      ['sunflower', 'Sunflower', '🌻'], ['rose', 'Wild rose', '🌹'], ['cosmos', 'Cosmos flower', '🌸'],
      ['poppy', 'Field poppy', '🌺'], ['eucalyptus', 'Eucalyptus', '🌿'], ['fern', 'Fern frond', '🌱'],
      ['wildflower', 'Meadow flowers', '💮'], ['clover', 'Four-leaf clover', '☘️'],
    ],
  },
  {
    id: 'pressed',
    label: 'Pressed & dried florals',
    description: 'Soft, translucent keepsakes from a pressed-flower journal.',
    stickers: [
      ['pressed-lavender', 'Pressed lavender', '🪻'], ['pressed-fern', 'Pressed fern', '🌿'], ['pressed-daisy', 'Pressed daisy', '🌼'],
      ['pressed-rose', 'Dried rose', '🥀'], ['pressed-eucalyptus', 'Pressed eucalyptus', '🍃'], ['pressed-wheat', 'Golden wheat', '🌾'],
      ['pressed-poppy', 'Dried poppy', '🌺'], ['pressed-babys-breath', 'Baby’s breath', '🤍'], ['pressed-pansy', 'Pressed pansy', '🪻'],
      ['pressed-leaves', 'Autumn leaves', '🍂'],
    ],
  },
  {
    id: 'specimens',
    label: 'Botanical specimens',
    description: 'Antique-journal plates with the plants’ Latin names.',
    stickers: [
      ['specimen-lavandula', 'Lavandula · lavender', '🪻'], ['specimen-rosa', 'Rosa gallica · rose', '🌹'],
      ['specimen-fern', 'Athyrium · fern', '🌿'], ['specimen-bellis', 'Bellis perennis · daisy', '🌼'],
      ['specimen-papaver', 'Papaver rhoeas · poppy', '🌺'], ['specimen-eucalyptus', 'Eucalyptus · leaves', '🍃'],
      ['specimen-tulipa', 'Tulipa sylvestris · tulip', '🌷'], ['specimen-triticum', 'Triticum · wheat', '🌾'],
      ['specimen-myosotis', 'Myosotis · forget-me-not', '💠'],
    ],
  },
  {
    id: 'kawaii',
    label: 'Chunky kawaii blooms',
    description: 'Bold, happy flowers with playful inky outlines.',
    stickers: [
      ['kawaii-daisy', 'Smiley daisy', '🌼'], ['kawaii-sunflower', 'Happy sunflower', '🌻'],
      ['kawaii-tulip', 'Smiling tulip', '🌷'], ['kawaii-rose', 'Sweet rose', '🌹'],
      ['kawaii-cosmos', 'Cosmos cutie', '🌸'], ['kawaii-poppy', 'Poppy pal', '🌺'],
      ['kawaii-lavender', 'Lavender friend', '🪻'], ['kawaii-clover', 'Lucky clover', '☘️'],
      ['kawaii-blossom', 'Cherry blossom', '🌸'], ['kawaii-tiny-bloom', 'Tiny bloom', '🌼'],
    ],
  },
]
const pageStickers = stickerGroups.flatMap((group) => group.stickers.map(([id, label, emoji]) => ({ id, label, emoji, group: group.id })))
const pageStickersById = new Map(pageStickers.map((sticker) => [sticker.id, sticker]))
const legacyStickerIds = new Map([
  ['🌼', 'daisy-stem'], ['🌷', 'tulip'], ['🌻', 'sunflower'], ['🌸', 'cosmos'], ['🍀', 'clover'],
  ['🦋', 'wildflower'], ['🐝', 'wildflower'], ['🐞', 'wildflower'], ['🌈', 'wildflower'], ['☀️', 'sunflower'],
  ['⭐', 'sunflower'], ['💖', 'rose'], ['📚', 'open-book'], ['✏️', 'open-book'], ['🎈', 'bow'], ['☕', 'teacup'],
])

const stickerPreview = (sticker, className = '') => (
  <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
    <use href={`/stickers.svg#${sticker.id}`} />
  </svg>
)

const requestEntries = async () => storage.getAll()

const safeHtml = (html = '') => {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  parsed.querySelectorAll('span.page-sticker').forEach((element) => {
    let sticker = pageStickersById.get(element.getAttribute('data-sticker-id'))
    if (!sticker) {
      const legacyId = legacyStickerIds.get(element.textContent)
      sticker = legacyId ? pageStickersById.get(legacyId) : null
    }
    if (!sticker) {
      element.replaceWith(parsed.createTextNode(element.textContent))
      return
    }
    element.replaceChildren(parsed.createTextNode(sticker.emoji))
    element.setAttribute('class', 'page-sticker')
    element.setAttribute('data-sticker-id', sticker.id)
    element.setAttribute('contenteditable', 'false')
    element.setAttribute('title', 'Click to remove sticker')
  })
  parsed.querySelectorAll('script,style,iframe,object,embed,form,svg,math,template').forEach((node) => node.remove())
  const allowedTags = new Set(['A', 'B', 'BLOCKQUOTE', 'BR', 'DIV', 'EM', 'FONT', 'H1', 'H2', 'H3', 'HR', 'I', 'IMG', 'LI', 'OL', 'P', 'SPAN', 'STRONG', 'U', 'UL'])
  parsed.body.querySelectorAll('*').forEach((element) => {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...element.childNodes)
      return
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (!['href', 'src', 'alt', 'title', 'class', 'face', 'data-sticker-id'].includes(name)) {
        element.removeAttribute(attribute.name)
      }
    }
    if (element.hasAttribute('class') && !(
      element.tagName === 'SPAN'
      && element.getAttribute('class') === 'page-sticker'
      && pageStickersById.get(element.getAttribute('data-sticker-id'))?.emoji === element.textContent
    )) {
      element.removeAttribute('class')
    }
    if (element.tagName === 'SPAN' && element.classList.contains('page-sticker') && pageStickersById.has(element.getAttribute('data-sticker-id'))) {
      element.setAttribute('contenteditable', 'false')
      element.setAttribute('title', 'Click to remove sticker')
    } else {
      element.removeAttribute('data-sticker-id')
    }
    if (element.tagName === 'FONT' && !['Arial', 'Courier New', 'Georgia', 'Trebuchet MS', 'Verdana'].includes(element.getAttribute('face'))) {
      element.removeAttribute('face')
    }
    for (const attribute of ['href', 'src']) {
      const value = element.getAttribute(attribute)
      const localImage = attribute === 'src' && /^\/uploads\/[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(value || '')
      const dataImage = attribute === 'src' && /^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(value || '')
      if (value && !localImage && !dataImage && !/^https?:\/\//i.test(value.trim())) element.removeAttribute(attribute)
    }
    if (element.tagName === 'A') {
      element.setAttribute('rel', 'noreferrer')
      element.setAttribute('target', '_blank')
    }
    if (element.tagName === 'IMG' && !element.hasAttribute('src')) element.remove()
  })
  return parsed.body.innerHTML
}

const hydratePageStickers = (editor) => {
  editor.querySelectorAll('span.page-sticker[data-sticker-id]').forEach((element) => {
    const sticker = pageStickersById.get(element.dataset.stickerId)
    if (!sticker) return
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 100 100')
    svg.setAttribute('aria-hidden', 'true')
    svg.classList.add('sticker-art')
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('href', `/stickers.svg#${sticker.id}`)
    svg.append(use)
    element.replaceChildren(svg)
    element.contentEditable = 'false'
    element.title = 'Click to remove sticker'
  })
}

const formatDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const learningStats = (entries, referenceDate = new Date()) => {
  const activeDates = new Set(entries.map((entry) => entry.entryDate))
  const todayDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())
  const streakDate = new Date(todayDate)
  if (!activeDates.has(dateKey(streakDate))) streakDate.setDate(streakDate.getDate() - 1)
  let currentStreak = 0
  while (activeDates.has(dateKey(streakDate))) {
    currentStreak += 1
    streakDate.setDate(streakDate.getDate() - 1)
  }

  const sortedDates = [...activeDates].filter((date) => date <= dateKey(referenceDate)).sort()
  let bestStreak = 0
  let runningStreak = 0
  let previousDate = null
  for (const date of sortedDates) {
    const currentDate = new Date(`${date}T00:00:00.000Z`)
    const isConsecutive = previousDate && currentDate - previousDate === 24 * 60 * 60 * 1000
    runningStreak = isConsecutive ? runningStreak + 1 : 1
    bestStreak = Math.max(bestStreak, runningStreak)
    previousDate = currentDate
  }
  return { activeDates, currentStreak, bestStreak }
}

function DailyReview({ cards, quizCards, availableWordCount, scheduledCount, busyKey, onRate }) {
  const [revealedCards, setRevealedCards] = useState(new Set())
  const [mode, setMode] = useState('flashcards')
  const [quizSessionCards, setQuizSessionCards] = useState(null)
  const [quizIndex, setQuizIndex] = useState(0)
  const [quizScore, setQuizScore] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState('')
  const reveal = (key) => setRevealedCards((current) => new Set(current).add(key))
  const rateCard = async (entry, itemIndex, key, rating) => {
    const saved = await onRate(entry, itemIndex, key, rating)
    if (saved) setRevealedCards((current) => {
      const next = new Set(current)
      next.delete(key)
      return next
    })
  }
  const startQuiz = () => {
    setQuizSessionCards(quizCards)
    setQuizIndex(0)
    setQuizScore(0)
    setSelectedAnswer('')
  }
  const answerQuestion = (answer) => {
    if (selectedAnswer) return
    setSelectedAnswer(answer)
    if (answer.toLocaleLowerCase() === quizSessionCards[quizIndex].item.word.toLocaleLowerCase()) {
      setQuizScore((score) => score + 1)
    }
  }
  const rateQuizCard = async (rating) => {
    const card = quizSessionCards[quizIndex]
    if (await onRate(card.entry, card.itemIndex, card.key, rating)) {
      setQuizIndex((index) => index + 1)
      setSelectedAnswer('')
    }
  }
  const quizFinished = quizSessionCards && quizIndex >= quizSessionCards.length
  const currentQuizCard = quizSessionCards && !quizFinished ? quizSessionCards[quizIndex] : null
  const answerCorrect = currentQuizCard && selectedAnswer.toLocaleLowerCase() === currentQuizCard.item.word.toLocaleLowerCase()

  return (
    <section className="learning-page review-page">
      <header className="learning-page-hero review-hero">
        <span className="learning-hero-flower" aria-hidden="true">✿</span>
        <span className="eyebrow"><span className="eyebrow-dot" /> A LITTLE PRACTICE, EVERY DAY</span>
        <h1>Daily review<em> helps words bloom.</em></h1>
        <p>Practice meanings with flashcards, or choose the word that best completes one of your example sentences.</p>
        <div className="learning-hero-stats">
          <span><strong>{cards.length}</strong> ready to review</span>
          <span><strong>{scheduledCount}</strong> resting for later</span>
        </div>
      </header>
      <div className="review-mode-switch" role="group" aria-label="Choose a review activity">
        <button type="button" className={mode === 'flashcards' ? 'active' : ''} aria-pressed={mode === 'flashcards'} onClick={() => setMode('flashcards')}>Flashcards</button>
        <button type="button" className={mode === 'quiz' ? 'active' : ''} aria-pressed={mode === 'quiz'} onClick={() => { setMode('quiz'); setQuizSessionCards(null) }}>Sentence quiz <span>{quizCards.length}</span></button>
      </div>
      {mode === 'flashcards' ? cards.length ? (
        <div className="review-card-grid">
          {cards.map(({ key, entry, item, itemIndex }) => {
            const revealed = revealedCards.has(key)
            const waiting = busyKey === key
            return (
              <article className={`review-card ${revealed ? 'revealed' : ''}`} key={key}>
                <div className="review-card-topline"><span>{categoryLabel(item.category || 'word')}</span><span>{entry.title || 'Notebook page'}</span></div>
                <h2>{item.word}</h2>
                {revealed ? (
                  <>
                    <div className="review-answer"><strong>Meaning</strong><p>{item.meaning}</p>{item.example && <em>{item.example}</em>}</div>
                    <p className="review-rating-prompt">How well did you remember?</p>
                    <div className="review-ratings">
                      <button type="button" className="rating-again" disabled={Boolean(busyKey)} onClick={() => rateCard(entry, itemIndex, key, 'again')}>Again<small>in 10 minutes</small></button>
                      <button type="button" className="rating-hard" disabled={Boolean(busyKey)} onClick={() => rateCard(entry, itemIndex, key, 'hard')}>Hard<small>short interval</small></button>
                      <button type="button" className="rating-remembered" disabled={Boolean(busyKey)} onClick={() => rateCard(entry, itemIndex, key, 'remembered')}>Remembered<small>longer interval</small></button>
                    </div>
                    {waiting && <span className="review-saving" role="status">Saving your review…</span>}
                  </>
                ) : (
                  <button type="button" className="reveal-answer-button" onClick={() => reveal(key)}>Reveal meaning <Icon name="arrow" size={15} /></button>
                )}
              </article>
            )
          })}
        </div>
      ) : (
        <div className="review-empty-state">
          <span aria-hidden="true">🌷</span>
          <h2>You’re all caught up!</h2>
          <p>{scheduledCount ? 'Your next words are resting in the garden. Come back when they’re due.' : 'Save a word, phrase, or sentence to start building your review deck.'}</p>
        </div>
      ) : (
        <section className="sentence-quiz-panel" aria-live="polite">
          {!quizSessionCards ? (
            <div className="sentence-quiz-intro">
              <span className="section-kicker">PICK THE WORD THAT FITS</span>
              <h2>Complete the sentence</h2>
              <p>Choose the saved word that belongs in the blank. Questions use your example sentences, so add an example containing its word to make a quiz card.</p>
              {quizCards.length && availableWordCount > 1 ? (
                <>
                  <p className="sentence-quiz-count">{quizCards.length} question{quizCards.length === 1 ? '' : 's'} ready</p>
                  <button type="button" className="reveal-answer-button" onClick={startQuiz}>Start sentence quiz <Icon name="arrow" size={15} /></button>
                </>
              ) : (
                <p className="sentence-quiz-hint">
                  {!cards.length
                    ? 'There are no words due to review right now. Come back when a saved word is due.'
                    : !availableWordCount || availableWordCount < 2
                      ? 'Save at least two different vocabulary items to create answer choices.'
                      : 'Add an example sentence to a due vocabulary item. Include the saved word in the sentence so it can be hidden for the quiz.'}
                </p>
              )}
            </div>
          ) : quizFinished ? (
            <div className="sentence-quiz-intro sentence-quiz-finished">
              <span className="section-kicker">QUIZ COMPLETE</span>
              <h2>Lovely work!</h2>
              <p>You got <strong>{quizScore} of {quizSessionCards.length}</strong> correct.</p>
              <button type="button" className="reveal-answer-button" onClick={startQuiz} disabled={!quizCards.length}>Practice again <Icon name="arrow" size={15} /></button>
            </div>
          ) : currentQuizCard ? (
            <article className="sentence-quiz-question">
              <div className="sentence-quiz-progress">
                <span>QUESTION {quizIndex + 1} OF {quizSessionCards.length}</span>
                <span>{quizScore} correct</span>
              </div>
              <div className="sentence-quiz-progress-track"><span style={{ width: `${((quizIndex + 1) / quizSessionCards.length) * 100}%` }} /></div>
              <span className="section-kicker">{categoryLabel(currentQuizCard.item.category || 'word')}</span>
              <h2>Choose the correct word</h2>
              <p className="sentence-quiz-prompt">{currentQuizCard.sentence}</p>
              <div className="sentence-quiz-options">
                {currentQuizCard.options.map((option) => {
                  const isCorrect = option.toLocaleLowerCase() === currentQuizCard.item.word.toLocaleLowerCase()
                  const stateClass = selectedAnswer && isCorrect ? 'is-correct' : selectedAnswer === option ? 'is-incorrect' : ''
                  return <button type="button" key={option} className={stateClass} disabled={Boolean(selectedAnswer)} onClick={() => answerQuestion(option)}>{option}</button>
                })}
              </div>
              {selectedAnswer && (
                <>
                  <p className={`sentence-quiz-feedback ${selectedAnswer.toLocaleLowerCase() === currentQuizCard.item.word.toLocaleLowerCase() ? 'is-correct' : 'is-incorrect'}`} role="status">
                    {answerCorrect
                      ? 'That’s right! Nice use of this word.'
                      : <>Not quite. The correct word is <strong>{currentQuizCard.item.word}</strong>.</>}
                  </p>
                  {answerCorrect ? (
                    <>
                      <p className="review-rating-prompt">How well did you remember?</p>
                      <div className="review-ratings">
                        <button type="button" className="rating-again" disabled={Boolean(busyKey)} onClick={() => rateQuizCard('again')}>Again<small>in 10 minutes</small></button>
                        <button type="button" className="rating-hard" disabled={Boolean(busyKey)} onClick={() => rateQuizCard('hard')}>Hard<small>short interval</small></button>
                        <button type="button" className="rating-remembered" disabled={Boolean(busyKey)} onClick={() => rateQuizCard('remembered')}>Remembered<small>longer interval</small></button>
                      </div>
                    </>
                  ) : (
                    <div className="sentence-quiz-wrong-action">
                      <p className="review-rating-prompt">We’ll bring this word back for another try.</p>
                      <button type="button" className="rating-again" disabled={Boolean(busyKey)} onClick={() => rateQuizCard('again')}>Again<small>in 10 minutes</small></button>
                    </div>
                  )}
                  {busyKey === currentQuizCard.key && <span className="review-saving" role="status">Saving your review…</span>}
                </>
              )}
            </article>
          ) : null}
        </section>
      )}
    </section>
  )
}

function LearningCalendar({ entries, stats, openEntry }) {
  const [month, setMonth] = useState(() => new Date(initialCalendarMonth.getFullYear(), initialCalendarMonth.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(() => today())
  const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay()
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const changeMonth = (offset) => {
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + offset, 1)
    setMonth(nextMonth)
    setSelectedDate(dateKey(nextMonth))
  }
  const monthEntries = new Map()
  for (const entry of entries) monthEntries.set(entry.entryDate, (monthEntries.get(entry.entryDate) || 0) + 1)
  const selectedEntries = entries.filter((entry) => entry.entryDate === selectedDate)

  return (
    <section className="learning-page calendar-page">
      <header className="learning-page-hero calendar-hero">
        <span className="learning-hero-flower" aria-hidden="true">✧</span>
        <span className="eyebrow"><span className="eyebrow-dot" /> EVERY LITTLE STEP COUNTS</span>
        <h1>Your learning<em> in full bloom.</em></h1>
        <p>Each flower marks a day you wrote in your notebook. Your progress grows one page at a time.</p>
        <div className="learning-hero-stats">
          <span><strong>{stats.currentStreak}</strong> day current streak</span>
          <span><strong>{stats.bestStreak}</strong> day best streak</span>
        </div>
      </header>
      <div className="activity-layout">
        <section className="activity-calendar" aria-label="Notebook activity calendar">
          <div className="calendar-heading">
            <div><span className="section-kicker">YOUR WRITING RHYTHM</span><h2>{month.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</h2></div>
            <div className="calendar-month-controls">
              <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button>
              <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}>›</button>
            </div>
          </div>
          <div className="calendar-grid" role="group" aria-label={`${month.toLocaleDateString('en', { month: 'long', year: 'numeric' })} activity calendar`}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="calendar-weekday" key={day}>{day}</span>)}
            {Array.from({ length: firstWeekday }, (_, index) => <span className="calendar-blank" aria-hidden="true" key={`blank-${index}`} />)}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const date = new Date(month.getFullYear(), month.getMonth(), index + 1)
              const key = dateKey(date)
              const count = monthEntries.get(key) || 0
              return (
                <button
                  type="button"
                  key={key}
                  aria-label={`${date.toLocaleDateString('en', { month: 'long', day: 'numeric' })}${count ? `, ${count} page${count === 1 ? '' : 's'} written` : ', no pages written'}`}
                  aria-pressed={selectedDate === key}
                  className={`calendar-day ${count ? 'has-activity' : ''} ${key === today() ? 'is-today' : ''} ${selectedDate === key ? 'is-selected' : ''}`}
                  onClick={() => setSelectedDate(key)}
                >
                  <span>{index + 1}</span>{count > 0 && <i aria-hidden="true">{count > 1 ? count : '✿'}</i>}
                </button>
              )
            })}
          </div>
          <div className="calendar-legend"><span><i>✿</i> A page written</span><span>{stats.activeDates.size} active day{stats.activeDates.size === 1 ? '' : 's'} total</span></div>
        </section>
        <aside className="calendar-day-detail">
          <span className="section-kicker">YOUR LITTLE PAGES</span>
          <h2>{formatDate(selectedDate)}</h2>
          {selectedEntries.length ? (
            <div className="calendar-entry-list">
              {selectedEntries.map((entry) => <button type="button" key={entry._id} onClick={() => openEntry(entry)}><span>✿</span><span><strong>{entry.title || 'A little note'}</strong><small>{entry.vocabulary?.length || 0} learning item{entry.vocabulary?.length === 1 ? '' : 's'}</small></span><Icon name="arrow" size={15} /></button>)}
            </div>
          ) : <p className="calendar-no-pages">A blank day is just room for what comes next.</p>}
        </aside>
      </div>
    </section>
  )
}

function ProgressDashboard({ entries, stats, now }) {
  const allWords = entries.flatMap((entry) => entry.vocabulary || [])
  const reviewedWords = allWords.filter((item) => (item.reviewTotal || 0) > 0).length
  const attempts = allWords.reduce((sum, item) => sum + (item.reviewTotal || 0), 0)
  const correct = allWords.reduce((sum, item) => sum + (item.reviewCorrect || 0), 0)
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now)
    date.setDate(1)
    date.setMonth(date.getMonth() - (5 - index))
    const prefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    return {
      label: date.toLocaleDateString('en', { month: 'short' }),
      count: entries.filter((entry) => entry.entryDate.startsWith(prefix)).length,
    }
  })
  const maximum = Math.max(1, ...months.map((month) => month.count))
  return (
    <section className="learning-page dashboard-page">
      <header className="learning-page-hero dashboard-hero">
        <span className="learning-hero-flower" aria-hidden="true">✿</span>
        <span className="eyebrow"><span className="eyebrow-dot" /> LOOK HOW FAR YOU’VE GROWN</span>
        <h1>Your learning<em> progress.</em></h1>
        <p>A little reflection on the words you have collected, reviewed, and written down.</p>
        <div className="learning-hero-stats">
          <span><strong>{stats.currentStreak}</strong> day current streak</span>
          <span><strong>{stats.bestStreak}</strong> day best streak</span>
        </div>
      </header>
      <div className="dashboard-stat-grid">
        <article><span>✿</span><strong>{allWords.length}</strong><small>words and expressions saved</small></article>
        <article><span>✓</span><strong>{reviewedWords}</strong><small>items reviewed at least once</small></article>
        <article><span>↗</span><strong>{attempts ? `${Math.round((correct / attempts) * 100)}%` : '—'}</strong><small>review accuracy · {attempts} attempts</small></article>
        <article><span>▤</span><strong>{entries.length}</strong><small>notebook pages written</small></article>
      </div>
      <section className="dashboard-activity">
        <div><span className="section-kicker">SIX MONTHS OF LITTLE STEPS</span><h2>Writing activity</h2><p>Pages dated in each month.</p></div>
        <div className="activity-bars" aria-label="Monthly writing activity">
          {months.map((month) => (
            <div className="activity-bar-column" key={`${month.label}-${month.count}`}>
              <span>{month.count}</span>
              <div><i style={{ height: `${Math.max(5, (month.count / maximum) * 100)}%` }} /></div>
              <small>{month.label}</small>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}

function RecycleBin({ entries, onRestore, onDelete }) {
  return (
    <section className="learning-page recycle-page">
      <header className="learning-page-hero">
        <span className="learning-hero-flower" aria-hidden="true">♧</span>
        <span className="eyebrow"><span className="eyebrow-dot" /> A SOFT LANDING FOR MISPLACED PAGES</span>
        <h1>Recycle bin<em> keeps them safe.</em></h1>
        <p>Restore a page to your notebook, or permanently remove it when you’re sure.</p>
      </header>
      <div className="trash-list">
        {entries.length ? entries.map((entry) => (
          <article className="trash-entry" key={entry._id}>
            <span className="trash-entry-flower">✿</span>
            <div><strong>{entry.title || 'A little note'}</strong><small>Deleted {entry.deletedAt ? formatDate(entry.deletedAt.slice(0, 10)) : 'recently'} · {formatDate(entry.entryDate)}</small></div>
            <button type="button" className="trash-restore" onClick={() => onRestore(entry)}>Restore</button>
            <button type="button" className="trash-delete" onClick={() => onDelete(entry)}>Delete forever</button>
          </article>
        )) : <div className="review-empty-state"><span aria-hidden="true">🌱</span><h2>Your recycle bin is empty</h2><p>Deleted pages will stay here until you restore or permanently remove them.</p></div>}
      </div>
    </section>
  )
}

function GrammarGuide({ progress, onComplete, generatedLessons, onSaveGenerated, onUpdateGenerated, onDeleteGenerated }) {
  const [level, setLevel] = useState('All levels')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(grammarLessons[0].id)
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [toast, setToast] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [sourceType, setSourceType] = useState('text')
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [addLessonOpen, setAddLessonOpen] = useState(false)
  const [editingLessonId, setEditingLessonId] = useState(null)
  const [customLessonDraft, setCustomLessonDraft] = useState(emptyCustomLesson)
  const [customLessonError, setCustomLessonError] = useState('')
  const sourceFileRef = useRef(null)
  const allLessons = [...grammarLessons, ...generatedLessons]
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const visibleLessons = allLessons.filter((lesson) => (
    (level === 'All levels' || (level === 'My lessons' ? lesson.generated : lesson.level === level))
    && (!normalizedSearch || `${lesson.title} ${lesson.summary} ${lesson.explanation} ${lesson.vocabulary?.map((item) => `${item.word} ${item.meaning}`).join(' ') || ''}`.toLocaleLowerCase().includes(normalizedSearch))
  ))
  const selectedLesson = visibleLessons.find((lesson) => lesson.id === selectedId) || visibleLessons[0] || null
  const completedCount = allLessons.filter((lesson) => progress[lesson.id]?.completed).length
  const practiceQuestion = selectedLesson?.questions?.[0] || null
  const correctAnswer = practiceQuestion?.answer
  const answeredCorrectly = selectedAnswer !== null && selectedAnswer === correctAnswer
  const resetPractice = () => {
    setSelectedAnswer(null)
    setShowResult(false)
    setToast('')
  }
  const openAddLesson = () => {
    setEditingLessonId(null)
    setCustomLessonDraft(emptyCustomLesson())
    setCustomLessonError('')
    setAddLessonOpen(true)
  }
  const openEditLesson = (lesson) => {
    const lessonQuestion = lesson.questions?.[0]
    setEditingLessonId(lesson.id)
    setCustomLessonDraft({
      title: lesson.title || '',
      date: lesson.date || today(),
      level: lesson.level || 'Beginner',
      summary: lesson.summary || '',
      explanation: lesson.explanation || '',
      examplesText: (lesson.examples || []).join('\n'),
      mistakesText: (lesson.commonMistakes || []).join('\n'),
      questionPrompt: lessonQuestion?.prompt || '',
      optionA: lessonQuestion?.options?.[0] || '',
      optionB: lessonQuestion?.options?.[1] || '',
      optionC: lessonQuestion?.options?.[2] || '',
      optionD: lessonQuestion?.options?.[3] || '',
      correctOption: lessonQuestion ? String(lessonQuestion.answer) : '',
      questionExplanation: lessonQuestion?.explanation || '',
    })
    setCustomLessonError('')
    setAddLessonOpen(true)
  }
  const closeAddLesson = () => {
    setAddLessonOpen(false)
    setEditingLessonId(null)
    setCustomLessonError('')
  }
  const updateQuizOption = (index, value) => {
    setCustomLessonDraft({ ...customLessonDraft, [quizOptionKeys[index]]: value })
  }
  const quizHasContent = Boolean(
    customLessonDraft.questionPrompt.trim()
    || customLessonDraft.questionExplanation.trim()
    || customLessonDraft.correctOption !== ''
    || quizOptionKeys.some((key) => customLessonDraft[key].trim()),
  )
  const clearQuiz = () => {
    setCustomLessonDraft({
      ...customLessonDraft,
      questionPrompt: '',
      optionA: '',
      optionB: '',
      optionC: '',
      optionD: '',
      correctOption: '',
      questionExplanation: '',
    })
    setCustomLessonError('')
  }
  const saveCustomLesson = (event) => {
    event.preventDefault()
    const title = customLessonDraft.title.trim()
    if (!title) {
      setCustomLessonError('Give your lesson a heading so you can find it later.')
      return
    }
    if (!customLessonDraft.date) {
      setCustomLessonError('Choose a date for this lesson.')
      return
    }
    const optionValues = [customLessonDraft.optionA, customLessonDraft.optionB, customLessonDraft.optionC, customLessonDraft.optionD].map((option) => option.trim())
    const questionPrompt = customLessonDraft.questionPrompt.trim()
    const questionExplanation = customLessonDraft.questionExplanation.trim()
    const quizStarted = Boolean(questionPrompt || questionExplanation || customLessonDraft.correctOption !== '' || optionValues.some(Boolean))
    let questions = []
    if (quizStarted) {
      if (!questionPrompt) {
        setCustomLessonError('Write the quick-check question, or clear the quiz fields to leave the quiz out.')
        return
      }
      if (optionValues.some((option) => !option)) {
        setCustomLessonError('Fill in all four quick-check answer options.')
        return
      }
      if (new Set(optionValues.map((option) => option.toLocaleLowerCase())).size < 4) {
        setCustomLessonError('Make each quick-check option different.')
        return
      }
      if (customLessonDraft.correctOption === '') {
        setCustomLessonError('Choose which quick-check answer is correct.')
        return
      }
      questions = [{
        prompt: questionPrompt,
        options: optionValues,
        answer: Number(customLessonDraft.correctOption),
        explanation: questionExplanation,
      }]
    }
    const existingLesson = editingLessonId ? allLessons.find((item) => item.id === editingLessonId) : null
    const lesson = {
      ...(existingLesson || {}),
      id: existingLesson?.id || createCustomLessonId(),
      title,
      date: customLessonDraft.date,
      level: customLessonDraft.level,
      summary: customLessonDraft.summary.trim(),
      explanation: customLessonDraft.explanation.trim(),
      examples: splitLines(customLessonDraft.examplesText),
      commonMistakes: splitLines(customLessonDraft.mistakesText),
      vocabulary: existingLesson?.vocabulary || [],
      questions,
      references: existingLesson?.references || [],
      generated: true,
      custom: true,
      createdAt: existingLesson?.createdAt || nowIso(),
      updatedAt: nowIso(),
    }
    const saved = existingLesson ? onUpdateGenerated(lesson) : onSaveGenerated(lesson)
    if (!saved) {
      setCustomLessonError('This lesson could not be saved in this browser. Check local storage space and try again.')
      return
    }
    setAddLessonOpen(false)
    setEditingLessonId(null)
    setCustomLessonDraft(emptyCustomLesson())
    setCustomLessonError('')
    setLevel('My lessons')
    setSearch('')
    setSelectedId(lesson.id)
    resetPractice()
    setToast(existingLesson ? 'Lesson updated.' : 'Lesson added to your grammar guide.')
    window.setTimeout(() => setToast(''), 3500)
  }
  useEffect(() => {
    if (!addLessonOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return
      setAddLessonOpen(false)
      setEditingLessonId(null)
      setCustomLessonError('')
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [addLessonOpen])
  const deleteLesson = (lessonId) => {
    onDeleteGenerated(lessonId)
    const remainingMine = allLessons.filter((lesson) => lesson.id !== lessonId && lesson.generated).length
    if (level === 'My lessons' && remainingMine === 0) setLevel('All levels')
    setSelectedId(grammarLessons[0].id)
    resetPractice()
  }
  const changeSearch = (value) => {
    setSearch(value)
    resetPractice()
  }
  const changeLevel = (value) => {
    setLevel(value)
    resetPractice()
  }
  const selectLesson = (lesson) => {
    setSelectedId(lesson.id)
    resetPractice()
  }
  const submitAnswer = () => {
    if (!selectedLesson || !practiceQuestion || selectedAnswer === null) return
    onComplete(selectedLesson.id, selectedAnswer === correctAnswer ? 1 : 0)
    setShowResult(true)
    setToast(selectedAnswer === correctAnswer ? 'Lesson completed — lovely work!' : 'Answer checked. Review the explanation and try again when you’re ready.')
    window.setTimeout(() => setToast(''), 3500)
  }
  const tryAgain = () => {
    setSelectedAnswer(null)
    setShowResult(false)
    setToast('')
  }
  const readSourceFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!['txt', 'srt'].includes(extension)) {
      setGenerationError('Choose a plain text (.txt) or SubRip subtitle (.srt) file.')
      return
    }
    if (file.size > 250_000) {
      setGenerationError('Choose a file smaller than 250 KB, then try again.')
      return
    }
    try {
      const contents = await file.text()
      const text = extension === 'srt' ? extractSubtitleText(contents) : contents.trim()
      if (!text) {
        setGenerationError('This file does not contain any lesson text.')
        return
      }
      if (text.length > 20000) {
        setGenerationError('Keep the extracted text under 20,000 characters so the local model can process it.')
        return
      }
      setSourceName(file.name)
      setSourceType(extension === 'srt' ? 'subtitle' : 'text')
      setSourceText(text)
      setGenerationError('')
    } catch {
      setGenerationError('This file could not be read. Try saving it as UTF-8 text and selecting it again.')
    }
  }
  const generateLesson = async (event) => {
    event.preventDefault()
    if (!sourceText.trim()) {
      setGenerationError('Choose a .txt or .srt file before generating a lesson.')
      return
    }
    if (sourceText.trim().length > 20000) {
      setGenerationError('Keep the source text under 20,000 characters.')
      return
    }
    setGenerating(true)
    setGenerationError('')
    try {
      throw new Error('AI lesson generation isn\'t available offline on this device. Use “Add lesson” to write one yourself.')
      const lesson = {
        ...body.lesson,
        id: `generated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        generated: true,
        sourceName: sourceName || 'Pasted lesson text',
        sourceType,
        createdAt: new Date().toISOString(),
      }
      if (!onSaveGenerated(lesson)) throw new Error('The lesson was generated but could not be saved in this browser. Check local storage space.')
      setLevel('My lessons')
      setSearch('')
      setSelectedId(lesson.id)
      resetPractice()
      setGenerationError('')
    } catch (error) {
      setGenerationError(error.message || 'The lesson could not be generated. Try again.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <section className="learning-page grammar-guide-page">
      <header className="learning-page-hero grammar-guide-hero">
        <span className="learning-hero-flower" aria-hidden="true">Aa</span>
        <span className="eyebrow"><span className="eyebrow-dot" /> YOUR ENGLISH, ONE RULE AT A TIME</span>
        <h1>Grammar guide<em> from basics to mastery.</em></h1>
        <p>Original, bite-sized lessons with examples and a quick check. Your lesson progress stays in this browser.</p>
        <div className="grammar-hero-bottom">
          <div className="learning-hero-stats">
            <span><strong>{allLessons.length}</strong> lessons</span>
            <span><strong>{completedCount}</strong> completed</span>
            <span><strong>{grammarLevels.length}</strong> learning levels</span>
          </div>
          <button type="button" className="add-lesson-button" onClick={openAddLesson}>
            <Icon name="plus" size={16} /> Add a lesson
          </button>
        </div>
      </header>
      {toast && <p className="grammar-toast" role="status">{toast}</p>}
      <form className="lesson-generator" onSubmit={generateLesson}>
        <div className="lesson-generator-heading">
          <div>
            <span className="section-kicker">LEARN FROM YOUR OWN MATERIAL</span>
            <h2>Turn text into a lesson <span aria-hidden="true">✦</span></h2>
            <p>Choose a .txt reading or .srt subtitle file. Ollama creates a study guide with vocabulary, examples, and a quick quiz. Files are read in your browser and sent only to your local Ollama service.</p>
          </div>
          <button type="button" className="lesson-file-button" onClick={() => sourceFileRef.current?.click()} disabled={generating}>
            <Icon name="plus" size={16} /> Choose .txt or .srt
          </button>
          <input ref={sourceFileRef} type="file" accept=".txt,.srt,text/plain,application/x-subrip" hidden onChange={readSourceFile} />
        </div>
        <label className="lesson-source-label">
          <span>{sourceName ? `Source: ${sourceName}` : 'Text to learn from'} <small>{sourceType === 'subtitle' ? 'Subtitle cues and timestamps are removed automatically.' : 'Maximum 20,000 characters.'}</small></span>
          <textarea
            value={sourceText}
            onChange={(event) => { setSourceText(event.target.value); setGenerationError('') }}
            placeholder="Choose a .txt or .srt file to preview its text here…"
            rows={5}
            maxLength={20000}
            disabled={generating}
          />
        </label>
        <div className="lesson-generator-footer">
          {generationError && <p role="alert">{generationError}</p>}
          <span>{sourceText.length.toLocaleString()} / 20,000 characters</span>
          <button type="submit" className="primary-button" disabled={generating || !sourceText.trim()}>{generating ? 'Creating lesson locally…' : 'Generate lesson'} <Icon name="arrow" size={16} /></button>
        </div>
      </form>
      <div className="grammar-guide-layout">
        <aside className="grammar-topic-panel" aria-label="Grammar topics">
          <label className="grammar-search">
            <span>Find a topic</span>
            <input type="search" value={search} onChange={(event) => changeSearch(event.target.value)} placeholder="Try “tenses” or “articles”" />
          </label>
          <label className="grammar-level-filter">
            <span>Learning level</span>
            <select value={level} onChange={(event) => changeLevel(event.target.value)}>
              <option>All levels</option>
              <option>My lessons</option>
              {grammarLevels.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <div className="grammar-topic-list">
            {visibleLessons.map((lesson) => (
              <button
                type="button"
                key={lesson.id}
                className={selectedLesson?.id === lesson.id ? 'active' : ''}
                aria-current={selectedLesson?.id === lesson.id ? 'page' : undefined}
                onClick={() => selectLesson(lesson)}
              >
                <span className="grammar-topic-check" aria-label={progress[lesson.id]?.completed ? 'Completed' : 'Not completed'}>{progress[lesson.id]?.completed ? '✓' : '·'}</span>
                <span><small>{lesson.custom ? `My lesson · ${formatDate(lesson.date)}` : lesson.level}</small><strong>{lesson.title}</strong></span>
              </button>
            ))}
            {!visibleLessons.length && <p className="grammar-no-topics">No topics match. Try another search or level.</p>}
          </div>
          <p className="grammar-content-note">Built-in lessons are original. Your own and generated lessons are saved only in this browser.</p>
        </aside>

        <article className="grammar-lesson">
          {selectedLesson ? (
            <>
          <header className="grammar-lesson-header">
            <span className="section-kicker">{selectedLesson.custom ? `MY LESSON · ${formatDate(selectedLesson.date)}` : `${selectedLesson.level.toUpperCase()} GRAMMAR`}</span>
            <h2>{selectedLesson.title}</h2>
            {selectedLesson.summary && <p>{selectedLesson.summary}</p>}
            {progress[selectedLesson.id]?.completed && <span className="grammar-completed-badge"><Icon name="check" size={14} /> Completed · best score {progress[selectedLesson.id].bestScore}/1</span>}
            {selectedLesson.generated && <div className="generated-lesson-meta"><span>{selectedLesson.custom ? 'Added by you' : <>Made from {selectedLesson.sourceType === 'subtitle' ? 'subtitles' : 'text'} · {selectedLesson.sourceName}</>}</span><div className="generated-lesson-actions">{selectedLesson.custom && <button type="button" onClick={() => openEditLesson(selectedLesson)}>Edit lesson</button>}<button type="button" onClick={() => deleteLesson(selectedLesson.id)}>Delete lesson</button></div></div>}
          </header>
          {selectedLesson.explanation && (
            <section className="grammar-explanation">
              <h3>The idea</h3>
              <p>{selectedLesson.explanation}</p>
            </section>
          )}
          {selectedLesson.examples?.length > 0 && (
            <section className="grammar-examples">
              <h3>Examples</h3>
              <ul>{selectedLesson.examples.map((example) => <li key={example}>{example}</li>)}</ul>
            </section>
          )}
          {selectedLesson.vocabulary?.length > 0 && (
            <section className="grammar-vocabulary">
              <h3>Useful vocabulary</h3>
              <ul>{selectedLesson.vocabulary.map((item) => <li key={item.word}><strong>{item.word}</strong><span>{item.meaning}</span><em>{item.example}</em></li>)}</ul>
            </section>
          )}
          {selectedLesson.commonMistakes?.length > 0 && (
            <section className="grammar-mistakes">
              <h3>Watch out for</h3>
              <ul>{selectedLesson.commonMistakes.map((mistake) => <li key={mistake}>{mistake}</li>)}</ul>
            </section>
          )}
          {practiceQuestion && (
            <section className="grammar-practice" aria-labelledby="grammar-practice-title">
              <span className="section-kicker">QUICK CHECK</span>
              <h3 id="grammar-practice-title">{practiceQuestion.prompt}</h3>
              <div className="grammar-answer-options">
                {practiceQuestion.options.map((option, index) => {
                  const isCorrect = index === correctAnswer
                  const answerState = showResult && isCorrect ? 'correct' : showResult && selectedAnswer === index ? 'incorrect' : ''
                  return (
                    <button
                      type="button"
                      key={option}
                      className={answerState}
                      aria-pressed={selectedAnswer === index}
                      disabled={showResult}
                      onClick={() => setSelectedAnswer(index)}
                    >{option}</button>
                  )
                })}
              </div>
              {showResult && (
                <p className={`grammar-answer-feedback ${answeredCorrectly ? 'correct' : 'incorrect'}`} role="status">
                  <strong>{answeredCorrectly ? 'That’s right!' : `Not quite. The answer is “${practiceQuestion.options[correctAnswer].replace(/[.!?]+$/, '')}.”`}</strong>
                  {' '}{practiceQuestion.explanation}
                </p>
              )}
              <div className="grammar-practice-actions">
                {showResult ? (
                  <button type="button" className="reveal-answer-button" onClick={tryAgain}>Try this question again</button>
                ) : (
                  <button type="button" className="reveal-answer-button" disabled={selectedAnswer === null} onClick={submitAnswer}>Check answer <Icon name="arrow" size={15} /></button>
                )}
                {progress[selectedLesson.id]?.attempts > 0 && <span>{progress[selectedLesson.id].attempts} attempt{progress[selectedLesson.id].attempts === 1 ? '' : 's'}</span>}
              </div>
            </section>
          )}
          <footer className="grammar-references">
            {selectedLesson.custom ? (
              <p>Your own lesson note, saved only in this browser. Find it again under “My lessons”.</p>
            ) : selectedLesson.generated ? (
              <p>This lesson was generated locally from your material. Review it critically, as AI-generated explanations may occasionally be inaccurate.</p>
            ) : (
              <>
                <h3>Further reading</h3>
                <p>Lesson text and examples are original to this app. These trusted references can help you explore the topic further.</p>
                <div>
                  {[...new Set(selectedLesson.references)].map((url) => {
                    const label = url.includes('britishcouncil.org') ? 'British Council LearnEnglish' : url.includes('owl.purdue.edu') ? 'Purdue OWL' : 'Cambridge Dictionary Grammar'
                    return <a key={url} href={url} target="_blank" rel="noreferrer">{label} ↗</a>
                  })}
                </div>
              </>
            )}
          </footer>
            </>
          ) : (
            <div className="grammar-no-topics grammar-no-results" role="status">
              <h2>No lesson matches that search</h2>
              <p>Try a different topic or switch to another learning level.</p>
            </div>
          )}
        </article>
      </div>
      {addLessonOpen && (
        <div className="modal-backdrop add-lesson-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAddLesson() }}>
          <form className="category-item-modal add-lesson-modal" onSubmit={saveCustomLesson}>
            <header className="modal-header">
              <div>
                <span className="section-kicker">{editingLessonId ? 'EDIT YOUR LESSON' : 'YOUR OWN GRAMMAR NOTE'}</span>
                <h2>{editingLessonId ? 'Keep it growing.' : 'Add a lesson.'}</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Close add lesson form" onClick={closeAddLesson}><Icon name="close" /></button>
            </header>
            {customLessonError && <p className="ai-error" role="alert">{customLessonError}</p>}
            <label className="category-item-field">LESSON HEADING
              <input autoFocus required maxLength={120} value={customLessonDraft.title} onChange={(event) => { setCustomLessonDraft({ ...customLessonDraft, title: event.target.value }); setCustomLessonError('') }} placeholder="e.g. When to use the past perfect" />
            </label>
            <div className="category-item-fields-grid">
              <label className="category-item-field">DATE
                <input type="date" required value={customLessonDraft.date} onChange={(event) => setCustomLessonDraft({ ...customLessonDraft, date: event.target.value })} />
              </label>
              <label className="category-item-field">LEVEL
                <select value={customLessonDraft.level} onChange={(event) => setCustomLessonDraft({ ...customLessonDraft, level: event.target.value })}>
                  {grammarLevels.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
            </div>
            <label className="category-item-field">SHORT SUMMARY <span>(OPTIONAL)</span>
              <input maxLength={300} value={customLessonDraft.summary} onChange={(event) => setCustomLessonDraft({ ...customLessonDraft, summary: event.target.value })} placeholder="One line about what this lesson covers" />
            </label>
            <label className="category-item-field">THE LESSON <span>(OPTIONAL)</span>
              <textarea rows={6} maxLength={20000} value={customLessonDraft.explanation} onChange={(event) => setCustomLessonDraft({ ...customLessonDraft, explanation: event.target.value })} placeholder="Write the rule in your own words, with any notes you want to keep." />
            </label>
            <label className="category-item-field">EXAMPLES <span>(ONE PER LINE)</span>
              <textarea rows={3} maxLength={2000} value={customLessonDraft.examplesText} onChange={(event) => setCustomLessonDraft({ ...customLessonDraft, examplesText: event.target.value })} placeholder={'She had left before I arrived.\nI have been learning English for two years.'} />
            </label>
            <label className="category-item-field">WATCH OUT FOR <span>(ONE PER LINE)</span>
              <textarea rows={2} maxLength={1500} value={customLessonDraft.mistakesText} onChange={(event) => setCustomLessonDraft({ ...customLessonDraft, mistakesText: event.target.value })} placeholder="Common mistakes to remember" />
            </label>
            <fieldset className="custom-quiz-builder">
              <legend>QUICK CHECK <span>(OPTIONAL)</span></legend>
              <p>Add one multiple-choice question so this lesson can be completed and tracked like the built-in lessons. Leave every quiz field empty to skip it.</p>
              <label className="category-item-field">QUESTION
                <input maxLength={300} value={customLessonDraft.questionPrompt} onChange={(event) => setCustomLessonDraft({ ...customLessonDraft, questionPrompt: event.target.value })} placeholder="e.g. Which sentence uses the past perfect correctly?" />
              </label>
              <div className="custom-quiz-options">
                {quizOptionKeys.map((key, index) => (
                  <div className={`custom-quiz-option ${customLessonDraft.correctOption === String(index) ? 'is-correct' : ''}`} key={key}>
                    <label className="custom-quiz-choice" title={`Mark option ${quizOptionLetters[index]} as correct`}>
                      <input type="radio" name="custom-quiz-answer" checked={customLessonDraft.correctOption === String(index)} onChange={() => setCustomLessonDraft({ ...customLessonDraft, correctOption: String(index) })} aria-label={`Mark option ${quizOptionLetters[index]} as the correct answer`} />
                      <span>{quizOptionLetters[index]}</span>
                    </label>
                    <input type="text" maxLength={200} value={customLessonDraft[key]} onChange={(event) => updateQuizOption(index, event.target.value)} placeholder={`Answer option ${quizOptionLetters[index]}`} aria-label={`Answer option ${quizOptionLetters[index]}`} />
                  </div>
                ))}
              </div>
              <small className="custom-quiz-hint">Choose the letter beside the correct answer.</small>
              <label className="category-item-field">WHY THIS ANSWER IS RIGHT <span>(OPTIONAL)</span>
                <input maxLength={500} value={customLessonDraft.questionExplanation} onChange={(event) => setCustomLessonDraft({ ...customLessonDraft, questionExplanation: event.target.value })} placeholder="Explain the answer in one short sentence" />
              </label>
              {quizHasContent && <button type="button" className="custom-quiz-clear" onClick={clearQuiz}>Clear quick check</button>}
            </fieldset>
            <footer className="category-item-actions">
              <button className="cancel-word-edit" type="button" onClick={closeAddLesson}>Cancel</button>
              <button className="primary-button save-button" type="submit" disabled={!customLessonDraft.title.trim() || !customLessonDraft.date}>{editingLessonId ? 'Save changes' : 'Add lesson'} <Icon name="check" size={16} /></button>
            </footer>
          </form>
        </div>
      )}
    </section>
  )
}

function NotebookSettings({ preferences, setPreferences, onExportJson, onExportHtml, onExportPdf, shortcutHelp }) {
  const setPreference = (key, value) => {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    localStorage.setItem('littlelingo-settings', JSON.stringify(next))
  }
  return (
    <section className="learning-page settings-page">
      <header className="learning-page-hero">
        <span className="learning-hero-flower" aria-hidden="true">✧</span>
        <span className="eyebrow"><span className="eyebrow-dot" /> MAKE THIS SPACE YOURS</span>
        <h1>Notebook<em> settings.</em></h1>
        <p>Choose your journal’s look, keep a backup, and learn a few handy shortcuts.</p>
      </header>
      <div className="settings-grid">
        <section className="settings-card">
          <span className="section-kicker">YOUR JOURNAL LOOK</span>
          <h2>Make it feel like yours</h2>
          <label>Notebook theme<select value={preferences.theme} onChange={(event) => setPreference('theme', event.target.value)}><option value="garden">Garden blush</option><option value="meadow">Meadow sage</option><option value="lavender">Lavender dusk</option><option value="midnight">Midnight ink</option></select></label>
          <label>Paper color<select value={preferences.paper} onChange={(event) => setPreference('paper', event.target.value)}><option value="cream">Warm cream</option><option value="rose">Petal pink</option><option value="sage">Soft sage</option><option value="white">Classic white</option></select></label>
          <label>Writing lines<select value={preferences.lines} onChange={(event) => setPreference('lines', event.target.value)}><option value="ruled">Ruled lines</option><option value="dotted">Dotted</option><option value="plain">Plain paper</option></select></label>
        </section>
        <section className="settings-card">
          <span className="section-kicker">KEEP YOUR WORK SAFE</span>
          <h2>Export your notebook</h2>
          <p>Backups are generated in your browser and stay on this computer.</p>
          <div className="export-actions"><button type="button" onClick={onExportJson}>Download JSON backup</button><button type="button" onClick={onExportHtml}>Download HTML notebook</button><button type="button" onClick={onExportPdf}>Print / Save as PDF</button></div>
        </section>
        <section className="settings-card shortcuts-card">
          <span className="section-kicker">QUICK KEYS</span><h2>Keyboard shortcuts</h2>
          {shortcutHelp.map(({ keys, label }) => <p className="shortcut-row" key={keys}><kbd>{keys}</kbd><span>{label}</span></p>)}
          <p className="draft-help">While editing, changes are also saved as a local draft in this browser.</p>
        </section>
      </div>
    </section>
  )
}

function Icon({ name, size = 20 }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
    sparkle: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" /></>,
    edit: <><path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    bookOpen: <><path d="M12 7v14" /><path d="M3 18V5a2 2 0 0 1 2-2h3a4 4 0 0 1 4 4 4 4 0 0 1 4-4h3a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-4a3 3 0 0 0-3 2 3 3 0 0 0-3-2H5a2 2 0 0 1-2-2Z" /></>,
    cards: <><rect x="4" y="4" width="13" height="16" rx="2" /><path d="M8 8h5M8 12h5M19 7h1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18m-13 4h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    heart: <path d="M20.8 5.1a5.4 5.4 0 0 0-7.6 0L12 6.3l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.3a5.4 5.4 0 0 0 0-7.6Z" />,
    chart: <><path d="M4 20V11M10 20V5M16 20v-7M22 20H2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>,
  }
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

function CategoryEntryForm({ category, value, onChange, onSubmit, onCancel, submitLabel, busy, error, autoFocus = false }) {
  const config = categoryForm(category)
  const set = (field, fieldValue) => onChange(categoryDetailUpdate(value, field, fieldValue))
  const canSubmit = Boolean(value.word.trim() && value.meaning.trim()) && !busy
  const renderDetail = (field) => {
    const detail = categoryDetailFields[field]
    if (!detail) return null
    if (detail.options) {
      return (
        <label className="category-entry-field" key={field}>
          <span>{detail.label}</span>
          <select value={categoryDetailValue(value, field)} onChange={(event) => set(field, event.target.value)}>
            {detail.options.map((option) => <option key={option || 'none'} value={option}>{detail.optionLabels[option] || option}</option>)}
          </select>
        </label>
      )
    }
    // Notes and stories are longer than a single line, so they wrap instead of
    // truncating their placeholder on narrow screens.
    if (field === 'usageNote' || field === 'origin') {
      return (
        <label className="category-entry-field category-entry-field-wide" key={field}>
          <span>{detail.label}</span>
          <textarea rows={2} maxLength={300} value={categoryDetailValue(value, field)} onChange={(event) => set(field, event.target.value)} placeholder={detail.placeholder} />
        </label>
      )
    }
    return (
      <label className="category-entry-field" key={field}>
        <span>{detail.label}</span>
        <input maxLength={120} value={categoryDetailValue(value, field)} onChange={(event) => set(field, event.target.value)} placeholder={detail.placeholder} />
      </label>
    )
  }

  return (
    <form className={`category-entry-form category-entry-form-${category}`} onSubmit={onSubmit}>
      <div className="category-entry-form-heading">
        <span className="category-entry-form-icon" aria-hidden="true">✿</span>
        <div>
          <span className="section-kicker">NEW {config.entryLabel.toUpperCase()}</span>
          <h2>Add {articleFor(config.entryLabel)} {config.entryLabel.toLowerCase()}</h2>
          <p>Saved straight into your {categoryLabel(category).toLowerCase()} collection.</p>
        </div>
      </div>
      {error && <p className="ai-error" role="alert">{error}</p>}
      <div className="category-entry-grid">
        <label className="category-entry-field category-entry-field-wide">
          <span>{config.entryLabel}</span>
          <input autoFocus={autoFocus} required maxLength={100} value={value.word} onChange={(event) => set('word', event.target.value)} placeholder={config.entryPlaceholder} />
        </label>
        <label className="category-entry-field category-entry-field-wide">
          <span>{config.meaningLabel}</span>
          <textarea required maxLength={500} rows={2} value={value.meaning} onChange={(event) => set('meaning', event.target.value)} placeholder={config.meaningPlaceholder} />
        </label>
        <label className="category-entry-field category-entry-field-wide">
          <span>{config.exampleLabel} <small>one per line</small></span>
          <textarea maxLength={2000} rows={2} value={value.examplesText} onChange={(event) => set('examplesText', event.target.value)} placeholder={config.examplePlaceholder} />
        </label>
        {config.fields.map(renderDetail)}
        <label className="category-entry-field">
          <span>Tags</span>
          <input maxLength={400} value={value.tagsText} onChange={(event) => set('tagsText', event.target.value)} placeholder="Comma-separated" />
        </label>
        <label className="category-entry-field">
          <span>Difficulty</span>
          <select value={value.difficulty} onChange={(event) => set('difficulty', event.target.value)}><option value="">Not set</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select>
        </label>
        <label className="category-entry-field category-entry-field-wide">
          <span>Learning goal</span>
          <input maxLength={100} value={value.learningGoal} onChange={(event) => set('learningGoal', event.target.value)} placeholder="e.g. Use it in my next email" />
        </label>
      </div>
      <div className="category-entry-form-footer">
        <label className="favorite-check"><input type="checkbox" checked={value.favorite} onChange={(event) => set('favorite', event.target.checked)} /> Mark as a favorite</label>
        <div className="category-entry-form-actions">
          {onCancel && <button type="button" className="cancel-word-edit" onClick={onCancel} disabled={busy}>Cancel</button>}
          <button type="submit" className="primary-button save-button" disabled={!canSubmit}>
            <Icon name={busy ? 'check' : 'plus'} size={16} /> {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </form>
  )
}

function RichEditor({ initialContent, onUpload, onChange }) {
  const editorRef = useRef(null)
  const fileRef = useRef(null)
  const savedRangeRef = useRef(null)
  const [stickersOpen, setStickersOpen] = useState(false)
  const [stickerGroup, setStickerGroup] = useState('all')
  const [stickerSearch, setStickerSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [aiText, setAiText] = useState('')
  const [explanation, setExplanation] = useState('')
  const [aiError, setAiError] = useState('')
  const [explaining, setExplaining] = useState(false)
  const [writingFeedback, setWritingFeedback] = useState('')
  const [feedbackError, setFeedbackError] = useState('')
  const [gettingFeedback, setGettingFeedback] = useState(false)

  const format = (command, value) => {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
  }

  const captureEditorSelection = () => {
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    if (range && editorRef.current?.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange()
    }
  }

  const insertSticker = (sticker) => {
    const editor = editorRef.current
    if (!editor) return
    const selection = window.getSelection()
    let range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = savedRangeRef.current?.cloneRange() || document.createRange()
      if (!savedRangeRef.current) {
        range.selectNodeContents(editor)
        range.collapse(false)
      }
    }

    range.deleteContents()
    const stickerElement = document.createElement('span')
    stickerElement.className = 'page-sticker'
    stickerElement.dataset.stickerId = sticker.id
    stickerElement.contentEditable = 'false'
    stickerElement.title = 'Click to remove sticker'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 100 100')
    svg.setAttribute('aria-hidden', 'true')
    svg.classList.add('sticker-art')
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('href', `/stickers.svg#${sticker.id}`)
    svg.append(use)
    stickerElement.append(svg)
    const spacer = document.createTextNode(' ')
    range.insertNode(spacer)
    range.insertNode(stickerElement)
    range.setStartAfter(spacer)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
    savedRangeRef.current = range.cloneRange()
    setStickersOpen(false)
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }

  const filteredStickers = pageStickers.filter((sticker) => (
    (stickerGroup === 'all' || sticker.group === stickerGroup)
    && (!stickerSearch.trim() || `${sticker.label} ${sticker.id}`.toLowerCase().includes(stickerSearch.trim().toLowerCase()))
  ))

  const removeSticker = (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const sticker = target.closest('.page-sticker')
    if (!sticker || !editorRef.current?.contains(sticker)) return
    sticker.remove()
    editorRef.current.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }

  const addLink = () => {
    const url = window.prompt('Paste the link URL')
    if (!url) return
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol')
      format('createLink', parsed.href)
    } catch {
      setUploadError('Please enter a valid link starting with https://')
    }
  }

  const useSelectedText = () => {
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const selectedText = range && editorRef.current?.contains(range.commonAncestorContainer)
      ? selection.toString().trim()
      : ''
    if (!selectedText) {
      setAiError('Select a word or sentence in your writing, or type it below.')
      return
    }
    setAiText(selectedText.slice(0, 1000))
    setAiError('')
    setExplanation('')
  }

  const explainText = async () => {
    const text = aiText.trim()
    if (!text) {
      setAiError('Type a word or sentence to explain.')
      return
    }
    setExplaining(true)
    setAiError('')
    setExplanation('')
    try {
      setExplanation(`AI explanation isn't available offline on this device. In the meantime, “${text}” is a great word to look up — try writing your own example sentence.`)
    } catch (error) {
      setAiError(error.message)
    } finally {
      setExplaining(false)
    }
  }

  const reviewWriting = async () => {
    const text = editorRef.current?.innerText.trim() || ''
    if (!text) {
      setFeedbackError('Write a few sentences first, then ask for feedback.')
      return
    }
    if (text.length > 5000) {
      setFeedbackError('Please keep the writing sample under 5,000 characters.')
      return
    }
    setGettingFeedback(true)
    setFeedbackError('')
    setWritingFeedback('')
    try {
      setWritingFeedback(`AI feedback isn't available offline on this device. Your writing is saved locally — read it aloud to check clarity and flow yourself.`)
    } catch (feedbackRequestError) {
      setFeedbackError(feedbackRequestError.message)
    } finally {
      setGettingFeedback(false)
    }
  }

  const uploadImage = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      const imageUrl = await onUpload(file)
      const image = document.createElement('img')
      image.src = imageUrl
      image.alt = file.name
      image.className = 'editor-image'
      editorRef.current?.append(image)
      editorRef.current?.dispatchEvent(new InputEvent('input', { bubbles: true }))
    } catch (error) {
      setUploadError(error.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="editor-wrap">
      <div className="editor-toolbar" aria-label="Text formatting">
        <select aria-label="Font family" defaultValue="Georgia" onChange={(event) => format('fontName', event.target.value)}>
          <option value="Georgia">Georgia</option>
          <option value="Arial">Arial</option>
          <option value="Verdana">Verdana</option>
          <option value="Trebuchet MS">Trebuchet</option>
          <option value="Courier New">Courier</option>
        </select>
        <span className="toolbar-divider" />
        <button type="button" aria-label="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => format('bold')}><strong>B</strong></button>
        <button type="button" aria-label="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => format('italic')}><em>I</em></button>
        <button type="button" aria-label="Underline" onMouseDown={(event) => event.preventDefault()} onClick={() => format('underline')}><u>U</u></button>
        <button type="button" aria-label="Bulleted list" onMouseDown={(event) => event.preventDefault()} onClick={() => format('insertUnorderedList')}>• List</button>
        <span className="toolbar-divider" />
        <button type="button" aria-label="Add link" onMouseDown={(event) => event.preventDefault()} onClick={addLink}><Icon name="link" size={16} /></button>
        <button type="button" aria-label="Add image" onMouseDown={(event) => event.preventDefault()} onClick={() => fileRef.current?.click()}><Icon name="image" size={16} /></button>
        <button type="button" className="toolbar-ai-button sticker-toggle" aria-expanded={stickersOpen} onMouseDown={(event) => event.preventDefault()} onClick={() => setStickersOpen((open) => !open)}><span aria-hidden="true">🌼</span><span>Stickers</span></button>
        <button type="button" className="toolbar-ai-button" aria-label="Explain selected text" onMouseDown={(event) => event.preventDefault()} onClick={useSelectedText}><Icon name="sparkle" size={15} /><span>Explain selection</span></button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={uploadImage} />
      </div>
      {stickersOpen && (
        <div className="sticker-picker" aria-label="Page stickers">
          <div className="sticker-picker-heading"><div><strong>Little sticker garden</strong><span>{pageStickers.length} illustrated stickers · Click one to add it to your page.</span></div>
            <label className="sticker-search"><Icon name="search" size={14} /><input value={stickerSearch} onChange={(event) => setStickerSearch(event.target.value)} placeholder="Find a sticker…" aria-label="Search stickers" onMouseDown={captureEditorSelection} /></label>
          </div>
          <div className="sticker-group-tabs" role="tablist" aria-label="Sticker collections">
            <button type="button" role="tab" aria-selected={stickerGroup === 'all'} className={stickerGroup === 'all' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => setStickerGroup('all')}>All <span>{pageStickers.length}</span></button>
            {stickerGroups.map((group) => (
              <button key={group.id} type="button" role="tab" aria-selected={stickerGroup === group.id} className={stickerGroup === group.id ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => setStickerGroup(group.id)}>{group.label}</button>
            ))}
          </div>
          <div className="sticker-group-description">
            {stickerGroup === 'all' ? 'Cottagecore keepsakes, individual blooms, pressed flowers, antique specimen cards, and chunky kawaii art.' : stickerGroups.find((group) => group.id === stickerGroup)?.description}
          </div>
          <div className="sticker-picker-grid">
            {filteredStickers.map((sticker) => (
              <button key={sticker.id} type="button" title={sticker.label} aria-label={`Add ${sticker.label} sticker`} onMouseDown={(event) => event.preventDefault()} onClick={() => insertSticker(sticker)}>
                {stickerPreview(sticker, 'sticker-preview')}
                <span>{sticker.label}</span>
              </button>
            ))}
            {!filteredStickers.length && <p className="sticker-empty">No stickers found. Try another search.</p>}
          </div>
        </div>
      )}
      {uploading && <p className="upload-hint">Adding your photo…</p>}
      {uploadError && <p className="inline-error" role="alert">{uploadError}</p>}
      <div className="ai-helper">
        <div className="ai-helper-heading">
          <span className="ai-helper-icon"><Icon name="sparkle" size={16} /></span>
          <div><strong>English word helper</strong><span>Private and powered by AI on your computer</span></div>
          <span className="local-ai-badge">LOCAL AI</span>
        </div>
        <div className="ai-question-row">
          <input
            value={aiText}
            onChange={(event) => setAiText(event.target.value)}
            maxLength={1000}
            placeholder="Type a word or sentence to understand…"
            aria-label="Word or sentence to explain"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                explainText()
              }
            }}
          />
          <button type="button" className="ai-explain-button" onClick={explainText} disabled={explaining || !aiText.trim()}>
            <Icon name="sparkle" size={15} /> {explaining ? 'Thinking…' : 'Explain'}
          </button>
        </div>
        {explaining && <p className="ai-status" role="status">Your local tutor is preparing a clear explanation…</p>}
        {aiError && <p className="ai-error" role="alert">{aiError}</p>}
        {explanation && <div className="ai-answer" role="status"><strong>Here’s what it means</strong><p>{explanation}</p></div>}
        <div className="writing-feedback-action"><button type="button" className="ai-explain-button" onClick={reviewWriting} disabled={gettingFeedback}><Icon name="sparkle" size={15} />{gettingFeedback ? 'Reviewing…' : 'Grammar & clarity feedback'}</button><span>Suggestions only — your original stays unchanged.</span></div>
        {feedbackError && <p className="ai-error" role="alert">{feedbackError}</p>}
        {writingFeedback && <div className="ai-answer writing-feedback-answer" role="status"><strong>Suggestions for your writing</strong><p>{writingFeedback}</p></div>}
      </div>
      <div
        ref={(element) => {
          editorRef.current = element
          if (element && !element.dataset.initialized) {
            element.innerHTML = safeHtml(initialContent)
            hydratePageStickers(element)
            element.dataset.initialized = 'true'
          }
        }}
        className="writing-paper"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Your notebook entry"
        aria-multiline="true"
        data-placeholder="Start writing here… A new word, a thought, a story — this page is yours."
        onInput={(event) => { onChange(event.currentTarget.innerHTML); captureEditorSelection() }}
        onClick={removeSticker}
        onKeyUp={captureEditorSelection}
        onMouseUp={captureEditorSelection}
      />
    </div>
  )
}

function YouGlishPlayer({ word, onClose }) {
  const widgetAnchorRef = useRef(null)
  const widgetRef = useRef(null)
  const initializedRef = useRef(false)
  const activeRef = useRef(false)
  const [status, setStatus] = useState('Loading YouGlish pronunciation examples…')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    activeRef.current = true
    initializedRef.current = false
    const scriptUrl = 'https://youglish.com/public/emb/widget.js'
    const initializeWidget = () => {
      const api = window.YG
      if (!activeRef.current || initializedRef.current || !widgetAnchorRef.current || typeof api?.getWidget !== 'function') return false
      initializedRef.current = true
      try {
        widgetRef.current = api.getWidget('yg-widget-0')
        if (!widgetRef.current || typeof widgetRef.current.fetch !== 'function') {
          setLoadError('The YouGlish player did not initialize. Try opening the examples directly on YouGlish.')
          return false
        }
        widgetRef.current.fetch(word, 'english')
        setStatus('Search submitted. Video playback depends on your internet connection and browser support.')
        return true
      } catch {
        if (activeRef.current) setLoadError('YouGlish could not start the pronunciation player. Try opening the examples on YouGlish instead.')
        return false
      }
    }

    const previousReady = window.onYouglishAPIReady
    const handleApiReady = () => {
      previousReady?.()
      if (!initializeWidget() && activeRef.current && !initializedRef.current) {
        setLoadError('The YouGlish API loaded, but the pronunciation player is unavailable. Try opening the examples directly on YouGlish.')
      }
    }
    window.onYouglishAPIReady = handleApiReady

    if (!initializeWidget()) {
      let script = document.querySelector(`script[src="${scriptUrl}"]`)
      if (!script) {
        script = document.createElement('script')
        script.src = scriptUrl
        script.async = true
        script.charset = 'utf-8'
        document.head.appendChild(script)
      }
      const handleScriptError = () => {
        if (activeRef.current) setLoadError('Could not connect to YouGlish. Check your internet connection and try again.')
      }
      script.addEventListener('error', handleScriptError, { once: true })
      return () => {
        activeRef.current = false
        script.removeEventListener('error', handleScriptError)
        if (window.onYouglishAPIReady === handleApiReady) window.onYouglishAPIReady = previousReady
      }
    }

    return () => {
      activeRef.current = false
      if (window.onYouglishAPIReady === handleApiReady) window.onYouglishAPIReady = previousReady
    }
  }, [word])

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="youglish-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="youglish-modal" role="dialog" aria-modal="true" aria-labelledby="youglish-title">
        <header className="youglish-modal-header">
          <div><span className="section-kicker">HEAR IT IN REAL ENGLISH</span><h2 id="youglish-title">YouGlish examples</h2><p>Listen to “{word}” in real-world English videos.</p></div>
          <button type="button" className="icon-button" aria-label="Close YouGlish player" onClick={onClose}><Icon name="close" /></button>
        </header>
        {loadError ? (
          <div className="youglish-error" role="alert">
            <p>{loadError}</p>
            <a href={`https://youglish.com/pronounce/${encodeURIComponent(word)}/english`} target="_blank" rel="noreferrer">Search “{word}” on YouGlish</a>
          </div>
        ) : (
          <>
            <div className="youglish-widget-frame">
              <a
                ref={widgetAnchorRef}
                id="yg-widget-0"
                className="youglish-widget"
                data-components="89"
                data-delay-load="1"
                href="https://youglish.com"
              >Visit YouGlish</a>
            </div>
            <p className="youglish-status" role="status">{status}</p>
          </>
        )}
        <footer className="youglish-modal-footer">
          <span>Provided by YouGlish. Video examples require an internet connection.</span>
          <a href={`https://youglish.com/pronounce/${encodeURIComponent(word)}/english`} target="_blank" rel="noreferrer">Open on YouGlish</a>
        </footer>
      </section>
    </div>
  )
}

function App() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [todayLabel] = useState(() => new Date().toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }))
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [section, setSection] = useState('home')
  const [navOpen, setNavOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [tagFilter, setTagFilter] = useState('')
  const [difficultyFilter, setDifficultyFilter] = useState('')
  const [trashEntries, setTrashEntries] = useState([])
  const [trashLoading, setTrashLoading] = useState(false)
  const [trashError, setTrashError] = useState('')
  const [preferences, setPreferences] = useState(() => {
    try {
      return { theme: 'garden', paper: 'cream', lines: 'ruled', ...JSON.parse(localStorage.getItem('littlelingo-settings') || '{}') }
    } catch {
      return { theme: 'garden', paper: 'cream', lines: 'ruled' }
    }
  })
  const [editorOpen, setEditorOpen] = useState(false)
  const [viewingEntryId, setViewingEntryId] = useState(null)
  const [form, setForm] = useState(emptyEntry)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [vocabularyForm, setVocabularyForm] = useState(emptyVocabularyForm())
  const [editingVocabularyIndex, setEditingVocabularyIndex] = useState(null)
  const [categoryItemEditor, setCategoryItemEditor] = useState(null)
  const [categoryItemSaving, setCategoryItemSaving] = useState(false)
  const [categoryEntryForm, setCategoryEntryForm] = useState(() => emptyVocabularyForm('word'))
  const [categoryEntrySaving, setCategoryEntrySaving] = useState(false)
  const [categoryEntryError, setCategoryEntryError] = useState('')
  const [reviewBusyKey, setReviewBusyKey] = useState('')
  const [reviewClock, setReviewClock] = useState(() => Date.now())
  const [youglishWord, setYouglishWord] = useState('')
  const [grammarProgress, setGrammarProgress] = useState(loadGrammarProgress)
  const [generatedLessons, setGeneratedLessons] = useState(loadGeneratedLessons)
  const [draftStatus, setDraftStatus] = useState('saved')
  const [draftRecoveryAvailable, setDraftRecoveryAvailable] = useState(hasLocalDraft)
  const editorFormRef = useRef(null)
  const notebookTouchStartRef = useRef(null)
  const pageTurnTimerRef = useRef(null)
  const openNewEntryRef = useRef(() => {})
  const searchInputRef = useRef(null)
  const [pageTurnDirection, setPageTurnDirection] = useState('')
  const orderedNotebookEntries = useMemo(
    () => [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || (a.updatedAt || '').localeCompare(b.updatedAt || '')),
    [entries],
  )
  const turnNotebookPage = useCallback((direction) => {
    const currentIndex = orderedNotebookEntries.findIndex((entry) => entry._id === viewingEntryId)
    const nextEntry = orderedNotebookEntries[currentIndex + direction]
    if (!nextEntry) return
    window.clearTimeout(pageTurnTimerRef.current)
    setPageTurnDirection(direction > 0 ? 'forward' : 'backward')
    setViewingEntryId(nextEntry._id)
    pageTurnTimerRef.current = window.setTimeout(() => setPageTurnDirection(''), 520)
  }, [orderedNotebookEntries, viewingEntryId])

  useEffect(() => {
    let active = true
    requestEntries()
      .then((items) => {
        if (active) {
          setEntries(items)
          setError('')
        }
      })
      .catch((loadError) => {
        if (active) setError(`${loadError.message} Check that the server is running and MongoDB is configured.`)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const focusSearch = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        openNewEntryRef.current()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (editorOpen) {
          event.preventDefault()
          editorFormRef.current?.requestSubmit()
        }
      } else if (event.key === 'Escape') {
        if (navOpen) setNavOpen(false)
        if (editorOpen) setEditorOpen(false)
        if (viewingEntryId) setViewingEntryId(null)
        if (categoryItemEditor) setCategoryItemEditor(null)
      } else if (viewingEntryId && event.key === 'ArrowLeft') {
        event.preventDefault()
        turnNotebookPage(-1)
      } else if (viewingEntryId && event.key === 'ArrowRight') {
        event.preventDefault()
        turnNotebookPage(1)
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [editorOpen, viewingEntryId, categoryItemEditor, navOpen, turnNotebookPage])

  // Stop the page behind the mobile navigation drawer from scrolling.
  useEffect(() => {
    if (!navOpen) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [navOpen])

  useEffect(() => {
    if (section !== 'trash') return
    let active = true
    storage.getTrash()
      .then((items) => { if (active) setTrashEntries(items) })
      .catch((loadError) => { if (active) setTrashError(loadError.message) })
      .finally(() => { if (active) setTrashLoading(false) })
    return () => { active = false }
  }, [section])

  useEffect(() => {
    if (!editorOpen) return
    const hasDraftContent = form.title || form.content || form.vocabulary?.length
    if (!hasDraftContent) return
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem('littlelingo-draft', JSON.stringify({ ...form, savedAt: new Date().toISOString() }))
        setDraftStatus('saved')
        setDraftRecoveryAvailable(true)
      } catch {
        setDraftStatus('error')
      }
    }, 700)
    return () => window.clearTimeout(timer)
  }, [editorOpen, form])

  useEffect(() => {
    const timer = window.setInterval(() => setReviewClock(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const loadEntries = () => {
    setLoading(true)
    setError('')
    requestEntries()
      .then(setEntries)
      .catch((loadError) => setError(loadError.message || 'Could not load your notebook.'))
      .finally(() => setLoading(false))
  }

  const refreshTrash = async () => {
    setTrashEntries(await storage.getTrash())
  }

  const recordGrammarAttempt = (lessonId, score) => {
    const previous = grammarProgress[lessonId] || { attempts: 0, bestScore: 0, completed: false }
    const next = {
      ...grammarProgress,
      [lessonId]: {
        attempts: previous.attempts + 1,
        bestScore: Math.max(previous.bestScore, score),
        completed: previous.completed || score === 1,
      },
    }
    try {
      localStorage.setItem('littlelingo-grammar-progress', JSON.stringify(next))
    } catch {
      setError('Grammar progress could not be saved in this browser. Check its local storage settings.')
    }
    setGrammarProgress(next)
  }

  const saveGeneratedLesson = (lesson) => {
    const next = [lesson, ...generatedLessons]
    try {
      localStorage.setItem('littlelingo-generated-lessons', JSON.stringify(next))
    } catch {
      setError('The lesson could not be saved in this browser. Check local storage space and try again.')
      return false
    }
    setGeneratedLessons(next)
    return true
  }

  const updateGeneratedLesson = (lesson) => {
    const next = generatedLessons.map((item) => item.id === lesson.id ? lesson : item)
    try {
      localStorage.setItem('littlelingo-generated-lessons', JSON.stringify(next))
    } catch {
      setError('The lesson could not be saved in this browser. Check local storage space and try again.')
      return false
    }
    setGeneratedLessons(next)
    return true
  }

  const deleteGeneratedLesson = (lessonId) => {
    const next = generatedLessons.filter((lesson) => lesson.id !== lessonId)
    try {
      localStorage.setItem('littlelingo-generated-lessons', JSON.stringify(next))
      const nextProgress = { ...grammarProgress }
      delete nextProgress[lessonId]
      localStorage.setItem('littlelingo-grammar-progress', JSON.stringify(nextProgress))
      setGrammarProgress(nextProgress)
    } catch {
      setError('This lesson could not be deleted from browser storage. Check its storage settings and try again.')
      return
    }
    setGeneratedLessons(next)
  }

  const toggleEntryFavorite = async (entry) => {
    try {
      const updated = await storage.toggleFavorite(entry._id, !entry.favorite)
      if (!updated) throw new Error('Page not found.')
      setEntries((current) => current.map((item) => item._id === updated._id ? updated : item))
    } catch (favoriteError) {
      setError(favoriteError.message)
    }
  }

  const toggleVocabularyFavorite = async (entry, itemIndex, item) => {
    try {
      const updated = await storage.updateVocabularyItem(entry._id, itemIndex, { favorite: !item.favorite })
      if (!updated) throw new Error('Page not found.')
      setEntries((current) => current.map((currentEntry) => currentEntry._id === updated._id ? updated : currentEntry))
    } catch (favoriteError) {
      setError(favoriteError.message)
    }
  }

  const restoreEntry = async (entry) => {
    try {
      const updated = await storage.restore(entry._id)
      if (!updated) throw new Error('Page not found.')
      setEntries((current) => [updated, ...current])
      await refreshTrash()
      setNotice('Your page is back in the notebook.')
    } catch (restoreError) {
      setTrashError(restoreError.message)
    }
  }

  const permanentlyDeleteEntry = async (entry) => {
    if (!window.confirm(`Permanently delete "${entry.title}"? This cannot be undone.`)) return
    try {
      const ok = await storage.permanentDelete(entry._id)
      if (!ok) throw new Error('Page not found.')
      setTrashEntries((current) => current.filter((item) => item._id !== entry._id))
    } catch (deleteError) {
      setTrashError(deleteError.message)
    }
  }

  const exportJson = async () => {
    try {
      const recycleBin = await storage.getTrash()
      downloadFile(`littlelingo-backup-${today()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), entries, recycleBin }, null, 2), 'application/json')
    } catch (exportError) {
      setError(exportError.message)
    }
  }

  const exportHtml = () => {
    const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character])
    const pages = entries.map((entry) => `
      <article><header><time>${escapeHtml(formatDate(entry.entryDate))}</time><h2>${escapeHtml(entry.title)}</h2></header>
      <div>${safeHtml(entry.content || '')}</div>
      ${(entry.vocabulary || []).length ? `<ul>${entry.vocabulary.map((item) => `<li><strong>${escapeHtml(item.word)}</strong> — ${escapeHtml(item.meaning)}${item.examples?.length ? `<p>${item.examples.map(escapeHtml).join('<br>')}</p>` : item.example ? `<p>${escapeHtml(item.example)}</p>` : ''}</li>`).join('')}</ul>` : ''}
      ${entry.tags?.length ? `<p class="tags">Tags: ${entry.tags.map(escapeHtml).join(', ')}</p>` : ''}</article>`).join('\n')
    const documentHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>My littlelingo notebook</title><style>body{max-width:760px;margin:40px auto;padding:0 20px;color:#403832;font:16px/1.7 Georgia,serif;background:#fffdf8}h1{color:#ae5d75}article{padding:18px 0;border-bottom:1px solid #eaded3;break-inside:avoid}time,.tags{color:#887b71;font-size:13px}h2{margin:4px 0 12px}img{max-width:100%;height:auto}.page-sticker{font-size:1.3em}</style><h1>My littlelingo notebook</h1>${pages || '<p>Your notebook is empty.</p>'}</html>`
    downloadFile(`littlelingo-notebook-${today()}.html`, documentHtml, 'text/html')
  }

  const exportPdf = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setError('Allow pop-ups for this local page to print or save your notebook as a PDF.')
      return
    }
    const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character])
    const pages = entries.map((entry) => `<article><small>${escapeHtml(formatDate(entry.entryDate))}</small><h2>${escapeHtml(entry.title)}</h2><div>${safeHtml(entry.content || '')}</div>${(entry.vocabulary || []).map((item) => `<p><strong>${escapeHtml(item.word)}</strong> — ${escapeHtml(item.meaning)}</p>`).join('')}</article>`).join('')
    printWindow.document.write(`<!doctype html><html><meta charset="utf-8"><title>My English notebook</title><style>body{max-width:760px;margin:30px auto;font:15px/1.6 Georgia,serif;color:#403832}article{break-inside:avoid;border-bottom:1px solid #ddd;padding:12px 0}img{max-width:100%}@media print{body{margin:0}}</style><h1>My English notebook</h1>${pages}</html>`)
    printWindow.document.close()
    window.setTimeout(() => { printWindow.focus(); printWindow.print() }, 300)
  }

  const restoreLocalDraft = () => {
    try {
      const draft = JSON.parse(localStorage.getItem('littlelingo-draft') || 'null')
      if (!draft || typeof draft.title !== 'string') throw new Error('No saved draft was found.')
      setForm({ ...emptyEntry(), ...draft, vocabulary: draft.vocabulary || [] })
      setVocabularyForm(emptyVocabularyForm(draft.vocabulary?.[0]?.category || 'word'))
      setEditingVocabularyIndex(null)
      setEditorOpen(true)
      setDraftStatus('saved')
    } catch (draftError) {
      setError(draftError.message || 'Could not restore the local draft.')
    }
  }

  const filteredEntries = useMemo(() => {
    const term = query.trim().toLowerCase()
    return [...entries]
      .filter((entry) => ['home', 'favorites', 'dashboard', 'settings', 'trash'].includes(section) || (entry.vocabulary || []).some((item) => (item.category || 'word') === section))
      .filter((entry) => !tagFilter || entry.tags?.includes(tagFilter) || entry.vocabulary?.some((item) => item.tags?.includes(tagFilter)))
      .filter((entry) => !difficultyFilter || entry.difficulty === difficultyFilter || entry.vocabulary?.some((item) => item.difficulty === difficultyFilter))
      .filter((entry) => !term || `${entry.title} ${entry.content?.replace(/<[^>]*>/g, ' ')} ${(entry.vocabulary || []).map((item) => `${item.word} ${item.meaning} ${item.example || ''}`).join(' ')}`.toLowerCase().includes(term))
      .sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.updatedAt.localeCompare(a.updatedAt))
  }, [entries, query, section, tagFilter, difficultyFilter])

  const displayItems = useMemo(() => {
    if (section === 'home') return filteredEntries.map((entry) => ({ kind: 'entry', key: entry._id, entry }))
    if (section === 'favorites') return filteredEntries.flatMap((entry) => [
      ...(entry.favorite ? [{ kind: 'entry', key: entry._id, entry }] : []),
      ...(entry.vocabulary || []).flatMap((item, itemIndex) => item.favorite ? [{ kind: 'vocabulary', key: `${entry._id}-${itemIndex}`, entry, item, itemIndex }] : []),
    ]).filter((item) => !query.trim() || `${item.entry.title} ${item.entry.content?.replace(/<[^>]*>/g, ' ')} ${item.item?.word || ''} ${item.item?.meaning || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    const term = query.trim().toLowerCase()
    return filteredEntries.flatMap((entry) => (entry.vocabulary || [])
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => (item.category || 'word') === section)
      .filter(({ item }) => !term || `${entry.title} ${item.word} ${item.meaning} ${item.example || ''}`.toLowerCase().includes(term))
      .map(({ item, itemIndex }) => ({ kind: 'vocabulary', key: `${entry._id}-${itemIndex}`, entry, item, itemIndex })))
  }, [filteredEntries, query, section])

  const categoryCounts = useMemo(() => entries.reduce((counts, entry) => {
    for (const item of entry.vocabulary || []) {
      const category = item.category || 'word'
      counts[category] = (counts[category] || 0) + 1
    }
    return counts
  }, {}), [entries])
  const allTags = useMemo(() => [...new Set(entries.flatMap((entry) => [
    ...(entry.tags || []),
    ...(entry.vocabulary || []).flatMap((item) => item.tags || []),
  ]))].sort((a, b) => a.localeCompare(b)), [entries])

  const reviewCards = useMemo(() => entries.flatMap((entry) => (entry.vocabulary || [])
    .map((item, itemIndex) => ({
      key: `${entry._id}-${itemIndex}`,
      entry,
      item,
      itemIndex,
      dueAt: new Date(item.reviewDueAt || 0),
    })))
    .filter((card) => card.dueAt.getTime() <= reviewClock)
    .sort((a, b) => a.dueAt - b.dueAt), [entries, reviewClock])
  const availableWordCount = useMemo(() => new Set(entries.flatMap((entry) => entry.vocabulary || [])
    .map((item) => item.word.trim().toLocaleLowerCase())
    .filter(Boolean)).size, [entries])
  const sentenceQuizCards = useMemo(() => createSentenceQuizCards(reviewCards, entries), [reviewCards, entries])
  const scheduledReviewCount = useMemo(() => entries.reduce((count, entry) => (
    count + (entry.vocabulary || []).filter((item) => new Date(item.reviewDueAt || 0).getTime() > reviewClock).length
  ), 0), [entries, reviewClock])
  const activityStats = useMemo(() => learningStats(entries, new Date(reviewClock)), [entries, reviewClock])

  const rateReviewCard = async (entry, itemIndex, key, rating) => {
    setReviewBusyKey(key)
    setError('')
    try {
      const updated = await storage.recordReview(entry._id, itemIndex, rating)
      if (!updated) throw new Error('Could not save your review.')
      setEntries((current) => current.map((item) => item._id === updated._id ? updated : item))
      const confirmation = rating === 'again' ? 'We’ll bring that one back in 10 minutes.' : rating === 'hard' ? 'Saved. We’ll review it again soon.' : 'Lovely work! That word is scheduled for a longer break.'
      setNotice(confirmation)
      window.setTimeout(() => setNotice(''), 3500)
      return true
    } catch (reviewError) {
      setError(reviewError.message)
      return false
    } finally {
      setReviewBusyKey('')
    }
  }

  const openNewEntry = useCallback(() => {
    setViewingEntryId(null)
    setForm(emptyEntry())
    setVocabularyForm(emptyVocabularyForm(vocabularyCategories.find((item) => item.id === section)?.id || 'word'))
    setEditingVocabularyIndex(null)
    setEditorOpen(true)
  }, [section])
  useEffect(() => {
    openNewEntryRef.current = openNewEntry
  }, [openNewEntry])

  const openEntry = (entry) => {
    window.clearTimeout(pageTurnTimerRef.current)
    setPageTurnDirection('')
    setViewingEntryId(entry._id)
  }

  const editViewedEntry = () => {
    const entry = entries.find((item) => item._id === viewingEntryId)
    if (!entry) {
      setViewingEntryId(null)
      setError('This notebook page is no longer available.')
      return
    }
    setForm({ ...emptyEntry(), ...entry, vocabulary: entry.vocabulary || [] })
    setVocabularyForm(emptyVocabularyForm(activeCategory?.id || 'word'))
    setEditingVocabularyIndex(null)
    setViewingEntryId(null)
    setEditorOpen(true)
  }

  const openCategoryItemEditor = (entry, itemIndex, item) => {
    setError('')
    setCategoryItemEditor({
      entryId: entry._id,
      index: itemIndex,
      ...categoryItemToForm(item),
    })
  }

  const saveCategoryItem = async (event) => {
    event.preventDefault()
    if (!categoryItemEditor) return
    setCategoryItemSaving(true)
    setError('')
    try {
      const { entryId, index, ...formValues } = categoryItemEditor
      const previousItem = entries.find((item) => item._id === entryId)?.vocabulary?.[index] || null
      const updated = await storage.updateVocabularyItem(entryId, index, vocabularyFormToItem(formValues, previousItem))
      if (!updated) throw new Error('Could not update this item.')
      setEntries((current) => current.map((currentEntry) => currentEntry._id === entryId ? updated : currentEntry))
      setCategoryItemEditor(null)
      setNotice('Your learning item was updated and saved.')
      window.setTimeout(() => setNotice(''), 3500)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setCategoryItemSaving(false)
    }
  }

  // Saves a new item straight into its own collection, without needing a notebook page.
  const saveCategoryEntry = async (event) => {
    event.preventDefault()
    const category = activeCategory?.id
    if (!category) return
    if (!categoryEntryForm.word.trim() || !categoryEntryForm.meaning.trim()) {
      setCategoryEntryError(`Add the ${categorySingular[category]} and its meaning first.`)
      return
    }
    setCategoryEntrySaving(true)
    setCategoryEntryError('')
    try {
      const item = vocabularyFormToItem({ ...categoryEntryForm, category })
      const saved = await storage.create({
        ...emptyEntry(),
        title: item.word,
        content: '',
        vocabulary: [item],
      })
      setEntries((current) => [saved, ...current])
      setCategoryEntryForm(emptyVocabularyForm(category))
      setNotice(`“${item.word}” was added to your ${categoryLabel(category).toLowerCase()}.`)
      window.setTimeout(() => setNotice(''), 3500)
    } catch (saveError) {
      setCategoryEntryError(saveError.message || 'Could not save this item.')
    } finally {
      setCategoryEntrySaving(false)
    }
  }

  const deleteVocabularyItem = async (entry, itemIndex) => {
    const item = entry.vocabulary?.[itemIndex]
    if (!item || !window.confirm(`Delete "${item.word}" from your ${categoryLabel(item.category || 'word').toLowerCase()} collection?`)) return
    try {
      setError('')
      const result = await storage.deleteVocabularyItem(entry._id, itemIndex)
      if (!result) throw new Error('Could not delete this item.')
      setEntries((current) => current.map((currentEntry) => currentEntry._id === entry._id ? result.entry : currentEntry))
      setNotice(`“${item.word}” was deleted.`)
      window.setTimeout(() => setNotice(''), 3500)
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  const uploadImage = async (file) => {
    const imageUrl = await storage.uploadImage(file)
    return imageUrl
  }

  const saveEntry = async (event) => {
    event.preventDefault()
    const content = safeHtml(form.content || '')
    setSaving(true)
    setNotice('')
    try {
      const payload = { ...form, content, vocabulary: form.vocabulary || [] }
      const saved = form._id
        ? await storage.update(form._id, payload)
        : await storage.create(payload)
      if (!saved) throw new Error('Could not save your entry.')
      setEntries((current) => [saved, ...current.filter((entry) => entry._id !== saved._id)])
      localStorage.removeItem('littlelingo-draft')
      setDraftRecoveryAvailable(false)
      setDraftStatus('saved')
      setEditorOpen(false)
      setNotice('Your page is tucked safely into the notebook.')
      window.setTimeout(() => setNotice(''), 3500)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteEntry = async () => {
    if (!form._id || !window.confirm('Move this notebook page to the recycle bin? You can restore it later.')) return
    try {
      const trashed = await storage.softDelete(form._id)
      if (!trashed) throw new Error('Page not found.')
      setEntries((current) => current.filter((entry) => entry._id !== form._id))
      setTrashEntries((current) => [trashed, ...current])
      setEditorOpen(false)
      setNotice('Page moved to the recycle bin.')
      window.setTimeout(() => setNotice(''), 3000)
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  const addVocabulary = () => {
    if (!vocabularyForm.word.trim() || !vocabularyForm.meaning.trim()) return
    const previousItem = editingVocabularyIndex === null ? null : form.vocabulary[editingVocabularyIndex]
    const item = vocabularyFormToItem(vocabularyForm, previousItem)
    setForm((current) => ({
      ...current,
      vocabulary: editingVocabularyIndex === null
        ? [...current.vocabulary, item]
        : current.vocabulary.map((existing, index) => index === editingVocabularyIndex ? item : existing),
    }))
    setEditingVocabularyIndex(null)
    setVocabularyForm(emptyVocabularyForm(activeCategory?.id || 'word'))
  }

  const wordCount = entries.reduce((count, entry) => count + (entry.vocabulary?.length || 0), 0)
  const pageCount = entries.length
  const activeCategory = vocabularyCategories.find((item) => item.id === section)
  const activeCategorySingular = activeCategory ? categorySingular[activeCategory.id] : ''
  const activeCategoryCount = categoryCounts[section] || 0
  const sectionTitle = activeCategory ? `Your ${activeCategory.label.toLowerCase()}` : section === 'favorites' ? 'Your favorites' : 'Your notebook'
  const breadcrumbTitle = activeCategory?.label || ({
    review: 'Daily review', calendar: 'Learning calendar', favorites: 'Favorites',
    dashboard: 'Progress dashboard', grammar: 'Grammar guide', trash: 'Recycle bin', settings: 'Notebook settings',
  }[section] || 'Notebook')
  const shortcutHelp = [
    { keys: 'Ctrl / ⌘ + K', label: 'Focus notebook search' },
    { keys: 'Ctrl / ⌘ + N', label: 'Start a new page' },
    { keys: 'Ctrl / ⌘ + S', label: 'Save the open page' },
    { keys: 'Esc', label: 'Close the open editor or dialog' },
  ]
  // Phones use a slide-out drawer; larger screens collapse the sidebar to a
  // slim icon rail. One hamburger control handles both layouts.
  const sidebarIsOpen = isPhoneLayout() ? navOpen : !sidebarCollapsed
  const toggleSidebar = () => {
    if (isPhoneLayout()) setNavOpen((open) => !open)
    else setSidebarCollapsed((collapsed) => !collapsed)
  }

  const playPronunciation = (word) => {
    if (!('speechSynthesis' in window)) {
      setError('Pronunciation audio is not supported by this browser.')
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(word)
    utterance.lang = 'en-US'
    window.speechSynthesis.speak(utterance)
  }

  return (
    <div className={`app-shell theme-${preferences.theme} paper-${preferences.paper} lines-${preferences.lines} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${navOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setSection('home'); setNavOpen(false) }}>
          <span className="brand-mark"><Icon name="bookOpen" size={22} /></span>
          <span>little<span className="brand-accent">lingo</span><small>YOUR ENGLISH JOURNAL</small></span>
        </a>
        <div className="sidebar-label">YOUR SPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button title="My notebook" aria-label="My notebook" data-tone="rose" className={section === 'home' ? 'active' : ''} onClick={() => { setSection('home'); setNavOpen(false) }}><Icon name="home" /> <span>My notebook</span><span className="nav-count">{pageCount}</span></button>
          <button title="Favorites" aria-label="Favorites" data-tone="coral" className={section === 'favorites' ? 'active' : ''} aria-current={section === 'favorites' ? 'page' : undefined} onClick={() => { setSection('favorites'); setNavOpen(false) }}><Icon name="heart" /> <span>Favorites</span></button>
          <button title="Daily review" aria-label="Daily review" data-tone="blue" className={section === 'review' ? 'active' : ''} aria-current={section === 'review' ? 'page' : undefined} onClick={() => { setSection('review'); setNavOpen(false) }}><Icon name="cards" /> <span>Daily review</span><span className="nav-count">{reviewCards.length}</span></button>
          <button title="Grammar guide" aria-label="Grammar guide" data-tone="violet" className={section === 'grammar' ? 'active' : ''} aria-current={section === 'grammar' ? 'page' : undefined} onClick={() => { setSection('grammar'); setNavOpen(false) }}><Icon name="book" /> <span>Grammar guide</span><span className="nav-count">{grammarLessons.concat(generatedLessons).filter((lesson) => grammarProgress[lesson.id]?.completed).length}/{grammarLessons.length + generatedLessons.length}</span></button>
          <button title="Learning calendar" aria-label="Learning calendar" data-tone="green" className={section === 'calendar' ? 'active' : ''} aria-current={section === 'calendar' ? 'page' : undefined} onClick={() => { setSection('calendar'); setNavOpen(false) }}><Icon name="calendar" /> <span>Learning calendar</span><span className="nav-count">{activityStats.currentStreak ? `${activityStats.currentStreak}d` : ''}</span></button>
          <button title="Progress dashboard" aria-label="Progress dashboard" data-tone="amber" className={section === 'dashboard' ? 'active' : ''} aria-current={section === 'dashboard' ? 'page' : undefined} onClick={() => { setSection('dashboard'); setNavOpen(false) }}><Icon name="chart" /> <span>Progress</span></button>
          <div className="sidebar-label category-label">COLLECT BY TYPE</div>
          {vocabularyCategories.map((category) => (
            <button
              key={category.id}
              title={category.label}
              aria-label={category.label}
              data-tone={category.tone}
              aria-current={section === category.id ? 'page' : undefined}
              className={section === category.id ? 'active' : ''}
              onClick={() => { setSection(category.id); setNavOpen(false) }}
            >
              <Icon name={category.icon} />
              <span>{category.label}</span>
              <span className="nav-count">{categoryCounts[category.id] || 0}</span>
            </button>
          ))}
          <div className="sidebar-label category-label">NOTEBOOK TOOLS</div>
          <button title="Recycle bin" aria-label="Recycle bin" data-tone="slate" className={section === 'trash' ? 'active' : ''} aria-current={section === 'trash' ? 'page' : undefined} onClick={() => { setNavOpen(false); setTrashLoading(true); setTrashError(''); if (section === 'trash') refreshTrash().catch((loadError) => setTrashError(loadError.message)); else setSection('trash') }}><Icon name="trash" /> <span>Recycle bin</span><span className="nav-count">{trashEntries.length || ''}</span></button>
          <button title="Notebook settings" aria-label="Notebook settings" data-tone="teal" className={section === 'settings' ? 'active' : ''} aria-current={section === 'settings' ? 'page' : undefined} onClick={() => { setSection('settings'); setNavOpen(false) }}><Icon name="settings" /> <span>Settings &amp; backup</span></button>
        </nav>
        <button type="button" className="sidebar-toggle" onClick={toggleSidebar} aria-expanded={sidebarIsOpen} aria-label={sidebarIsOpen ? 'Close navigation menu' : 'Open navigation menu'}>
          <Icon name="menu" size={18} />
          <span>{sidebarIsOpen ? 'Close menu' : 'Open menu'}</span>
        </button>
        <div className="sidebar-bottom">
          <div className="daily-card">
            <span className="daily-sparkle">✦</span>
            <p className="daily-label">A LITTLE REMINDER</p>
            <p>Every word you learn is a new little window into the world.</p>
            <span className="daily-heart">keep growing ♡</span>
          </div>
          <div className="profile"><div className="avatar">✿</div><div><strong>My learning space</strong><small>one page at a time</small></div><span className="profile-dots">···</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button type="button" className="mobile-menu-button hamburger-button" aria-label={sidebarIsOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={sidebarIsOpen} onClick={toggleSidebar} title={sidebarIsOpen ? 'Close menu' : 'Open menu'}>
            <Icon name={sidebarIsOpen ? 'close' : 'menu'} size={22} />
          </button>
          <div className="breadcrumb">My space <span>/</span> <strong>{breadcrumbTitle}</strong></div>
          <div className="topbar-right">
            <label className="search-box"><Icon name="search" size={18} /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a word or page…" aria-label="Search notebook" /><kbd>⌘ K</kbd></label>
            <span className="today-pill">✦ &nbsp;{todayLabel}</span>
          </div>
        </header>

        <div className="page-content">
          {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => { setError(''); setLoading(true); loadEntries() }}>Try again</button></div>}
          {notice && <div className="success-banner" role="status"><Icon name="check" size={17} /> {notice}</div>}
          {section === 'grammar' ? (
            <GrammarGuide
              progress={grammarProgress}
              onComplete={recordGrammarAttempt}
              generatedLessons={generatedLessons}
              onSaveGenerated={saveGeneratedLesson}
              onUpdateGenerated={updateGeneratedLesson}
              onDeleteGenerated={deleteGeneratedLesson}
            />
          ) : section === 'dashboard' ? (
            <ProgressDashboard entries={entries} stats={activityStats} now={reviewClock} />
          ) : section === 'settings' ? (
            <NotebookSettings preferences={preferences} setPreferences={setPreferences} onExportJson={exportJson} onExportHtml={exportHtml} onExportPdf={exportPdf} shortcutHelp={shortcutHelp} />
          ) : section === 'trash' ? (
            <><RecycleBin entries={trashEntries} onRestore={restoreEntry} onDelete={permanentlyDeleteEntry} />{trashError && <p className="ai-error" role="alert">{trashError}</p>}{trashLoading && <p className="ai-status" role="status">Opening the recycle bin…</p>}</>
          ) : section === 'review' ? (
            <DailyReview cards={reviewCards} quizCards={sentenceQuizCards} availableWordCount={availableWordCount} scheduledCount={scheduledReviewCount} busyKey={reviewBusyKey} onRate={rateReviewCard} />
          ) : section === 'calendar' ? (
            <LearningCalendar entries={entries} stats={activityStats} openEntry={openEntry} />
          ) : activeCategory ? (
            <>
              <section className={`category-page-hero category-hero-${activeCategory.id}`}>
                <span className="category-page-icon"><Icon name={activeCategory.icon} size={25} /></span>
                <div className="category-page-copy">
                  <span className="eyebrow"><span className="eyebrow-dot" /> YOUR ENGLISH COLLECTION</span>
                  <h1>{activeCategory.label}<em> to remember.</em></h1>
                  <p>{categoryDescription[activeCategory.id]}</p>
                </div>
                <div className="category-page-action">
                  <span className="category-page-count">{activeCategoryCount} saved</span>
                  <button className="primary-button" onClick={() => document.getElementById('category-entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><Icon name="plus" size={18} /> Add {activeCategorySingular}</button>
                </div>
                <span className="category-page-decoration" aria-hidden="true">{['✿', '❝', '✧', '↗', '❋', '⌁', '♡'][vocabularyCategories.findIndex((category) => category.id === activeCategory.id)]}</span>
              </section>
              <div id="category-entry-form">
                <CategoryEntryForm
                  key={activeCategory.id}
                  category={activeCategory.id}
                  value={categoryEntryForm.category === activeCategory.id ? categoryEntryForm : emptyVocabularyForm(activeCategory.id)}
                  onChange={setCategoryEntryForm}
                  onSubmit={saveCategoryEntry}
                  submitLabel={`Save ${activeCategorySingular}`}
                  busy={categoryEntrySaving}
                  error={categoryEntryError}
                />
              </div>
            </>
          ) : section === 'home' ? (
          <section className="welcome-panel">
            <div className="welcome-copy">
              <span className="eyebrow"><span className="eyebrow-dot" /> YOUR LITTLE CORNER OF ENGLISH</span>
              <h1>Words grow<br /> <em>where you write.</em></h1>
              <p>A cozy place for new words, curious thoughts, and everything you’re learning along the way.</p>
              <button className="primary-button" onClick={openNewEntry}><Icon name="plus" size={18} /> Write a new page <Icon name="arrow" size={17} /></button>
            </div>
            <div className="welcome-art" aria-hidden="true">
              <div className="art-sun" /><div className="art-stem stem-one" /><div className="art-stem stem-two" />
              <div className="art-leaf leaf-one">✿</div><div className="art-leaf leaf-two">✿</div><div className="art-leaf leaf-three">✿</div>
              <div className="art-book"><div className="book-lines" /><span>little<br />by little</span></div>
              <span className="art-star star-one">✳</span><span className="art-star star-two">✧</span>
              <span className="art-caption">every page is progress</span>
            </div>
            <div className="welcome-decoration">✿</div>
          </section>
          ) : null}
          {section === 'favorites' && <section className="learning-page favorites-hero"><header className="learning-page-hero"><span className="learning-hero-flower" aria-hidden="true">♡</span><span className="eyebrow"><span className="eyebrow-dot" /> LITTLE THINGS TO REMEMBER</span><h1>Your<em> favorites.</em></h1><p>Pages and learning items you’ve marked for easy finding.</p></header></section>}
          {section === 'trash' && (trashError || trashLoading) && <div className={trashError ? 'error-banner' : 'success-banner'} role={trashError ? 'alert' : 'status'}>{trashError || 'Opening the recycle bin…'}</div>}

          {!activeCategory && section === 'home' && <section className="stats-row" aria-label="Notebook statistics">
            <div className="stat-card"><span className="stat-icon pink"><Icon name="book" size={19} /></span><div><strong>{pageCount}</strong><span>pages written</span></div><span className="stat-flower">✿</span></div>
            <div className="stat-card"><span className="stat-icon yellow"><Icon name="sparkle" size={19} /></span><div><strong>{wordCount}</strong><span>learning items collected</span></div><span className="stat-flower">✧</span></div>
            <div className="stat-card quote-stat"><span className="quote-mark">“</span><div><strong>Keep showing up.</strong><span>Little by little, you’re getting there.</span></div></div>
          </section>}

          {(section === 'home' || activeCategory || section === 'favorites') && <section className="entries-section">
            <div className="section-heading">
              <div><span className="section-kicker">{activeCategory ? `${activeCategoryCount} ${activeCategoryCount === 1 ? activeCategorySingular : activeCategory.label.toLowerCase()} SAVED` : 'A COLLECTION IN PROGRESS'}</span><h2>{sectionTitle} <span>✿</span></h2></div>
              {section !== 'favorites' && <button className="text-button" onClick={activeCategory ? () => document.getElementById('category-entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : openNewEntry}>{activeCategory ? `Add ${activeCategorySingular}` : 'New page'} <Icon name="arrow" size={16} /></button>}
            </div>
            {(section === 'home' || section === 'favorites' || activeCategory) && (
              <div className="mobile-collection-tabs" role="tablist" aria-label="Your collections">
                <button type="button" role="tab" aria-selected={section === 'home'} className={section === 'home' ? 'active' : ''} onClick={() => { setSection('home'); setQuery('') }}>All pages <span>{pageCount}</span></button>
                {vocabularyCategories.map((category) => (
                  <button
                    type="button"
                    role="tab"
                    key={category.id}
                    aria-selected={section === category.id}
                    className={section === category.id ? 'active' : ''}
                    onClick={() => { setSection(category.id); setQuery(''); setTagFilter(''); setDifficultyFilter(''); setNavOpen(false) }}
                  >
                    {category.label} <span>{categoryCounts[category.id] || 0}</span>
                  </button>
                ))}
              </div>
            )}
            {!loading && (
              <div className="entry-filters">
                <label>Tag<select aria-label="Filter by tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">All tags</option>{allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
                <label>Difficulty<select aria-label="Filter by difficulty" value={difficultyFilter} onChange={(event) => setDifficultyFilter(event.target.value)}><option value="">All levels</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
                {(tagFilter || difficultyFilter) && <button type="button" onClick={() => { setTagFilter(''); setDifficultyFilter('') }}>Clear filters</button>}
              </div>
            )}

            {loading ? (
              <div className="empty-state"><div className="empty-illustration">✿</div><h3>Opening your notebook…</h3></div>
            ) : displayItems.length ? (
              <div className="entry-grid">
                {displayItems.map((displayItem, index) => {
                  const { entry, item, itemIndex } = displayItem
                  if (displayItem.kind === 'vocabulary') {
                    return (
                      <article className={`entry-card vocabulary-entry-card card-tone-${index % 4}`} key={displayItem.key}>
                        <span className="entry-topline"><span className="entry-date">{formatDate(entry.entryDate)}</span><span className="entry-doodle">{['✿', '✧', '❋', '♡'][index % 4]}</span></span>
                        <h3>{item.word}</h3>
                        <div className="vocabulary-card-category">{categoryLabel(item.category || 'word')}{item.partOfSpeech && ` · ${item.partOfSpeech}`}</div>
                        <div className="word-pronunciation">{item.phonetic && <span>/{item.phonetic}/</span>}<button type="button" aria-label={`Play pronunciation for ${item.word}`} onClick={() => playPronunciation(item.word)}>🔊</button></div>
                        <div className="entry-excerpt">{item.meaning}{(item.examples?.length ? item.examples : item.example ? [item.example] : []).map((example) => <em className="vocabulary-card-example" key={example}>{example}</em>)}</div>
                        {(item.synonyms?.length > 0 || item.antonyms?.length > 0) && <div className="word-relations">{item.synonyms?.length > 0 && <span><b>Synonyms</b> {item.synonyms.join(', ')}</span>}{item.antonyms?.length > 0 && <span><b>Antonyms</b> {item.antonyms.join(', ')}</span>}</div>}
                        {(item.tags?.length > 0 || item.difficulty || item.learningGoal) && <div className="entry-tags">{item.tags?.map((tag) => <span key={tag}>{tag}</span>)}{item.difficulty && <span>{item.difficulty}</span>}{item.learningGoal && <span>{item.learningGoal}</span>}</div>}
                        <div className="entry-footer vocabulary-entry-footer">
                          <span className="entry-word-count">{entry.title || 'Notebook page'}</span>
                          <div className="vocabulary-card-actions">
                            <button type="button" aria-label={item.favorite ? `Remove ${item.word} from favorites` : `Add ${item.word} to favorites`} onClick={() => toggleVocabularyFavorite(entry, itemIndex, item)}>{item.favorite ? '♥' : '♡'}</button>
                            <button type="button" className="youglish-trigger" onClick={() => setYouglishWord(item.word)} aria-label={`Hear ${item.word} in YouGlish videos`}>▶ YouGlish</button>
                            <button type="button" onClick={() => openCategoryItemEditor(entry, itemIndex, item)} aria-label={`Edit ${item.word}`}><Icon name="edit" size={14} /> Edit</button>
                            <button type="button" className="vocabulary-delete-action" onClick={() => deleteVocabularyItem(entry, itemIndex)} aria-label={`Delete ${item.word}`}><Icon name="trash" size={14} /> Delete</button>
                          </div>
                        </div>
                      </article>
                    )
                  }
                  return (
                    <div className="entry-card-shell" key={displayItem.key}>
                      <button className={`entry-card card-tone-${index % 4}`} onClick={() => openEntry(entry)}>
                        <span className="entry-topline"><span className="entry-date">{formatDate(entry.entryDate)}</span><span className="entry-doodle">{['✿', '✧', '❋', '♡'][index % 4]}</span></span>
                        <h3>{entry.title || 'A little note'}</h3>
                        <div className="entry-excerpt" dangerouslySetInnerHTML={{ __html: safeHtml(entry.content || '') }} />
                        {(entry.tags?.length > 0 || entry.difficulty || entry.learningGoal) && <span className="entry-tags">{entry.tags?.map((tag) => <span key={tag}>{tag}</span>)}{entry.difficulty && <span>{entry.difficulty}</span>}{entry.learningGoal && <span>{entry.learningGoal}</span>}</span>}
                        <span className="entry-footer">
                          <span className="entry-word-count">{entry.vocabulary?.length ? <><Icon name="sparkle" size={14} /> {entry.vocabulary.length} saved item{entry.vocabulary.length === 1 ? '' : 's'}</> : 'A page of thoughts'}</span>
                          <Icon name="arrow" size={16} />
                        </span>
                      </button>
                      <button type="button" className={`entry-favorite-button ${entry.favorite ? 'is-favorite' : ''}`} aria-label={entry.favorite ? `Remove ${entry.title} from favorites` : `Add ${entry.title} to favorites`} onClick={() => toggleEntryFavorite(entry)}>{entry.favorite ? '♥' : '♡'}</button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-illustration">✿</div>
                <h3>{query || tagFilter || difficultyFilter ? 'No matching items found just yet.' : section === 'favorites' ? 'Nothing has been favorited yet.' : activeCategory ? `Your ${activeCategory.label.toLowerCase()} collection is ready to grow.` : 'Your first page is waiting.'}</h3>
                <p>{query || tagFilter || difficultyFilter ? 'Try another search or clear the filters.' : section === 'favorites' ? 'Use the heart on a page or learning item to save it here.' : activeCategory ? `Use the form above to add ${articleFor(activeCategorySingular)} ${activeCategorySingular} — it is saved straight into this collection.` : 'Save a new word, a little story, or whatever is on your mind.'}</p>
                {section !== 'favorites' && <button className="secondary-button" onClick={activeCategory ? () => document.getElementById('category-entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : openNewEntry}><Icon name="plus" size={17} /> {activeCategory ? `Add ${activeCategorySingular}` : 'Start writing'}</button>}
              </div>
            )}
          </section>}
          {(section === 'home' || activeCategory) && <footer className="page-footer"><span>made for curious minds</span><span>keep learning, keep blooming <b>✿</b></span></footer>}
        </div>
      </main>

      {viewingEntryId && (
        <div className="notebook-view-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewingEntryId(null) }}>
          {(() => {
            const entry = entries.find((item) => item._id === viewingEntryId)
            if (!entry) return null
            return (
              <section className="notebook-view-modal" role="dialog" aria-modal="true" aria-labelledby="notebook-view-title">
                {(() => {
                  const currentIndex = orderedNotebookEntries.findIndex((item) => item._id === entry._id)
                  const olderEntry = currentIndex > 0 ? orderedNotebookEntries[currentIndex - 1] : null
                  const newerEntry = currentIndex >= 0 ? orderedNotebookEntries[currentIndex + 1] : null
                  return (
                    <>
                <header className="notebook-view-toolbar">
                  <div className="notebook-view-brand"><span aria-hidden="true">✿</span><div><strong>littlelingo notebook</strong><small>YOUR WORDS, ON YOUR PAGES</small></div></div>
                  <div className="notebook-view-actions">
                    <button type="button" className={`notebook-view-favorite ${entry.favorite ? 'is-favorite' : ''}`} onClick={() => toggleEntryFavorite(entry)} aria-label={entry.favorite ? 'Remove page from favorites' : 'Add page to favorites'}>{entry.favorite ? '♥' : '♡'}<span>{entry.favorite ? 'Saved' : 'Favorite'}</span></button>
                    <button type="button" className="notebook-view-edit" onClick={editViewedEntry}><Icon name="edit" size={15} /> Edit page</button>
                    <button type="button" className="icon-button" aria-label="Close notebook page" onClick={() => setViewingEntryId(null)}><Icon name="close" /></button>
                  </div>
                </header>
                <div
                  className="notebook-open-book"
                  onTouchStart={(event) => {
                    const touch = event.touches[0]
                    notebookTouchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null
                  }}
                  onTouchEnd={(event) => {
                    const start = notebookTouchStartRef.current
                    const touch = event.changedTouches[0]
                    notebookTouchStartRef.current = null
                    if (!start || !touch) return
                    const deltaX = touch.clientX - start.x
                    const deltaY = touch.clientY - start.y
                    if (Math.abs(deltaX) > 70 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35) {
                      turnNotebookPage(deltaX < 0 ? 1 : -1)
                    }
                  }}
                >
                  <article key={entry._id} className={`notebook-view-paper ${pageTurnDirection ? `page-turn-${pageTurnDirection}` : ''}`}>
                    <span className="notebook-page-margin" aria-hidden="true" />
                    <div className="notebook-page-heading">
                      <span className="notebook-page-date">{formatDate(entry.entryDate)}</span>
                      <span className="notebook-page-flower" aria-hidden="true">✿</span>
                      <h1 id="notebook-view-title">{entry.title || 'A little note'}</h1>
                      {(entry.tags?.length > 0 || entry.difficulty || entry.learningGoal) && (
                        <div className="notebook-page-tags">
                          {entry.tags?.map((tag) => <span key={tag}>{tag}</span>)}
                          {entry.difficulty && <span>{entry.difficulty}</span>}
                          {entry.learningGoal && <span>{entry.learningGoal}</span>}
                        </div>
                      )}
                    </div>
                    <div className="notebook-page-writing" dangerouslySetInnerHTML={{ __html: safeHtml(entry.content || '') }} />
                    {!entry.content?.trim() && <p className="notebook-empty-page">This page is ready for your next thought.</p>}
                    <div className="notebook-page-number"><span>little by little</span><span>{entry.vocabulary?.length ? `${entry.vocabulary.length} saved learning item${entry.vocabulary.length === 1 ? '' : 's'}` : 'keep growing ♡'}</span></div>
                  </article>
                  <div className="notebook-page-shadow" aria-hidden="true" />
                </div>
                <nav className="notebook-turn-navigation" aria-label="Notebook pages">
                  <button type="button" disabled={!olderEntry} onClick={() => turnNotebookPage(-1)}><span aria-hidden="true">‹</span> Older page</button>
                  <span aria-live="polite">Page {currentIndex + 1} of {orderedNotebookEntries.length}</span>
                  <button type="button" disabled={!newerEntry} onClick={() => turnNotebookPage(1)}>Newer page <span aria-hidden="true">›</span></button>
                </nav>
                {entry.vocabulary?.length > 0 && (
                  <section className="notebook-saved-words" aria-label="Vocabulary saved with this page">
                    <div className="notebook-saved-words-heading"><span className="section-kicker">GATHERED FROM THIS PAGE</span><h2>Words to keep</h2></div>
                    <div className="notebook-saved-word-list">
                      {entry.vocabulary.map((item, index) => (
                        <article key={`${item.word}-${index}`}>
                          <div><h3>{item.word}</h3>{item.partOfSpeech && <span>{item.partOfSpeech}</span>}</div>
                          <p>{item.meaning}</p>
                          {(item.examples?.length ? item.examples : item.example ? [item.example] : []).map((example) => <em key={example}>{example}</em>)}
                        </article>
                      ))}
                    </div>
                  </section>
                )}
                    </>
                  )
                })()}
              </section>
            )
          })()}
        </div>
      )}

      {editorOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditorOpen(false) }}>
          <form ref={editorFormRef} className="editor-modal" onSubmit={saveEntry}>
            <header className="modal-header">
              <div><span className="section-kicker">{form._id ? 'A PAGE IN YOUR NOTEBOOK' : activeCategory ? `NEW ${activeCategorySingular.toUpperCase()}` : 'A FRESH PAGE'}</span><h2>{form._id ? 'Keep your thoughts growing' : activeCategory ? `Add a ${activeCategorySingular}` : 'Let the words flow'}</h2>
                {draftRecoveryAvailable && !form._id && <button type="button" className="restore-draft-link" onClick={restoreLocalDraft}>Restore autosaved draft</button>}
              </div>
              <button className="icon-button" type="button" aria-label="Close editor" onClick={() => setEditorOpen(false)}><Icon name="close" /></button>
            </header>
            <div className="modal-fields">
              <input className="title-input" required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={activeCategory && !form._id ? `Name your ${activeCategorySingular} page…` : 'Give this page a title…'} aria-label="Page title" />
              <label className="date-field"><span>PAGE DATE</span><input type="date" value={form.entryDate} onChange={(event) => setForm({ ...form, entryDate: event.target.value })} required /></label>
            </div>
            <section className="entry-metadata-fields">
              <label className="favorite-check"><input type="checkbox" checked={Boolean(form.favorite)} onChange={(event) => setForm({ ...form, favorite: event.target.checked })} /> Mark this page as a favorite</label>
              <label>TOPIC TAGS<input maxLength={400} value={formatTags(form.tags || [])} onChange={(event) => setForm({ ...form, tags: splitList(event.target.value) })} placeholder="Travel, conversation, work (comma-separated)" /></label>
              <label>DIFFICULTY<select value={form.difficulty || ''} onChange={(event) => setForm({ ...form, difficulty: event.target.value })}><option value="">Not set</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
              <label>LEARNING GOAL<input maxLength={100} value={form.learningGoal || ''} onChange={(event) => setForm({ ...form, learningGoal: event.target.value })} placeholder="e.g. Travel conversation" /></label>
            </section>
            <RichEditor
              key={form._id || 'new-entry'}
              initialContent={form.content}
              onUpload={uploadImage}
              onChange={(content) => setForm((current) => ({ ...current, content }))}
            />
            <section className="vocabulary-editor">
              <div className="vocabulary-heading"><span className="mini-flower">✿</span><div><h3>Vocabulary &amp; expressions</h3><p>Save words, sentences, phrases, idioms, and more.</p></div></div>
              {form.vocabulary.map((word, index) => (
                <div className={`word-row ${editingVocabularyIndex === index ? 'word-row-editing' : ''}`} key={`${word.word}-${index}`}>
                  <div><strong>{word.word}</strong><small className="word-category-tag">{categoryLabel(word.category || 'word')}</small>{word.partOfSpeech && <small className="word-category-tag">{word.partOfSpeech}</small>}<span>{word.meaning}</span>{word.phonetic && <em>/{word.phonetic}/</em>}{(word.examples?.length ? word.examples : word.example ? [word.example] : []).map((example) => <em key={example}>{example}</em>)}</div>
                  <div className="word-row-actions">
                    <button
                      type="button"
                      aria-label={`Edit ${word.word}`}
                      onClick={() => {
                        setVocabularyForm({
                          ...emptyVocabularyForm(word.category || 'word'),
                          word: word.word, meaning: word.meaning, example: word.example || '',
                          examplesText: (word.examples || (word.example ? [word.example] : [])).join('\n'),
                          phonetic: word.phonetic || '', partOfSpeech: word.partOfSpeech || '',
                          synonymsText: (word.synonyms || []).join(', '), antonymsText: (word.antonyms || []).join(', '),
                          favorite: Boolean(word.favorite), tagsText: formatTags(word.tags || []),
                          difficulty: word.difficulty || '', learningGoal: word.learningGoal || '',
                        })
                        setEditingVocabularyIndex(index)
                      }}
                    ><Icon name="edit" size={15} /></button>
                    <button
                      type="button"
                      aria-label={`Delete ${word.word}`}
                      onClick={() => {
                        setForm((current) => ({ ...current, vocabulary: current.vocabulary.filter((_, wordIndex) => wordIndex !== index) }))
                        if (editingVocabularyIndex === index) {
                          setEditingVocabularyIndex(null)
                          setVocabularyForm(emptyVocabularyForm(activeCategory?.id || 'word'))
                        } else if (editingVocabularyIndex !== null && index < editingVocabularyIndex) {
                          setEditingVocabularyIndex(editingVocabularyIndex - 1)
                        }
                      }}
                    ><Icon name="trash" size={15} /></button>
                  </div>
                </div>
              ))}
              <div className="word-inputs">
                <input value={vocabularyForm.word} onChange={(event) => setVocabularyForm({ ...vocabularyForm, word: event.target.value })} placeholder="Word or phrase" aria-label="Word, sentence, or phrase" />
                <input value={vocabularyForm.meaning} onChange={(event) => setVocabularyForm({ ...vocabularyForm, meaning: event.target.value })} placeholder="Meaning" aria-label="Word meaning" />
                <input value={vocabularyForm.phonetic} onChange={(event) => setVocabularyForm({ ...vocabularyForm, phonetic: event.target.value })} placeholder="Phonetics, e.g. /ˈwɜːrd/" aria-label="Pronunciation phonetics" />
                <input value={vocabularyForm.partOfSpeech} onChange={(event) => setVocabularyForm({ ...vocabularyForm, partOfSpeech: event.target.value })} placeholder="Part of speech" aria-label="Part of speech" />
                <textarea value={vocabularyForm.examplesText || vocabularyForm.example} onChange={(event) => setVocabularyForm({ ...vocabularyForm, examplesText: event.target.value, example: event.target.value.split('\n')[0] || '' })} placeholder="Example sentences (one per line)" aria-label="Example sentences" rows={2} />
                <input value={vocabularyForm.synonymsText} onChange={(event) => setVocabularyForm({ ...vocabularyForm, synonymsText: event.target.value })} placeholder="Synonyms, comma-separated" aria-label="Synonyms" />
                <input value={vocabularyForm.antonymsText} onChange={(event) => setVocabularyForm({ ...vocabularyForm, antonymsText: event.target.value })} placeholder="Antonyms, comma-separated" aria-label="Antonyms" />
                <input value={vocabularyForm.tagsText} onChange={(event) => setVocabularyForm({ ...vocabularyForm, tagsText: event.target.value })} placeholder="Tags, comma-separated" aria-label="Vocabulary tags" />
                <select value={vocabularyForm.difficulty} onChange={(event) => setVocabularyForm({ ...vocabularyForm, difficulty: event.target.value })} aria-label="Vocabulary difficulty"><option value="">Difficulty</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select>
                <input value={vocabularyForm.learningGoal} onChange={(event) => setVocabularyForm({ ...vocabularyForm, learningGoal: event.target.value })} placeholder="Learning goal" aria-label="Vocabulary learning goal" />
                <label className="favorite-check"><input type="checkbox" checked={vocabularyForm.favorite} onChange={(event) => setVocabularyForm({ ...vocabularyForm, favorite: event.target.checked })} /> Favorite</label>
                <select value={vocabularyForm.category} onChange={(event) => setVocabularyForm({ ...vocabularyForm, category: event.target.value })} aria-label="Vocabulary category">
                  {vocabularyCategories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                </select>
                <button type="button" className="add-word-button" onClick={addVocabulary} disabled={!vocabularyForm.word.trim() || !vocabularyForm.meaning.trim()}>
                  <Icon name={editingVocabularyIndex === null ? 'plus' : 'check'} size={17} /><span>{editingVocabularyIndex === null ? 'Add' : 'Update'}</span>
                </button>
                {editingVocabularyIndex !== null && <button type="button" className="cancel-word-edit" onClick={() => { setEditingVocabularyIndex(null); setVocabularyForm(emptyVocabularyForm(activeCategory?.id || 'word')) }}>Cancel</button>}
              </div>
            </section>
            <footer className="modal-footer">
              {form._id && <button className="delete-button" type="button" onClick={deleteEntry}><Icon name="trash" size={17} /> Delete page</button>}
              <span className={`save-note autosave-note autosave-${draftStatus}`}><Icon name="check" size={15} /> {draftStatus === 'saving' ? 'Saving local draft…' : draftStatus === 'error' ? 'Draft could not be saved' : 'Draft saved locally'}</span>
              <button className="primary-button save-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save this page'} <Icon name="arrow" size={17} /></button>
            </footer>
          </form>
        </div>
      )}

      {youglishWord && <YouGlishPlayer word={youglishWord} onClose={() => setYouglishWord('')} />}

      {categoryItemEditor && (
        <div className="modal-backdrop category-item-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !categoryItemSaving) setCategoryItemEditor(null) }}>
          <div className="category-item-modal">
            <header className="modal-header">
              <div><span className="section-kicker">EDIT YOUR {categoryForm(categoryItemEditor.category).entryLabel.toUpperCase()}</span><h2>Make it just right.</h2></div>
              <button className="icon-button" type="button" aria-label="Close item editor" disabled={categoryItemSaving} onClick={() => setCategoryItemEditor(null)}><Icon name="close" /></button>
            </header>
            <CategoryEntryForm
              category={categoryItemEditor.category}
              value={categoryItemEditor}
              onChange={setCategoryItemEditor}
              onSubmit={saveCategoryItem}
              onCancel={() => setCategoryItemEditor(null)}
              submitLabel="Save changes"
              busy={categoryItemSaving}
              error={error}
              autoFocus
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
