import { Layers, LayoutGrid, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MAX_PLATES, layerPlateId, useDocumentStore } from '../../state/documentStore'
import './PlateTabs.css'

/** Plate switcher shown in the top bar: one tab per build plate, a "+" up to
 * MAX_PLATES and a toggle that shows every plate side by side in the 3D view. */
export function PlateTabs() {
  const plates = useDocumentStore((s) => s.plates)
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

  const commitRename = () => {
    if (editing) renamePlate(editing.id, editing.name)
    setEditing(null)
  }

  const remove = (id: string, name: string) => {
    const { layers, order, plates: all } = useDocumentStore.getState()
    const count = order.filter((lid) => layers[lid] && !layers[lid].isHole && layerPlateId(layers[lid], all) === id).length
    if (count > 0 && !window.confirm(`Delete "${name}" and the ${count} shape${count === 1 ? '' : 's'} on it?`)) return
    removePlate(id)
  }

  const single = plates.length === 1

  return (
    <div className="plate-tabs" role="tablist" aria-label="Build plates">
      {plates.map((plate) => {
        const active = plate.id === activePlateId
        return (
          <div key={plate.id} className={`plate-tab ${active ? 'plate-tab--active' : ''}`}>
            {editing?.id === plate.id ? (
              <input
                ref={inputRef}
                className="plate-tab__rename"
                value={editing.name}
                onChange={(e) => setEditing({ id: plate.id, name: e.target.value })}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setEditing(null)
                }}
                aria-label="Plate name"
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={single ? plate.name : `${plate.name} (double-click to rename)`}
                onClick={() => setActivePlate(plate.id)}
                onDoubleClick={() => setEditing({ id: plate.id, name: plate.name })}
              >
                {plate.name}
              </button>
            )}
            {active && !single && editing?.id !== plate.id && (
              <button type="button" className="plate-tab__close" title={`Delete ${plate.name}`} aria-label={`Delete ${plate.name}`} onClick={() => remove(plate.id, plate.name)}>
                <X size={11} />
              </button>
            )}
          </div>
        )
      })}
      {plates.length < MAX_PLATES && (
        <button type="button" className="plate-tabs__add" title={`Add a plate (up to ${MAX_PLATES})`} onClick={() => addPlate()}>
          <Plus size={12} />
          {single && <span>Plate</span>}
        </button>
      )}
      {!single && (
        <button
          type="button"
          className={`plate-tabs__all ${showAllPlates ? 'plate-tabs__all--on' : ''}`}
          aria-pressed={showAllPlates}
          title={showAllPlates ? 'Focus the active plate in the 3D view' : 'Show every plate side by side in the 3D view'}
          onClick={() => setShowAllPlates(!showAllPlates)}
        >
          {showAllPlates ? <Layers size={12} /> : <LayoutGrid size={12} />}
          <span>{showAllPlates ? 'This plate' : 'All plates'}</span>
        </button>
      )}
    </div>
  )
}
