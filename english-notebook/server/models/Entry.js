const mongoose = require('mongoose')

const vocabularyCategories = [
  'word',
  'sentence',
  'phrase',
  'phrasal-verb',
  'idiom',
  'collocation',
  'expression',
]

const vocabularySchema = new mongoose.Schema(
  {
    word: { type: String, required: true, trim: true, maxlength: 100 },
    meaning: { type: String, required: true, trim: true, maxlength: 500 },
    example: { type: String, trim: true, maxlength: 500, default: '' },
    examples: { type: [{ type: String, trim: true, maxlength: 500 }], default: [] },
    phonetic: { type: String, trim: true, maxlength: 80, default: '' },
    partOfSpeech: { type: String, trim: true, maxlength: 40, default: '' },
    synonyms: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
    antonyms: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
    category: { type: String, enum: vocabularyCategories, default: 'word' },
    favorite: { type: Boolean, default: false },
    tags: { type: [{ type: String, trim: true, maxlength: 30 }], default: [] },
    difficulty: { type: String, enum: ['', 'beginner', 'intermediate', 'advanced'], default: '' },
    learningGoal: { type: String, trim: true, maxlength: 100, default: '' },
    reviewDueAt: { type: Date, default: Date.now },
    reviewInterval: { type: Number, min: 0, max: 36500, default: 0 },
    reviewRepetitions: { type: Number, min: 0, max: 100000, default: 0 },
    reviewEase: { type: Number, min: 1.3, max: 5, default: 2.5 },
    reviewedAt: { type: Date, default: null },
    reviewTotal: { type: Number, min: 0, default: 0 },
    reviewCorrect: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
)

const entrySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    entryDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    content: { type: String, default: '', maxlength: 1_000_000 },
    favorite: { type: Boolean, default: false },
    tags: { type: [{ type: String, trim: true, maxlength: 30 }], default: [] },
    difficulty: { type: String, enum: ['', 'beginner', 'intermediate', 'advanced'], default: '' },
    learningGoal: { type: String, trim: true, maxlength: 100, default: '' },
    deletedAt: { type: Date, default: null },
    vocabulary: { type: [vocabularySchema], default: [] },
  },
  { timestamps: true },
)

module.exports = mongoose.model('Entry', entrySchema)
