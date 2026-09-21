import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { HomeLayout } from './pages/HomeLayout'
import { RecentsPage } from './pages/RecentsPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { TrashPage } from './pages/TrashPage'
import { CollectionsPage } from './pages/CollectionsPage'
import { CollectionPage } from './pages/CollectionPage'
import { EditorPage } from './pages/EditorPage'
import { AccountPage } from './pages/AccountPage'
import { CommunityPage } from './pages/CommunityPage'
import { CommunityModelsPage } from './pages/CommunityModelsPage'
import { CommunityCollectionsPage } from './pages/CommunityCollectionsPage'
import { SearchPage } from './pages/SearchPage'
import { ProfilePage } from './pages/ProfilePage'
import { CommunityItemPage } from './pages/CommunityItemPage'
import { AdminPage } from './pages/AdminPage'
import { AuthGate } from './features/auth/AuthGate'
import { PasswordRecoveryDialog } from './features/auth/PasswordRecoveryDialog'
import { createLocalProject } from './lib/persistence/localProjects'
import { emptyDocument } from './state/documentStore'

/** `/new`: create a project and jump straight into it. */
function NewProjectRedirect() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const create = params.get('create')
  useEffect(() => {
    const meta = createLocalProject(emptyDocument())
    navigate(`/p/${meta.id}${create ? `?create=${encodeURIComponent(create)}` : ''}`, { replace: true })
  }, [navigate, create])
  return null
}

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/new" element={<NewProjectRedirect />} />
        <Route path="/p/:id" element={<EditorPage />} />
        <Route element={<HomeLayout />}>
          <Route path="/" element={<RecentsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/collections/:id" element={<CollectionPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/community/models" element={<CommunityModelsPage />} />
          <Route path="/community/collections" element={<CommunityCollectionsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/u/:id" element={<ProfilePage />} />
          <Route path="/c/:id" element={<CommunityItemPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <AuthGate />
      <PasswordRecoveryDialog />
    </HashRouter>
  )
}

export default App
