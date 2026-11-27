import { useCallback, useEffect, useRef, useState } from 'react'
import { auth as authApi, chat as chatApi } from './storage'

const formatTime = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const initials = (name) => String(name || '?')
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase() || '')
  .join('')

function TinyIcon({ name }) {
  if (name === 'send') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 16-8-6 16-3-6-7-2Z" /></svg>
  }
  if (name === 'trash') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m2 0-1 13H8L7 7" /></svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

export function AuthDialog({ open, onClose, onSuccess }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setBusy(false)
  }, [open])

  if (!open) return null

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('Enter both fields to continue.')
      return
    }
    setBusy(true)
    try {
      const payload = { username: username.trim(), password }
      if (mode === 'register') payload.displayName = displayName.trim() || username.trim()
      const result = mode === 'register'
        ? await authApi.register(payload)
        : mode === 'admin'
          ? await authApi.adminLogin(payload)
          : await authApi.login(payload)
      onSuccess(result.user)
      setPassword('')
      onClose()
    } catch (requestError) {
      setError(requestError.message || 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form className="auth-modal" onSubmit={submit}>
        <div className="modal-header">
          <div>
            <span className="section-kicker">LittleLingo accounts</span>
            <h2>Sign in</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close sign-in">×</button>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="Sign-in method">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>Create account</button>
          <button type="button" role="tab" aria-selected={mode === 'admin'} className={mode === 'admin' ? 'active' : ''} onClick={() => { setMode('admin'); setError('') }}>Admin</button>
        </div>

        {mode === 'admin' && (
          <p className="auth-note">Admin access is set up by the site owner. Use the admin username and password configured on the server.</p>
        )}
        {mode === 'register' && (
          <p className="auth-note">Create an account to chat with other learners. Your password is stored as a hash, never as plain text.</p>
        )}

        <div className="modal-fields">
          {mode === 'register' && (
            <label className="auth-field">
              <span>Display name</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={50} autoComplete="name" />
            </label>
          )}
          <label className="auth-field">
            <span>{mode === 'admin' ? 'Admin username' : 'Username'}</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="none" autoComplete="username" />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
          </label>
        </div>

        {error && <div className="auth-error" role="alert">{error}</div>}

        <div className="modal-footer">
          <button type="button" className="button-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function InboxPage({ auth, onAuthChange }) {
  const isAdmin = auth?.role === 'admin'
  const [conversations, setConversations] = useState([])
  const [users, setUsers] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [thread, setThread] = useState(null)
  const [draft, setDraft] = useState('')
  const [pendingUser, setPendingUser] = useState(null)
  const [showUsers, setShowUsers] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const bottomRef = useRef(null)

  const loadConversations = useCallback(async () => {
    const list = await chatApi.conversations()
    setConversations(list)
    setActiveId((current) => {
      if (current && list.some((item) => item.id === current)) return current
      return list[0]?.id ?? null
    })
    return list
  }, [])

  const loadThread = useCallback(async (id) => {
    if (!id) {
      setThread(null)
      return
    }
    const detail = await chatApi.conversation(id)
    setThread(detail)
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    Promise.all([
      loadConversations(),
      isAdmin ? Promise.resolve([]) : chatApi.users(),
    ]).then(([, people]) => {
      if (!alive) return
      setUsers(people)
      setLoading(false)
    }).catch((requestError) => {
      if (!alive) return
      setError(requestError.message || 'Could not load messages.')
      setLoading(false)
    })
    return () => { alive = false }
  }, [isAdmin, loadConversations])

  useEffect(() => {
    loadThread(activeId).catch((requestError) => setError(requestError.message))
  }, [activeId, loadThread])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible' || busy) return
      loadConversations().catch(() => {})
      if (activeId) loadThread(activeId).catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [activeId, busy, loadConversations, loadThread])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [thread?.messages?.length, activeId])

  const selectConversation = (id) => {
    setActiveId(id)
    setPendingUser(null)
    setShowUsers(false)
    setDraft('')
    setError('')
  }

  const chooseUser = (user) => {
    setPendingUser(user)
    setActiveId(null)
    setShowUsers(false)
    setError('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || busy) return
    if (!isAdmin && !activeId && !pendingUser) return
    if (isAdmin && !activeId) return
    setBusy(true)
    setError('')
    try {
      if (pendingUser) {
        const result = await chatApi.start(pendingUser.id, text)
        setPendingUser(null)
        setActiveId(result.conversation.id)
        await loadConversations()
        await loadThread(result.conversation.id)
      } else {
        await chatApi.send(activeId, text)
        await Promise.all([loadConversations(), loadThread(activeId)])
      }
      setDraft('')
    } catch (requestError) {
      setError(requestError.message || 'Your message could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  const moderateMessage = async (index) => {
    if (!window.confirm('Remove this message for everyone?')) return
    setBusy(true)
    try {
      await chatApi.deleteMessage(activeId, index)
      await Promise.all([loadConversations(), loadThread(activeId)])
    } catch (requestError) {
      setError(requestError.message || 'Could not remove that message.')
    } finally {
      setBusy(false)
    }
  }

  const moderateConversation = async () => {
    if (!window.confirm('Delete this whole conversation for everyone?')) return
    setBusy(true)
    try {
      await chatApi.deleteConversation(activeId)
      setActiveId(null)
      setThread(null)
      await loadConversations()
    } catch (requestError) {
      setError(requestError.message || 'Could not delete that conversation.')
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    try {
      await authApi.logout()
    } finally {
      onAuthChange(null)
    }
  }

  const activeConversation = conversations.find((item) => item.id === activeId)
  const threadTitle = pendingUser
    ? (pendingUser.displayName || pendingUser.username)
    : (activeConversation?.title || thread?.title || 'Conversation')

  return (
    <section className="inbox-page">
      <div className="inbox-heading">
        <div>
          <span className="section-kicker">{isAdmin ? 'Moderation' : 'Messages'}</span>
          <h1>{isAdmin ? 'Admin inbox' : 'Your inbox'}</h1>
          <p className="muted">
            {isAdmin
              ? 'Read every conversation and remove messages when needed.'
              : 'One-to-one chats with other LittleLingo learners. Messages are stored in MongoDB.'}
          </p>
        </div>
        <div className="inbox-account">
          <span className="inbox-account-name">{auth?.displayName || auth?.username}</span>
          <button type="button" className="button-ghost" onClick={signOut}>Sign out</button>
          {!isAdmin && (
            <button type="button" className="button-primary" onClick={() => setShowUsers((value) => !value)}>
              <TinyIcon name="plus" /> New chat
            </button>
          )}
        </div>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}
      {loading && <p className="muted">Loading conversations…</p>}

      <div className="inbox-layout">
        <aside className="inbox-list">
          {showUsers && !isAdmin && (
            <div className="user-picker">
              <div className="user-picker-head">Start a chat with</div>
              {users.length === 0 && <p className="muted">No other learners yet.</p>}
              {users.map((user) => (
                <button key={user.id} type="button" className="user-option" onClick={() => chooseUser(user)}>
                  <span className="conversation-avatar">{initials(user.displayName || user.username)}</span>
                  <span>
                    <strong>{user.displayName || user.username}</strong>
                    <small>@{user.username}</small>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="inbox-list-head">Conversations</div>
          {!loading && conversations.length === 0 && !pendingUser && (
            <p className="muted inbox-empty">No conversations yet. {isAdmin ? 'They will appear here when learners chat.' : 'Use “New chat” to start one.'}</p>
          )}
          {conversations.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`conversation-item ${item.id === activeId && !pendingUser ? 'active' : ''}`}
              onClick={() => selectConversation(item.id)}
            >
              <span className="conversation-avatar">{initials(item.title)}</span>
              <span className="conversation-meta">
                <span className="conversation-title">
                  <strong>{item.title}</strong>
                  {item.unread > 0 && <span className="unread-pill">{item.unread}</span>}
                </span>
                <small>{item.lastMessagePreview || 'No messages yet'}</small>
                <time>{formatTime(item.lastMessageAt)}</time>
              </span>
            </button>
          ))}
        </aside>

        <div className="inbox-thread">
          {!activeId && !pendingUser && (
            <div className="inbox-placeholder">
              <span className="inbox-placeholder-mark">✉</span>
              <h2>Select a conversation</h2>
              <p className="muted">Choose a chat on the left to read and reply.</p>
            </div>
          )}

          {(activeId || pendingUser) && (
            <>
              <div className="inbox-thread-head">
                <div>
                  <span className="section-kicker">{isAdmin ? 'Moderating' : 'Chat'}</span>
                  <h2>{threadTitle}</h2>
                  {!isAdmin && activeConversation && <small className="muted">{activeConversation.participantNames.join(' & ')}</small>}
                </div>
                {isAdmin && activeId && (
                  <button type="button" className="icon-button danger" onClick={moderateConversation} title="Delete conversation" aria-label="Delete conversation">
                    <TinyIcon name="trash" />
                  </button>
                )}
              </div>

              <div className="inbox-messages">
                {pendingUser && (
                  <p className="muted inbox-hint">Say hello to {pendingUser.displayName || pendingUser.username} to start the conversation.</p>
                )}
                {thread?.messages?.map((message, index) => {
                  const mine = isAdmin ? message.senderRole === 'admin' : message.senderName === auth?.username
                  return (
                    <div key={message.id || index} className={`inbox-row ${mine ? 'mine' : 'theirs'}`}>
                      <div className="inbox-bubble">
                        <span className="inbox-sender">{message.senderName}</span>
                        <p>{message.text}</p>
                        <time>{formatTime(message.createdAt)}</time>
                      </div>
                      {isAdmin && (
                        <button type="button" className="icon-button danger small" onClick={() => moderateMessage(index)} title="Remove message" aria-label="Remove message">
                          <TinyIcon name="trash" />
                        </button>
                      )}
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              <div className="inbox-composer">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      send()
                    }
                  }}
                  placeholder="Write a message…"
                  rows={2}
                  maxLength={4000}
                />
                <button type="button" className="button-primary" onClick={send} disabled={busy || !draft.trim()}>
                  <TinyIcon name="send" /> Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
