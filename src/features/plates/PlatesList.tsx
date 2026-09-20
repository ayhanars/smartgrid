import { Grid2x2, Layers, LayoutGrid, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MAX_PLATES, artboardSize, layerPlateId, useDocumentStore } from '../../state/documentStore'
import { nearestPlate } from '../../lib/geometry/plateLayout'
import './PlatesList.css'

/** The plates of the project as a list above the layers, in the same
 * visual language: one row per plate (click to work on it, double-click
 * to rename, × to delete), "+" to add one and a toggle that shows every
 * plate side by side in 3D. */
export function PlatesList() {
  const plates = useDocumentStore((s) => s.plates)
  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const activePlateId = useDocumentStore((s) => s.activePlateId)
  const showAllPlates = useDocumentStore((s) => s.showAllPlates)
  const setActivePlate = useDocumentStore((s) => s.setActivePlate)
  const setShowAllPlates = useDocumentStore((s) => s.setShowAllPlates)
  const addPlate = useDocumentStore((s) => s.addPlate)
  const renamePlate = useDocumentStore((s) => s.renamePlate)
  const removePlate = useDocumentStore((s) => s.removePlate)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editingId = editing?.id
  useEffect(() => {
    if (editingId) inputRef.current?.select()
  }, [editingId])

  const counts = new Map<string, number>()
  for (const id of order) {
    const l = layers[id]
    if (!l || l.isHole) continue
    const pid = layerPlateId(l, plates)
    counts.set(pid, (counts.get(pid) ?? 0) + 1)
  }

  const commitRename = () => {
    if (editing) renamePlate(editing.id, editing.name)
    setEditing(null)
  }

  const remove = (id: string, name: string) => {
    const state = useDocumentStore.getState()
    const count = counts.get(id) ?? 0
    const bed = artboardSize(state)
    const target = plates[nearestPlate(plates.findIndex((p) => p.id === id), plates.length, bed.width, bed.height)]
    if (count > 0 && !window.confirm(`Delete "${name}"? Its ${count} shape${count === 1 ? '' : 's'} move${count === 1 ? 's' : ''} to "${target?.name ?? 'the next plate'}".`)) return
    removePlate(id)
  }

  const single = plates.length === 1

  return (
    <section className="plates-list" aria-label="Build plates">
      <div className="layers-panel__header">
        <span className="layers-panel__title">Plates</span>
        <span className="layers-panel__count">{plates.length}</span>
        <div className="layers-panel__header-actions">
          {!single && (
            <button
              type="button"
              className={`layers-panel__icon-btn ${showAllPlates ? 'plates-list__all--on' : ''}`}
              aria-pressed={showAllPlates}
              title={showAllPlates ? 'Show only the active plate in 3D' : 'Show every plate side by side in 3D'}
              onClick={() => setShowAllPlates(!showAllPlates)}
            >
              {showAllPlates ? <Layers size={14} /> : <LayoutGrid size={14} />}
            </button>
          )}
          <button type="button" className="layers-panel__icon-btn" aria-label="Add plate" title={plates.length >= MAX_PLATES ? `Up to ${MAX_PLATES} plates` : 'Add a plate'} disabled={plates.length >= MAX_PLATES} onClick={() => addPlate()}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="plates-list__rows" role="tablist">
        {plates.map((plate) => {
          const active = plate.id === activePlateId
          const count = counts.get(plate.id) ?? 0
          return (
            <div
              key={plate.id}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              className={`plate-row ${active ? 'plate-row--active' : ''}`}
              onClick={() => setActivePlate(plate.id)}
              onDoubleClick={() => setEditing({ id: plate.id, name: plate.name })}
              onKeyDown={(e) => e.key === 'Enter' && setActivePlate(plate.id)}
              title={single ? undefined : 'Click to work on this plate, double-click to rename'}
            >
              <span className="plate-row__icon">
                <Grid2x2 size={15} />
              </span>
              {editing?.id === plate.id ? (
                <input
                  ref={inputRef}
                  className="plate-row__rename"
                  value={editing.name}
                  aria-label="Plate name"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditing({ id: plate.id, name: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <span className="plate-row__name">{plate.name}</span>
              )}
              <span className="plate-row__count" title={`${count} shape${count === 1 ? '' : 's'} on this plate`}>
                {count}
              </span>
              {!single && (
                <button
                  type="button"
                  className="plate-row__delete"
                  aria-label={`Delete ${plate.name}`}
                  title={`Delete ${plate.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(plate.id, plate.name)
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
