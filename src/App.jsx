import { useEffect, useMemo, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import './App.css'

const wsUrl = import.meta.env.VITE_YJS_WS_URL || 'ws://localhost:1234'
const defaultRoom = 'doc-1'

const userColors = ['#2b6cb0', '#2f855a', '#b83280', '#c05621', '#6b46c1']

function App() {
  const [status, setStatus] = useState('connecting')
  const [users, setUsers] = useState([])

  const roomName = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('doc') || defaultRoom
  }, [])

  const user = useMemo(() => {
    const id = Math.floor(Math.random() * 900) + 100
    const color = userColors[id % userColors.length]
    return { name: `User ${id}`, color }
  }, [])

  const doc = useMemo(() => new Y.Doc(), [])
  const provider = useMemo(
    () => new WebsocketProvider(wsUrl, roomName, doc),
    [doc, roomName]
  )

  useEffect(() => {
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
      doc.destroy()
    }
  }, [doc, provider, user])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Collaboration.configure({ document: doc }),
      CollaborationCursor.configure({ provider, user })
    ],
    editorProps: {
      attributes: {
        class: 'editor'
      }
    }
  })

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Collaborative Editor</h1>
          <p className="subtitle">Room: {roomName}</p>
        </div>
        <div className={`status status--${status}`}>{status}</div>
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
