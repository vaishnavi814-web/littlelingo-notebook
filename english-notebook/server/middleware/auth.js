const { getSession } = require('../lib/auth')

const readToken = (req) => {
  const header = req.headers.authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : ''
}

const requireAuth = async (req, res, next) => {
  try {
    const session = await getSession(readToken(req))
    if (!session) return res.status(401).json({ message: 'Please sign in to continue.' })
    req.auth = {
      role: session.role,
      userId: session.userId ? String(session.userId) : null,
      username: session.username,
    }
    next()
  } catch (error) {
    next(error)
  }
}

const requireUser = (req, res, next) => {
  if (req.auth?.role !== 'user') return res.status(403).json({ message: 'A user account is required for this action.' })
  next()
}

const requireAdmin = (req, res, next) => {
  if (req.auth?.role !== 'admin') return res.status(403).json({ message: 'Admin access required.' })
  next()
}

module.exports = { readToken, requireAuth, requireUser, requireAdmin }
