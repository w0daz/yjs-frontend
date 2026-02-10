import { useEffect, useMemo, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { createClient } from '@supabase/supabase-js'
import './App.css'

const wsUrl = import.meta.env.VITE_YJS_WS_URL || 'ws://localhost:1234'
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

const userColors = ['#2b6cb0', '#2f855a', '#b83280', '#c05621', '#6b46c1']
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

const getSearchParam = (key) =>
  new URLSearchParams(window.location.search).get(key) || ''

const getRoomFromUrl = () => getSearchParam('room') || getSearchParam('doc')
const getInviteFromUrl = () => getSearchParam('invite')

const updateRoomInUrl = (roomId) => {
  const url = new URL(window.location.href)

  if (roomId) {
    url.searchParams.set('room', roomId)
  } else {
    url.searchParams.delete('room')
  }

  url.searchParams.delete('doc')
  url.searchParams.delete('invite')
  window.history.replaceState({}, '', url)
}

const generateRoomKey = () => {
  const bytes = new Uint8Array(6)
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  return Array.from(bytes, (value) => (value % 36).toString(36))
    .join('')
    .toUpperCase()
}

const pickColor = (value) => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }

  return userColors[Math.abs(hash) % userColors.length]
}

function App() {
  const [status, setStatus] = useState('connecting')
  const [users, setUsers] = useState([])
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [roomId, setRoomId] = useState(() => getRoomFromUrl())
  const [roomKeyInput, setRoomKeyInput] = useState('')
  const [inviteInput, setInviteInput] = useState('')
  const [roomError, setRoomError] = useState('')
  const [roomLoading, setRoomLoading] = useState(false)
  const [inviteKey, setInviteKey] = useState(() => getInviteFromUrl())

  const user = useMemo(() => {
    const fallbackId = Math.floor(Math.random() * 900) + 100
    const label = session?.user?.email || `User ${fallbackId}`
    return { name: label, color: pickColor(label) }
  }, [session])

  useEffect(() => {
    if (!supabase) {
      return () => {}
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession)
      }
    )

    return () => {
      subscription.subscription.unsubscribe()
    }
  }, [])

  const token = session?.access_token || ''

  const doc = useMemo(() => new Y.Doc(), [roomId])
  const provider = useMemo(() => {
    if (!token || !roomId) {
      return null
    }

    return new WebsocketProvider(wsUrl, roomId, doc, {
      params: { token }
    })
  }, [doc, roomId, wsUrl, token])

  useEffect(() => {
    if (!provider) {
      setStatus('disconnected')
      setUsers([])
      return () => {}
    }

    setStatus('connecting')
    const handleStatus = (event) => setStatus(event.status)
    provider.on('status', handleStatus)

    provider.awareness.setLocalStateField('user', user)

    const handleAwareness = () => {
      const states = Array.from(provider.awareness.getStates().values())
      const nextUsers = states.map((state) => state.user).filter(Boolean)
      setUsers(nextUsers)
    }

    provider.awareness.on('change', handleAwareness)
    handleAwareness()

    return () => {
      provider.awareness.off('change', handleAwareness)
      provider.off('status', handleStatus)
      provider.destroy()
    }
  }, [provider, user])

  useEffect(() => () => doc.destroy(), [doc])

  const editorExtensions = useMemo(() => {
    if (!provider) {
      return [StarterKit]
    }

    return [
      StarterKit,
      Collaboration.configure({ document: doc }),
      CollaborationCursor.configure({ provider, user })
    ]
  }, [doc, provider, user])

  const editor = useEditor({
    extensions: editorExtensions,
    editable: Boolean(provider),
    editorProps: {
      attributes: {
        class: 'editor'
      }
    }
  })

  const handleSignIn = async (event) => {
    event.preventDefault()
    if (!supabase) {
      setAuthError('Supabase is not configured')
      return
    }

    setAuthError('')
    setAuthLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    setAuthLoading(false)

    if (error) {
      setAuthError(error.message)
    }
  }

  const handleSignUp = async (event) => {
    event.preventDefault()
    if (!supabase) {
      setAuthError('Supabase is not configured')
      return
    }

    setAuthError('')
    setAuthLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password
    })
    setAuthLoading(false)

    if (error) {
      setAuthError(error.message)
    }
  }

  const handleSignOut = async () => {
    if (!supabase) {
      return
    }

    await supabase.auth.signOut()
    setRoomId('')
    setRoomKeyInput('')
    setInviteInput('')
    setRoomError('')
    setInviteKey('')
    updateRoomInUrl('')
  }

  const handleCreateRoom = async () => {
    if (!supabase || !session) {
      return
    }

    setRoomError('')
    setRoomLoading(true)
    const newKey = generateRoomKey()
    const { data: room, error } = await supabase
      .from('rooms')
      .insert({ key: newKey, owner_id: session.user.id })
      .select('id, key')
      .single()

    if (error || !room) {
      setRoomError(error?.message || 'Failed to create room')
      setRoomLoading(false)
      return
    }

    const { error: memberError } = await supabase
      .from('room_members')
      .upsert({
        room_id: room.id,
        user_id: session.user.id
      }, {
        onConflict: 'room_id,user_id'
      })

    if (memberError) {
      setRoomError(memberError.message)
      setRoomLoading(false)
      return
    }

    setRoomId(room.id)
    setInviteKey('')
    updateRoomInUrl(room.id)
    setRoomLoading(false)
  }

  const joinRoomByKey = async (keyValue) => {
    if (!supabase || !session) {
      return
    }

    const trimmedKey = keyValue.trim().toUpperCase()
    if (!trimmedKey) {
      setRoomError('Enter a room key')
      return
    }

    setRoomError('')
    setRoomLoading(true)

    const { data: roomIdFromRpc, error } = await supabase
      .rpc('join_room_by_key', { p_key: trimmedKey })

    if (error || !roomIdFromRpc) {
      setRoomError(error?.message || 'Room not found')
      setRoomLoading(false)
      return
    }

    setRoomId(roomIdFromRpc)
    setRoomKeyInput('')
    setInviteInput('')
    setInviteKey('')
    updateRoomInUrl(roomIdFromRpc)
    setRoomLoading(false)
  }

  const handleJoinByKey = async (event) => {
    event.preventDefault()
    await joinRoomByKey(roomKeyInput)
  }

  const handleJoinByInvite = async (event) => {
    event.preventDefault()
    const trimmed = inviteInput.trim()
    if (!trimmed) {
      setRoomError('Enter an invite link or key')
      return
    }

    let keyValue = trimmed
    try {
      const url = new URL(trimmed)
      keyValue = url.searchParams.get('invite') || trimmed
    } catch {
      keyValue = trimmed
    }

    await joinRoomByKey(keyValue)
  }

  useEffect(() => {
    if (!inviteKey || !session) {
      return
    }

    joinRoomByKey(inviteKey)
  }, [inviteKey, session])

  if (!supabase) {
    return (
      <div className="app">
        <div className="panel">
          <h1>Collaborative Editor</h1>
          <p className="subtitle">Missing Supabase configuration.</p>
          <p className="helper">
            Add <span className="mono">VITE_SUPABASE_URL</span> and{' '}
            <span className="mono">VITE_SUPABASE_ANON_KEY</span> to your
            environment.
          </p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="app">
        <div className="panel">
          <h1>Sign in</h1>
          <p className="subtitle">Access is required to join a document.</p>
          <form className="auth-form" onSubmit={handleSignIn}>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {authError ? <p className="error">{authError}</p> : null}
            <div className="actions">
              <button className="primary" type="submit" disabled={authLoading}>
                Sign in
              </button>
              <button
                type="button"
                onClick={handleSignUp}
                disabled={authLoading}
              >
                Create account
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  if (!roomId) {
    return (
      <div className="app">
        <div className="panel">
          <h1>Choose a room</h1>
          <p className="subtitle">
            Create a new room or join an existing one.
          </p>
          <div className="room-actions">
            <button
              className="primary"
              type="button"
              onClick={handleCreateRoom}
              disabled={roomLoading}
            >
              Create room
            </button>
            <form className="room-form" onSubmit={handleJoinByKey}>
              <label className="field">
                <span>Join with room key</span>
                <input
                  type="text"
                  value={roomKeyInput}
                  onChange={(event) => setRoomKeyInput(event.target.value)}
                  placeholder="e.g. 8K2A1F"
                />
              </label>
              <button type="submit" disabled={roomLoading}>
                Join room
              </button>
            </form>
            <form className="room-form" onSubmit={handleJoinByInvite}>
              <label className="field">
                <span>Join with invite link</span>
                <input
                  type="text"
                  value={inviteInput}
                  onChange={(event) => setInviteInput(event.target.value)}
                  placeholder="Paste invite link"
                />
              </label>
              <button type="submit" disabled={roomLoading}>
                Join with invite
              </button>
            </form>
            {roomError ? <p className="error">{roomError}</p> : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Collaborative Editor</h1>
          <p className="subtitle">Room: {roomId}</p>
        </div>
        <div className="header-actions">
          <div className={`status status--${status}`}>{status}</div>
          <button className="ghost" type="button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="meta">
        <div className="user-list">
          <span className="user-label">Connected users:</span>
          {users.length ? (
            users.map((connectedUser, index) => (
              <span
                key={`${connectedUser.name}-${index}`}
                className="user-pill"
                style={{ borderColor: connectedUser.color }}
              >
                {connectedUser.name}
              </span>
            ))
          ) : (
            <span className="user-empty">None</span>
          )}
        </div>
        <span className="ws">WS: {wsUrl}</span>
      </div>

      <div className="editor-shell">
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="editor-placeholder">Loading editor...</div>
        )}
      </div>
    </div>
  )
}

export default App
