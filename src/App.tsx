import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { EditorPage } from './pages/EditorPage'
import { createLocalProject } from './lib/persistence/localProjects'
import { emptyDocument } from './state/documentStore'

/** `/new`: create a project and jump straight into it. */
function NewProjectRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    const meta = createLocalProject(emptyDocument())
    navigate(`/p/${meta.id}`, { replace: true })
  }, [navigate])
  return null
}

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/new" element={<NewProjectRedirect />} />
        <Route path="/p/:id" element={<EditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
