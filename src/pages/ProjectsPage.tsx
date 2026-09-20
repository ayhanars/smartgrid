import { useProjects } from '../features/projects/useProjects'
import { ProjectBanners, ProjectGrid } from '../features/projects/ProjectCards'
import { PageHeader } from './HomeLayout'
import './HomePage.css'

/** `/projects`: every project, local and cloud, in one list. */
export function ProjectsPage() {
  const projects = useProjects()
  const n = projects.entries.length
  return (
    <div>
      <PageHeader
        title="Projects"
        hint={`${n === 0 ? 'Nothing yet' : `${n} project${n === 1 ? '' : 's'}`}${projects.user && !projects.cloudError && projects.cloudProjects === null ? ' · checking the cloud…' : ''}`}
      />
      <ProjectBanners projects={projects} />
      <ProjectGrid projects={projects} />
    </div>
  )
}
