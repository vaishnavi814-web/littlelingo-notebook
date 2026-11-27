// Password hashing and opaque session tokens.
const crypto = require('crypto')
const mongoose = require('mongoose')
const Session = require('../models/Session')

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const ensureMongo = () => {
  if (mongoose.connection.readyState !== 1) {
    const error = new Error('Accounts and chat need MongoDB. Set MONGO_URI and restart the server.')
    error.status = 503
    throw error
  }
}

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derived}`
}

const verifyPassword = (password, stored) => {
  try {
    const [salt, expectedHex] = String(stored || '').split(':')
    if (!salt || !expectedHex) return false
    const actual = crypto.scryptSync(password, salt, 64)
    const expected = Buffer.from(expectedHex, 'hex')
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

const safeCompare = (left, right) => {
  const a = crypto.createHash('sha256').update(String(left)).digest()
  const b = crypto.createHash('sha256').update(String(right)).digest()
  return crypto.timingSafeEqual(a, b)
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')

const issueSession = async ({ role, userId = null, username = '' }) => {
  ensureMongo()
  const token = crypto.randomBytes(32).toString('hex')
  await Session.create({
    tokenHash: hashToken(token),
    role,
    userId,
    username,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  return token
}

const getSession = async (token) => {
  if (!token) return null
  ensureMongo()
  return Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } })
}

const revokeSession = async (token) => {
  if (!token) return
  ensureMongo()
  await Session.deleteOne({ tokenHash: hashToken(token) })
}

module.exports = {
  SESSION_TTL_MS,
  ensureMongo,
  hashPassword,
  verifyPassword,
  safeCompare,
  issueSession,
  getSession,
  revokeSession,
}
