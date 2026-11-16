export const extractSubtitleText = (content) => content
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .filter((line, index, lines) => {
    const trimmed = line.trim()
    return trimmed
      && !/^WEBVTT(?:\s|$)/i.test(trimmed)
      && !(/^\d+$/.test(trimmed) && /^\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->/.test(lines[index + 1]?.trim() || ''))
      && !/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->/.test(trimmed)
  })
  .map((line) => line
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim())
  .filter(Boolean)
  .join('\n')

export const isGeneratedLesson = (lesson) => Boolean(
  lesson
  && typeof lesson.id === 'string'
  && lesson.id.startsWith('generated-')
  && typeof lesson.title === 'string'
  && typeof lesson.summary === 'string'
  && typeof lesson.explanation === 'string'
  && ['Beginner', 'Intermediate', 'Advanced', 'Proficiency'].includes(lesson.level)
  && ['text', 'subtitle'].includes(lesson.sourceType)
  && Array.isArray(lesson.examples)
  && lesson.examples.length > 0
  && lesson.examples.every((item) => typeof item === 'string')
  && Array.isArray(lesson.commonMistakes)
  && lesson.commonMistakes.every((item) => typeof item === 'string')
  && Array.isArray(lesson.vocabulary)
  && lesson.vocabulary.every((item) => item
    && typeof item.word === 'string'
    && typeof item.meaning === 'string'
    && typeof item.example === 'string')
  && Array.isArray(lesson.questions)
  && lesson.questions[0]
  && typeof lesson.questions[0].prompt === 'string'
  && Array.isArray(lesson.questions[0].options)
  && lesson.questions[0].options.length === 4
  && lesson.questions[0].options.every((item) => typeof item === 'string')
  && Number.isInteger(lesson.questions[0].answer)
  && lesson.questions[0].answer >= 0
  && lesson.questions[0].answer < lesson.questions[0].options.length
  && typeof lesson.questions[0].explanation === 'string',
)

export const isCustomLesson = (lesson) => Boolean(
  lesson
  && typeof lesson.id === 'string'
  && lesson.id.startsWith('custom-')
  && typeof lesson.title === 'string'
  && lesson.title.trim().length > 0
  && typeof lesson.date === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(lesson.date)
  && ['Beginner', 'Intermediate', 'Advanced', 'Proficiency'].includes(lesson.level)
  && Array.isArray(lesson.examples)
  && lesson.examples.every((item) => typeof item === 'string')
  && Array.isArray(lesson.commonMistakes)
  && lesson.commonMistakes.every((item) => typeof item === 'string')
  && Array.isArray(lesson.questions)
  && (lesson.questions.length === 0 || (
    lesson.questions.length === 1
    && typeof lesson.questions[0].prompt === 'string'
    && lesson.questions[0].prompt.trim().length > 0
    && Array.isArray(lesson.questions[0].options)
    && lesson.questions[0].options.length === 4
    && lesson.questions[0].options.every((item) => typeof item === 'string' && item.trim().length > 0)
    && Number.isInteger(lesson.questions[0].answer)
    && lesson.questions[0].answer >= 0
    && lesson.questions[0].answer < 4
    && typeof lesson.questions[0].explanation === 'string'
  )),
)

export const loadGeneratedLessons = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('littlelingo-generated-lessons') || '[]')
    return Array.isArray(saved) ? saved.filter((lesson) => isGeneratedLesson(lesson) || isCustomLesson(lesson)) : []
  } catch {
    return []
  }
}
