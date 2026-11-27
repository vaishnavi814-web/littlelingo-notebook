const mongoose = require('mongoose')

const messageSchema = new mongoose.Schema(
  {
    senderId: { type: mongoose.Schema.Types.ObjectId, default: null },
    senderRole: { type: String, enum: ['user', 'admin', 'system'], required: true },
    senderName: { type: String, default: '' },
    text: { type: String, required: true, maxlength: 4000 },
    createdAt: { type: Date, default: Date.now },
    readBy: { type: [String], default: [] },
  },
  { _id: true },
)

const conversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [mongoose.Schema.Types.ObjectId],
      required: true,
      validate: (value) => value.length === 2,
    },
    participantNames: { type: [String], default: [] },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: '' },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true },
)

const connection = mongoose.connection.useDb(process.env.MONGO_DB || 'littlelingo', {
  useCache: true,
})

module.exports = connection.model('Conversation', conversationSchema)
