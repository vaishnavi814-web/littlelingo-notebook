const express = require('express')
const mongoose = require('mongoose')
const User = require('../models/User')
const Conversation = require('../models/Conversation')
const { requireAuth, requireUser, requireAdmin } = require('../middleware/auth')
const { ensureMongo } = require('../lib/auth')

const router = express.Router()
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''))
const viewerKey = (auth) => (auth.role === 'admin' ? 'admin' : auth.username)

const serializeMessage = (message) => ({
  id: String(message._id),
  senderId: message.senderId ? String(message.senderId) : null,
  senderRole: message.senderRole,
  senderName: message.senderName,
  text: message.text,
  createdAt: message.createdAt,
  readBy: message.readBy || [],
})

const serializeConversation = (conversation, auth) => {
  const key = viewerKey(auth)
  return {
    id: String(conversation._id),
    participants: conversation.participants.map(String),
    participantNames: conversation.participantNames,
    title: conversation.participantNames.join(' & ') || 'Conversation',
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview,
    unread: (conversation.messages || []).filter(
      (message) => message.senderRole !== 'system' && message.senderName !== key && !(message.readBy || []).includes(key),
    ).length,
  }
}

const findConversation = async (id, auth) => {
  if (!isValidId(id)) return null
  const conversation = await Conversation.findById(id)
  if (!conversation) return null
  const allowed = auth.role === 'admin'
    || conversation.participants.some((participant) => String(participant) === auth.userId)
  return allowed ? conversation : null
}

const appendMessage = async (conversation, { text, auth }) => {
  conversation.messages.push({
    senderId: auth.role === 'user' ? new mongoose.Types.ObjectId(auth.userId) : null,
    senderRole: auth.role,
    senderName: auth.role === 'admin' ? 'Admin' : auth.username,
    text,
    createdAt: new Date(),
    readBy: [viewerKey(auth)],
  })
  conversation.lastMessageAt = new Date()
  conversation.lastMessagePreview = text
  await conversation.save()
  return serializeMessage(conversation.messages[conversation.messages.length - 1])
}

router.get('/users', requireAuth, requireUser, async (req, res, next) => {
  try {
    ensureMongo()
    const users = await User.find({ _id: { $ne: new mongoose.Types.ObjectId(req.auth.userId) } })
      .sort({ displayName: 1, username: 1 })
    res.json(users.map((user) => ({
      id: String(user._id),
      username: user.username,
      displayName: user.displayName || user.username,
    })))
  } catch (error) {
    next(error)
  }
})

router.get('/conversations', requireAuth, async (req, res, next) => {
  try {
    ensureMongo()
    const filter = req.auth.role === 'admin'
      ? {}
      : { participants: new mongoose.Types.ObjectId(req.auth.userId) }
    const conversations = await Conversation.find(filter).sort({ lastMessageAt: -1 })
    res.json(conversations.map((conversation) => serializeConversation(conversation, req.auth)))
  } catch (error) {
    next(error)
  }
})

router.post('/conversations', requireAuth, requireUser, async (req, res, next) => {
  try {
    ensureMongo()
    const participantId = String(req.body?.participantId || '')
    const text = String(req.body?.text || '').trim()
    if (!isValidId(participantId)) return res.status(400).json({ message: 'Choose a person to chat with.' })
    if (participantId === req.auth.userId) return res.status(400).json({ message: 'You cannot chat with yourself.' })
    if (!text) return res.status(400).json({ message: 'Write a message first.' })
    if (text.length > 4000) return res.status(400).json({ message: 'Messages must be under 4000 characters.' })

    const self = await User.findById(req.auth.userId)
    const other = await User.findById(participantId)
    if (!self || !other) return res.status(404).json({ message: 'That user is no longer available.' })

    const selfId = new mongoose.Types.ObjectId(self.id)
    const otherId = new mongoose.Types.ObjectId(other.id)
    let conversation = await Conversation.findOne({ participants: { $all: [selfId, otherId], $size: 2 } })
    if (!conversation) {
      conversation = await Conversation.create({
        participants: [selfId, otherId],
        participantNames: [self.displayName || self.username, other.displayName || other.username],
        messages: [],
      })
    }
    const message = await appendMessage(conversation, { text, auth: req.auth })
    res.status(201).json({ conversation: serializeConversation(conversation, req.auth), message })
  } catch (error) {
    next(error)
  }
})

router.get('/conversations/:id', requireAuth, async (req, res, next) => {
  try {
    ensureMongo()
    const conversation = await findConversation(req.params.id, req.auth)
    if (!conversation) return res.status(404).json({ message: 'Conversation not found.' })
    const key = viewerKey(req.auth)
    let changed = false
    for (const message of conversation.messages) {
      if (message.senderRole !== 'system' && message.senderName !== key && !(message.readBy || []).includes(key)) {
        message.readBy.push(key)
        changed = true
      }
    }
    if (changed) await conversation.save()
    res.json({
      ...serializeConversation(conversation, req.auth),
      messages: conversation.messages.map(serializeMessage),
    })
  } catch (error) {
    next(error)
  }
})

router.post('/conversations/:id/messages', requireAuth, async (req, res, next) => {
  try {
    ensureMongo()
    const conversation = await findConversation(req.params.id, req.auth)
    if (!conversation) return res.status(404).json({ message: 'Conversation not found.' })
    const text = String(req.body?.text || '').trim()
    if (!text) return res.status(400).json({ message: 'Write a message first.' })
    if (text.length > 4000) return res.status(400).json({ message: 'Messages must be under 4000 characters.' })
    const message = await appendMessage(conversation, { text, auth: req.auth })
    res.status(201).json(message)
  } catch (error) {
    next(error)
  }
})

router.patch('/conversations/:id/read', requireAuth, async (req, res, next) => {
  try {
    ensureMongo()
    const conversation = await findConversation(req.params.id, req.auth)
    if (!conversation) return res.status(404).json({ message: 'Conversation not found.' })
    const key = viewerKey(req.auth)
    let changed = false
    for (const message of conversation.messages) {
      if (message.senderRole !== 'system' && message.senderName !== key && !(message.readBy || []).includes(key)) {
        message.readBy.push(key)
        changed = true
      }
    }
    if (changed) await conversation.save()
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

router.delete('/conversations/:id/messages/:index', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    ensureMongo()
    const conversation = await findConversation(req.params.id, req.auth)
    if (!conversation) return res.status(404).json({ message: 'Conversation not found.' })
    const index = Number(req.params.index)
    if (!Number.isInteger(index) || index < 0 || index >= conversation.messages.length) {
      return res.status(400).json({ message: 'That message is no longer available.' })
    }
    conversation.messages.splice(index, 1)
    conversation.lastMessageAt = conversation.messages.length
      ? conversation.messages[conversation.messages.length - 1].createdAt
      : conversation.createdAt || new Date()
    conversation.lastMessagePreview = conversation.messages.length
      ? conversation.messages[conversation.messages.length - 1].text
      : ''
    await conversation.save()
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

router.delete('/conversations/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    ensureMongo()
    const conversation = await findConversation(req.params.id, req.auth)
    if (!conversation) return res.status(404).json({ message: 'Conversation not found.' })
    await conversation.deleteOne()
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

module.exports = router
