import type { PrintSettings, ShapeLayer } from '../../types/document'
import type { Guide, Plate, ShapeGroup } from '../../state/documentStore'

/** Everything about a project worth keeping between sessions — the
 * document itself, never the transient bits (selection, undo history). */
export interface DocumentSnapshot {
  version: 1
  name: string
  layers: Record<string, ShapeLayer>
  order: string[]
  groups: Record<string, ShapeGroup>
  /** Build plates; absent on older saves (one plate). */
  plates?: Plate[]
  bedPresetId: string
  customBedWidth: number
  customBedHeight: number
  guides: Guide[]
  displayUnit: 'mm' | 'cm' | 'in'
  /** 2D artboard background; absent on older saves (white). */
  artboardColor?: string
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
const TRASH_KEY = 'smartgrid:trash'

/** How long a deleted project stays in the trash before it is purged. */
export const TRASH_DAYS = 30

export interface TrashedProjectMeta extends LocalProjectMeta {
  deletedAt: number
}
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
  const copy = createLocalProject({ ...snapshot, name: `${snapshot.name} copy` })
  try {
    const thumb = localStorage.getItem(`smartgrid:thumb:${id}`)
    if (thumb) localStorage.setItem(`smartgrid:thumb:${copy.id}`, thumb)
  } catch {
    /* the SVG fallback still draws */
  }
  return copy
}

export function renameLocalProject(id: string, name: string) {
  const snapshot = loadLocalProject(id)
  if (snapshot) saveLocalProject(id, { ...snapshot, name })
}

function readTrash(): TrashedProjectMeta[] {
  return readJson<TrashedProjectMeta[]>(TRASH_KEY) ?? []
}

function writeTrash(trash: TrashedProjectMeta[]) {
  writeJson(TRASH_KEY, trash)
}

function removeDoc(id: string) {
  try {
    localStorage.removeItem(docKey(id))
  } catch {
    /* nothing to clean up */
  }
}

/** Moves a project to the trash (the document stays until it is purged). */
export function deleteLocalProject(id: string) {
  const index = readIndex()
  const meta = index.find((p) => p.id === id)
  writeIndex(index.filter((p) => p.id !== id))
  if (meta) writeTrash([{ ...meta, deletedAt: Date.now() }, ...readTrash().filter((p) => p.id !== id)])
  else removeDoc(id)
}

/** The trash, newest deletion first; anything past its keep period is
 * purged on the way. */
export function listLocalTrash(days = TRASH_DAYS): TrashedProjectMeta[] {
  const cutoff = Date.now() - days * 86_400_000
  const trash = readTrash()
  const kept = trash.filter((p) => p.deletedAt >= cutoff)
  if (kept.length !== trash.length) {
    for (const p of trash) if (p.deletedAt < cutoff) removeDoc(p.id)
    writeTrash(kept)
  }
  return kept.sort((a, b) => b.deletedAt - a.deletedAt)
}

export function restoreLocalProject(id: string): boolean {
  const trash = readTrash()
  const meta = trash.find((p) => p.id === id)
  if (!meta) return false
  writeTrash(trash.filter((p) => p.id !== id))
  if (!loadLocalProject(id)) return false
  const { deletedAt: _dropped, ...rest } = meta
  writeIndex([...readIndex().filter((p) => p.id !== id), rest])
  return true
}

/** Gone for good, from the trash or the list. */
export function purgeLocalProject(id: string) {
  removeDoc(id)
  writeIndex(readIndex().filter((p) => p.id !== id))
  writeTrash(readTrash().filter((p) => p.id !== id))
}

/** Wipes every project (and the index) from this browser. */
export function deleteAllLocalProjects() {
  for (const p of [...readIndex(), ...readTrash()]) removeDoc(p.id)
  writeIndex([])
  writeTrash([])
}
