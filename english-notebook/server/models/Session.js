const mongoose = require('mongoose')

const sessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    role: { type: String, enum: ['user', 'admin'], required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, default: null },
    username: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
)

// Expired sessions clean themselves up in MongoDB.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const connection = mongoose.connection.useDb(process.env.MONGO_DB || 'littlelingo', {
  useCache: true,
})

module.exports = connection.model('Session', sessionSchema)
