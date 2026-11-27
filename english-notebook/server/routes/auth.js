const express = require('express')
const User = require('../models/User')
const { requireAuth, readToken } = require('../middleware/auth')
const {
  ensureMongo,
  hashPassword,
  verifyPassword,
  safeCompare,
  issueSession,
  revokeSession,
} = require('../lib/auth')

const router = express.Router()
const publicUser = (user) => ({
  id: String(user._id),
  username: user.username,
  displayName: user.displayName || user.username,
  role: 'user',
})

router.post('/register', async (req, res, next) => {
  try {
    ensureMongo()
    const username = String(req.body?.username || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    const displayName = String(req.body?.displayName || '').trim() || username
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      return res.status(400).json({ message: 'Username must be 3-30 letters, numbers, or underscores.' })
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ message: 'Password must be between 8 and 128 characters.' })
    }
    if (displayName.length > 50) {
      return res.status(400).json({ message: 'Display name is too long.' })
    }
    if (await User.findOne({ username })) {
      return res.status(409).json({ message: 'That username is already taken.' })
    }
    let user
    try {
      user = await User.create({ username, displayName, passwordHash: hashPassword(password) })
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: 'That username is already taken.' })
      throw error
    }
    const token = await issueSession({ role: 'user', userId: user._id, username })
    res.status(201).json({ token, user: publicUser(user) })
  } catch (error) {
    next(error)
  }
})

router.post('/login', async (req, res, next) => {
  try {
    ensureMongo()
    const username = String(req.body?.username || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    const user = username ? await User.findOne({ username }) : null
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ message: 'Incorrect username or password.' })
    }
    const token = await issueSession({ role: 'user', userId: user._id, username: user.username })
    res.json({ token, user: publicUser(user) })
  } catch (error) {
    next(error)
  }
})

router.post('/admin/login', async (req, res, next) => {
  try {
    ensureMongo()
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    const expectedUsername = process.env.ADMIN_USERNAME || 'admin'
    const passwordHash = process.env.ADMIN_PASSWORD_HASH
    const plainPassword = process.env.ADMIN_PASSWORD
    if (!passwordHash && !plainPassword) {
      return res.status(503).json({
        message: 'Admin sign-in is not configured. Set ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) on the server.',
      })
    }
    const nameMatches = username.toLowerCase() === expectedUsername.toLowerCase()
    const passwordMatches = passwordHash
      ? verifyPassword(password, passwordHash)
      : safeCompare(password, plainPassword)
    if (!nameMatches || !passwordMatches) {
      return res.status(401).json({ message: 'Incorrect admin username or password.' })
    }
    const token = await issueSession({ role: 'admin', username: expectedUsername })
    res.json({
      token,
      user: { id: 'admin', username: expectedUsername, displayName: 'Admin', role: 'admin' },
    })
  } catch (error) {
    next(error)
  }
})

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    if (req.auth.role === 'admin') {
      return res.json({ user: { id: 'admin', username: req.auth.username, displayName: 'Admin', role: 'admin' } })
    }
    const user = await User.findById(req.auth.userId)
    if (!user) return res.status(401).json({ message: 'Your account no longer exists.' })
    res.json({ user: publicUser(user) })
  } catch (error) {
    next(error)
  }
})

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await revokeSession(readToken(req))
    res.json({ message: 'Signed out.' })
  } catch (error) {
    next(error)
  }
})

module.exports = router
