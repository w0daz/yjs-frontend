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
const defaultRoom = 'doc-1'

const userColors = ['#2b6cb0', '#2f855a', '#b83280', '#c05621', '#6b46c1']
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

function App() {
  const [status, setStatus] = useState('connecting')
  const [users, setUsers] = useState([])
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const roomName = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('doc') || defaultRoom
  }, [])

  const user = useMemo(() => {
    const id = Math.floor(Math.random() * 900) + 100
    const color = userColors[id % userColors.length]
    return { name: `User ${id}`, color }
  }, [])

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

  const doc = useMemo(() => new Y.Doc(), [])
  const provider = useMemo(() => {
    if (!token) {
      return null
    }

    return new WebsocketProvider(wsUrl, roomName, doc, {
      params: { token }
    })
  }, [doc, roomName, wsUrl, token])

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
  }

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

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Collaborative Editor</h1>
          <p className="subtitle">Room: {roomName}</p>
        </div>
        <div className="header-actions">
          <div className={`status status--${status}`}>{status}</div>
          <button className="ghost" type="button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="meta">
        <span>Connected users: {users.length}</span>
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
