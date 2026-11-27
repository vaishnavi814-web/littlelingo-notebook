const mongoose = require('mongoose')

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-z0-9_]+$/,
    },
    displayName: { type: String, trim: true, maxlength: 50, default: '' },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
)

// Keep chat accounts in the same database as notebook entries.
const connection = mongoose.connection.useDb(process.env.MONGO_DB || 'littlelingo', {
  useCache: true,
})

module.exports = connection.model('User', userSchema)
