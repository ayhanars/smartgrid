import type { PrintSettings, ShapeLayer } from '../../types/document'
import type { Guide, ShapeGroup } from '../../state/documentStore'

/** Everything about a project worth keeping between sessions — the
 * document itself, never the transient bits (selection, undo history). */
export interface DocumentSnapshot {
  version: 1
  name: string
  layers: Record<string, ShapeLayer>
  order: string[]
  groups: Record<string, ShapeGroup>
  bedPresetId: string
  customBedWidth: number
  customBedHeight: number
  guides: Guide[]
  displayUnit: 'mm' | 'cm' | 'in'
  printSettings: PrintSettings
}

export interface LocalProjectMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  shapeCount: number
}

const INDEX_KEY = 'smartgrid:projects'
const docKey = (id: string) => `smartgrid:project:${id}`

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function readIndex(): LocalProjectMeta[] {
  return readJson<LocalProjectMeta[]>(INDEX_KEY) ?? []
}

function writeIndex(index: LocalProjectMeta[]) {
  writeJson(INDEX_KEY, index)
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Newest first. */
export function listLocalProjects(): LocalProjectMeta[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadLocalProject(id: string): DocumentSnapshot | null {
  const snapshot = readJson<DocumentSnapshot>(docKey(id))
  return snapshot && snapshot.version === 1 ? snapshot : null
}

export function saveLocalProject(id: string, snapshot: DocumentSnapshot): boolean {
  if (!writeJson(docKey(id), snapshot)) return false
  const now = Date.now()
  const index = readIndex()
  const existing = index.find((p) => p.id === id)
  const meta: LocalProjectMeta = {
    id,
    name: snapshot.name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    shapeCount: snapshot.order.length,
  }
  writeIndex([...index.filter((p) => p.id !== id), meta])
  return true
}

export function createLocalProject(snapshot: DocumentSnapshot): LocalProjectMeta {
  const id = newId()
  saveLocalProject(id, snapshot)
  return readIndex().find((p) => p.id === id)!
}

export function duplicateLocalProject(id: string): LocalProjectMeta | null {
  const snapshot = loadLocalProject(id)
  if (!snapshot) return null
  return createLocalProject({ ...snapshot, name: `${snapshot.name} copy` })
}

export function renameLocalProject(id: string, name: string) {
  const snapshot = loadLocalProject(id)
  if (snapshot) saveLocalProject(id, { ...snapshot, name })
}

export function deleteLocalProject(id: string) {
  try {
    localStorage.removeItem(docKey(id))
  } catch {
    /* nothing to clean up */
  }
  writeIndex(readIndex().filter((p) => p.id !== id))
}
