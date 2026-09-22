import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDownToLine,
  Layers2,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignHorizontalSpaceBetween,
  Plus,
  Ruler,
  X,
  AlignVerticalSpaceBetween,
  ChevronDown,
  ChevronRight,
  Copy,
  Pin,
  Trash2,
} from 'lucide-react'
import { shapeWorldBounds, useDocumentStore, type AlignMode, artboardSize, orderOnPlate, layerPlateId, shellUnitSolid } from '../../state/documentStore'
import { useViewStore } from '../../state/viewStore'
import { orderedProfile, presetProfile, profileOverhangs, profileScaleAt, type ProfilePreset } from '../../lib/geometry/profile'
import { layerPrintQuaternion } from '../../lib/geometry/layerGeometry'
import * as THREE from 'three'
import type { ProfilePoint, ShapeProfile } from '../../types/document'
import { InspectorFooter } from './InspectorFooter'
import { IconButton } from '../../components/IconButton'
import { DEFAULT_PERFORATION, DEFAULT_TEXTURE, HOLE_SHAPES, INFILL_PATTERNS, defaultWallMargin, LAYER_HEIGHT_PRESETS_MM, SEAM_PLACEMENTS, TEXTURE_PATTERNS, type InfillPattern, type SeamPlacement, type Perforation, type ShapeLayer, type SurfaceTexture, type TexturePattern, type WallSide } from '../../types/document'
import { TexturePreview } from './TexturePreview'
import { prepareTile } from '../../lib/geometry/customTile'
import { roundPolygonCorners, smartPolishCorners } from '../../lib/geometry/rounding'
import { computeSafeBevel } from '../../lib/geometry/offset'
import { bedPresets, CUSTOM_BED_ID, CUSTOM_BED_MAX_Z, getBedPreset } from '../../lib/geometry/bedPresets'
import { RotationDial } from './RotationDial'
import { HeightSlider } from './HeightSlider'
import { AngleWheel } from './AngleWheel'
import { ProductSection } from '../create/ProductSection'
import { useAnalysisStore, visibleWarning } from '../../state/analysisStore'
import { unitDropDelta, unitRest } from '../../lib/geometry/stacking'
import './InspectorPanel.css'

const UNIT_FACTORS = { mm: 1, cm: 10, in: 25.4 } as const

export function InspectorPanel() {
  const layers = useDocumentStore((s) => s.layers)
  const selection = useDocumentStore((s) => s.selection)
  const duplicateShapes = useDocumentStore((s) => s.duplicateShapes)
  const removeShapes = useDocumentStore((s) => s.removeShapes)

  // A hollowed shape (solid + its cavity) is edited as one thing.
  const unitSolid = shellUnitSolid(layers, selection)
  const selectedLayer = selection.length === 1 ? (layers[selection[0]] ?? null) : unitSolid
  const multiCount = unitSolid ? 1 : selection.length
  const effectIds = unitSolid ? [unitSolid.id] : selection
  // A generated product (every selected shape in one group with a recipe)
  // gets its specs as the first tab.
  const groups = useDocumentStore((s) => s.groups)
  const selectedGroups = new Set(selection.map((id) => layers[id]?.groupId).filter((g): g is string => !!g))
  const productGroupId = selectedGroups.size === 1 && groups[[...selectedGroups][0]]?.recipe ? [...selectedGroups][0] : null

  return (
    <div className="inspector-panel">
      <div className="inspector-panel__selection">
        <span>
          {selection.length === 0
            ? 'No selection'
            : selection.length === 1
              ? selectedLayer?.name
              : unitSolid
                ? `${unitSolid.name} · hollow`
                : `${selection.length} shapes selected`}
        </span>
        {selection.length > 0 && (
          <div className="inspector-panel__selection-actions">
            <button type="button" aria-label="Duplicate" onClick={() => duplicateShapes(selection)}>
              <Copy size={13} />
            </button>
            <button type="button" aria-label="Delete" onClick={() => removeShapes(selection)}>
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      <div className="inspector-panel__units-row">
        <span>Units</span>
        <UnitToggle />
      </div>

      {selection.length === 0 ? (
        <Tabs
          storageKey="doc"
          tabs={[
            { id: 'printer', label: 'Printer', content: <><BedPresetsSection /><ArtboardSection /></> },
            { id: 'print', label: 'Print', content: <PrintSettingsSection /> },
          ]}
        />
      ) : (
        <Tabs
          storageKey={productGroupId ? 'product' : 'shape'}
          followView
          tabs={[
            ...(productGroupId ? [{ id: 'product', label: 'Product', content: <ProductSection selection={selection} /> }] : []),
            { id: 'design', label: 'Design', content: <><AlignmentSection ids={selection} /><DesignTab layer={selectedLayer} multiCount={multiCount} /></> },
            { id: '3d', label: '3D', content: <ThreeDTab layer={selectedLayer} multiCount={multiCount} /> },
            { id: 'effects', label: 'Effects', content: <EffectsTab layer={selectedLayer} ids={effectIds} /> },
          ]}
        />
      )}
      <InspectorFooter />
    </div>
  )
}

interface TabSpec {
  id: string
  label: string
  content: ReactNode
}

/** The panel's sections as tabs; the chosen tab is remembered per kind of
 * selection (document / shapes) so switching selections keeps your place. */
function Tabs({ tabs, storageKey, followView }: { tabs: TabSpec[]; storageKey: string; followView?: boolean }) {
  const key = `smartgrid:inspector-tab:${storageKey}`
  const [active, setActive] = useState(() => {
    try {
      return localStorage.getItem(key) ?? tabs[0].id
    } catch {
      return tabs[0].id
    }
  })
  // In 3D-only view the 3D tab is the one you want.
  const viewMode = useViewStore((s) => s.viewMode)
  const lastMode = useRef(viewMode)
  useEffect(() => {
    if (followView && viewMode === '3d' && lastMode.current !== '3d') setActive('3d')
    lastMode.current = viewMode
  }, [viewMode, followView])
  const current = tabs.find((t) => t.id === active) ?? tabs[0]
  const choose = (id: string) => {
    setActive(id)
    try {
      localStorage.setItem(key, id)
    } catch {
      /* private mode */
    }
  }
  return (
    <>
      <div className="inspector-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={current.id === t.id} className={`inspector-tab ${current.id === t.id ? 'inspector-tab--active' : ''}`} onClick={() => choose(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="inspector-panel__body" role="tabpanel">
        {current.content}
      </div>
    </>
  )
}

/** Everything that removes or carves material: shell, pocket, texture,
 * perforation, carve. */
function EffectsTab({ layer, ids }: { layer: ShapeLayer | null; ids: string[] }) {
  if (ids.length === 2) return <CarveSection ids={ids} />
  if (!layer) return <EmptyState text="Select a single shape for texture and perforation, or two shapes to carve one with the other." />
  return (
    <>
      <TextureSection layer={layer} />
      {!layer.isHole && <PerforationSection layer={layer} />}
    </>
  )
}

function UnitToggle() {
  const displayUnit = useDocumentStore((s) => s.displayUnit)
  const setDisplayUnit = useDocumentStore((s) => s.setDisplayUnit)
  return (
    <div className="inspector-unit-toggle">
      {(['mm', 'cm', 'in'] as const).map((u) => (
        <button
          key={u}
          type="button"
          className={`inspector-unit-toggle__opt ${displayUnit === u ? 'inspector-unit-toggle__opt--active' : ''}`}
          onClick={() => setDisplayUnit(u)}
        >
          {u}
        </button>
      ))}
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="inspector-section">
      <div className="inspector-section__header">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

function round(v: number, decimals = 1) {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

function Field({
  label,
  value,
  onChange,
  suffix,
  disabled,
  decimals = 1,
}: {
  label: string
  value: number
  onChange?: (v: number) => void
  suffix?: string
  disabled?: boolean
  /** Display precision — every field is 0.1 except the few that need finer
   * (layer height at 0.12 mm). */
  decimals?: number
}) {
  // `value`/`onChange` always deal in mm — the store's one source of truth —
  // every other unit is purely a display + input conversion at this layer,
  // keyed off suffix === 'mm' so a field can opt out (nothing else uses 'mm'
  // as a non-length suffix right now, so this is unambiguous).
  const displayUnit = useDocumentStore((s) => s.displayUnit)
  const isLength = suffix === 'mm'
  const factor = isLength ? UNIT_FACTORS[displayUnit] : 1
  const displayValue = value / factor
  const displaySuffix = isLength ? displayUnit : suffix

  const [text, setText] = useState(String(round(displayValue, decimals)))

  useEffect(() => {
    setText(String(round(displayValue, decimals)))
  }, [displayValue, decimals])

  const commit = () => {
    const parsed = parseFloat(text)
    if (!Number.isNaN(parsed) && onChange) onChange(parsed * factor)
    else setText(String(round(displayValue, decimals)))
  }

  return (
    <label className="inspector-field">
      <span className="inspector-field__label">{label}</span>
      <span className="inspector-field__input-wrap">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled || !onChange}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        {displaySuffix && <span className="inspector-field__suffix">{displaySuffix}</span>}
      </span>
    </label>
  )
}

function EmptyState({ text }: { text: string }) {
  return <p className="inspector-empty">{text}</p>
}

function DesignTab({ layer, multiCount }: { layer: ShapeLayer | null; multiCount: number }) {
  const solidName = useDocumentStore((s) => (layer?.shellOf ? s.layers[layer.shellOf.solidId]?.name : undefined))
  const resizeShape = useDocumentStore((s) => s.resizeShape)
  const moveShapesBy = useDocumentStore((s) => s.moveShapesBy)
  const setLayerZ = useDocumentStore((s) => s.setLayerZ)

  if (!layer) {
    return <EmptyState text={`${multiCount} shapes selected — position & size editing needs just one.`} />
  }

  const bounds = shapeWorldBounds(layer)
  const bed = artboardSize(useDocumentStore.getState())
  const tooBig = !layer.isHole && (bounds.width > bed.width + 1e-6 || bounds.height > bed.height + 1e-6)

  return (
    <>
      <Section title="Position & Size">
        <div className="inspector-grid-2">
          <Field label="X" value={bounds.x} suffix="mm" disabled={layer.locked} onChange={(v) => moveShapesBy([layer.id], v - bounds.x, 0)} />
          <Field label="Y" value={bounds.y} suffix="mm" disabled={layer.locked} onChange={(v) => moveShapesBy([layer.id], 0, v - bounds.y)} />
          <Field label="W" value={bounds.width} suffix="mm" disabled={layer.locked} onChange={(v) => resizeShape(layer.id, { ...bounds, width: v })} />
          <Field label="H" value={bounds.height} suffix="mm" disabled={layer.locked} onChange={(v) => resizeShape(layer.id, { ...bounds, height: v })} />
          <Field
            label="Z"
            value={layer.transform.z}
            suffix="mm"
            disabled={layer.locked}
            onChange={(v) => setLayerZ(layer.id, v)}
          />
        </div>
        {layer.isHole && !layer.shellOf && (
          <p className="inspector-note">
            Print height of this cutter's own bottom — independent of whatever solid it cuts into.
          </p>
        )}
        {layer.shellOf && (
          <p className="inspector-note">
            This cavity is made from {solidName ?? 'its shape'} and follows it. Change the walls in that shape's Shell section.
          </p>
        )}
      </Section>
      {tooBig && (
        <div className="inspector-note inspector-note--warn">
          Larger than the bed ({Math.round(bed.width)} × {Math.round(bed.height)} mm).{' '}
          <button type="button" className="inspector-link" onClick={() => useDocumentStore.getState().splitForBed(layer.id)}>
            Split across plates
          </button>
        </div>
      )}

      <AppearanceSection layer={layer} />

      {layer.isHole && <RecessedPocketSection layer={layer} />}
      {layer.isHole && <HoleSizePresetsSection layer={layer} />}
    </>
  )
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function AppearanceSection({ layer }: { layer: ShapeLayer }) {
  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const setColor = useDocumentStore((s) => s.setColor)
  const setOpacity = useDocumentStore((s) => s.setOpacity)
  const [hexDraft, setHexDraft] = useState(layer.color)
  useEffect(() => setHexDraft(layer.color), [layer.color])

  // The palette is the project's own colors (every solid's fill, in layer
  // order) so a new shape can pick up an existing filament in one click.
  const projectColors = useMemo(() => {
    const seen: string[] = []
    for (const id of order) {
      const l = layers[id]
      if (l && !l.isHole && !seen.includes(l.color)) seen.push(l.color)
    }
    return seen
  }, [layers, order])

  const commitHex = () => {
    const v = hexDraft.trim()
    if (HEX_COLOR.test(v)) setColor(layer.id, v.toLowerCase())
    else setHexDraft(layer.color)
  }

  return (
    <Section title="Appearance">
      <div className="inspector-color-row">
        <label className="inspector-color-swatch" style={{ background: layer.color }} title="Pick a color">
          <input type="color" value={layer.color} aria-label="Color picker" onChange={(e) => setColor(layer.id, e.target.value)} />
        </label>
        <input
          type="text"
          value={hexDraft}
          aria-label="Color hex"
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="inspector-color-hex"
        />
      </div>
      {projectColors.length > 0 && (
        <div className="inspector-color-palette" aria-label="Colors used in this project">
          {projectColors.map((c) => (
            <button
              key={c}
              type="button"
              className={`inspector-color-palette__dot ${c === layer.color ? 'inspector-color-palette__dot--active' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={`Use ${c}`}
              onClick={() => setColor(layer.id, c)}
            />
          ))}
        </div>
      )}
      {!layer.isHole && (
        <div className="inspector-opacity-row">
          <Field label="Opacity" value={layer.opacity ?? 100} suffix="%" onChange={(v) => setOpacity(layer.id, v)} />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={layer.opacity ?? 100}
            aria-label="Opacity slider"
            onChange={(e) => setOpacity(layer.id, parseFloat(e.target.value))}
          />
        </div>
      )}
      <p className="inspector-note">Opacity is a viewing aid for lining things up in 2D and 3D — prints are always solid.</p>
    </Section>
  )
}

const ALIGN_ACTIONS: { mode: AlignMode; label: string; icon: typeof AlignStartVertical }[] = [
  { mode: 'left', label: 'Align left', icon: AlignStartVertical },
  { mode: 'hcenter', label: 'Align horizontal centers', icon: AlignCenterVertical },
  { mode: 'right', label: 'Align right', icon: AlignEndVertical },
  { mode: 'top', label: 'Align top', icon: AlignStartHorizontal },
  { mode: 'vcenter', label: 'Align vertical centers', icon: AlignCenterHorizontal },
  { mode: 'bottom', label: 'Align bottom', icon: AlignEndHorizontal },
]

function AlignmentSection({ ids }: { ids: string[] }) {
  const alignShapes = useDocumentStore((s) => s.alignShapes)
  const layers = useDocumentStore((s) => s.layers)
  // A group counts as one thing: a lone group aligns to the artboard.
  const units = new Set(ids.map((id) => layers[id]?.groupId ?? id)).size
  return (
    <Section title="Alignment" action={<span className="inspector-section__hint">{units > 1 ? 'to selection' : 'to artboard'}</span>}>
      <div className="inspector-align-row">
        <div className="inspector-align-group">
          {ALIGN_ACTIONS.slice(0, 3).map(({ mode, label, icon: Icon }) => (
            <IconButton key={mode} size="md" aria-label={label} onClick={() => alignShapes(ids, mode)}>
              <Icon size={16} />
            </IconButton>
          ))}
        </div>
        <div className="inspector-align-group">
          {ALIGN_ACTIONS.slice(3).map(({ mode, label, icon: Icon }) => (
            <IconButton key={mode} size="md" aria-label={label} onClick={() => alignShapes(ids, mode)}>
              <Icon size={16} />
            </IconButton>
          ))}
        </div>
        <div className="inspector-align-group" title={units < 3 ? 'Select three or more shapes to space them evenly' : undefined}>
          <IconButton size="md" aria-label="Space evenly across" disabled={units < 3} onClick={() => alignShapes(ids, 'hspace')}>
            <AlignHorizontalSpaceBetween size={16} />
          </IconButton>
          <IconButton size="md" aria-label="Space evenly down" disabled={units < 3} onClick={() => alignShapes(ids, 'vspace')}>
            <AlignVerticalSpaceBetween size={16} />
          </IconButton>
        </div>
      </div>
    </Section>
  )
}

const DEFAULT_FLOOR_THICKNESS_MM = 0.6

function RecessedPocketSection({ layer }: { layer: ShapeLayer }) {
  const [floorThickness, setFloorThickness] = useState(DEFAULT_FLOOR_THICKNESS_MM)
  const snapHoleToPocket = useDocumentStore((s) => s.snapHoleToPocket)
  const layerHeight = useDocumentStore((s) => s.printSettings.layerHeight)
  const floorLayers = Math.max(1, Math.ceil(floorThickness / layerHeight - 1e-6))
  const pocketTop = layer.transform.z + layer.extrusionDepth
  const pauseLayer = Math.ceil(pocketTop / layerHeight - 1e-6)

  return (
    <Section title="Recessed Pocket">
      <Field label="Floor thickness" value={floorThickness} suffix="mm" onChange={(v) => setFloorThickness(Math.max(0, v))} />
      <p className="inspector-note">
        Sinks this hole to the bottom of whatever it overlaps, leaving {floorLayers} printed layer{floorLayers === 1 ? '' : 's'} (
        {round(floorLayers * layerHeight)} mm) under it. Its own depth stays the magnet's thickness, so the layers above close over it.
      </p>
      <button type="button" className="inspector-export-btn" onClick={() => snapHoleToPocket(layer.id, floorThickness)}>
        Snap to Recessed Pocket
      </button>
      {layer.transform.z > 0 && (
        <p className="inspector-note">
          Pause the print at layer <strong>{pauseLayer}</strong> ({round(pocketTop)} mm) to drop the magnet in, then resume.
        </p>
      )}
    </Section>
  )
}

const DEFAULT_WALL_MM = 1.6
const DEFAULT_SHELL_FLOOR_MM = 1.2

/** Shell: one click turns a solid into a container by generating the
 * negative (hole) object from its own outline — the same mechanism as a
 * hand-drawn hole, just automated and grouped with the solid. */
/** The cavity that hollows this solid, if it has been hollowed out. */
function useCavityOf(solidId: string): ShapeLayer | null {
  return useDocumentStore((s) => {
    for (const id of s.order) {
      const l = s.layers[id]
      if (l?.shellOf?.solidId === solidId) return l
    }
    return null
  })
}

function ShellSection({ layer }: { layer: ShapeLayer }) {
  const [wall, setWall] = useState(DEFAULT_WALL_MM)
  const [floor, setFloor] = useState(DEFAULT_SHELL_FLOOR_MM)
  const [openFrom, setOpenFrom] = useState<'top' | 'bottom'>('top')
  const hollowOut = useDocumentStore((s) => s.hollowOut)
  const updateShell = useDocumentStore((s) => s.updateShell)
  const removeShapes = useDocumentStore((s) => s.removeShapes)
  const setSelection = useDocumentStore((s) => s.setSelection)
  const layerHeight = useDocumentStore((s) => s.printSettings.layerHeight)
  const setNotice = useViewStore((s) => s.setNotice)
  const floorLayers = Math.max(1, Math.ceil(floor / layerHeight - 1e-6))
  const cavity = useCavityOf(layer.id)

  if (cavity?.shellOf) {
    const link = cavity.shellOf
    return (
      <Section
        title="Shell"
        action={
          <button
            type="button"
            className="inspector-section__hint inspector-section__hint--button"
            onClick={() => {
              removeShapes([cavity.id])
              setSelection([layer.id])
            }}
          >
            Remove cavity
          </button>
        }
      >
        <div className="inspector-grid-2">
          <Field label="Wall thickness" value={link.wall} suffix="mm" onChange={(v) => updateShell(cavity.id, { wall: Math.max(0.4, v) })} />
          <Field label={link.openFrom === 'top' ? 'Floor thickness' : 'Ceiling thickness'} value={link.floor} suffix="mm" onChange={(v) => updateShell(cavity.id, { floor: Math.max(0, v) })} />
        </div>
        <p className="inspector-field__label">Open from</p>
        <div className="inspector-preset-chips">
          {(['top', 'bottom'] as const).map((side) => (
            <button
              key={side}
              type="button"
              className={`inspector-preset-chip ${link.openFrom === side ? 'inspector-preset-chip--active' : ''}`}
              onClick={() => updateShell(cavity.id, { openFrom: side })}
            >
              {side === 'top' ? 'Top (cup, tray, planter)' : 'Bottom (cap, lid)'}
            </button>
          ))}
        </div>
        <p className="inspector-note">Hollowed out. The cavity follows this shape: resize, move or reshape it and the walls stay {round(link.wall)} mm.</p>
      </Section>
    )
  }

  const run = () => {
    const result = hollowOut(layer.id, { wall, floor, openFrom })
    if (!result) {
      setNotice(`${layer.name} is too narrow to hollow out with ${round(wall)} mm walls — try a thinner wall.`)
      return
    }
    setNotice(
      result.wall < wall - 0.01
        ? `Hollowed out ${layer.name} — walls limited to ${round(result.wall)} mm where the outline is narrow.`
        : `Hollowed out ${layer.name}: ${round(wall)} mm walls, ${round(floorLayers * layerHeight)} mm ${openFrom === 'top' ? 'floor' : 'ceiling'}. The cavity is a hole object grouped with it.`,
    )
  }

  return (
    <Section title="Shell" action={<span className="inspector-section__hint">hollow out</span>}>
      <div className="inspector-grid-2">
        <Field label="Wall thickness" value={wall} suffix="mm" onChange={(v) => setWall(Math.max(0.4, v))} />
        <Field label={openFrom === 'top' ? 'Floor thickness' : 'Ceiling thickness'} value={floor} suffix="mm" onChange={(v) => setFloor(Math.max(0, v))} />
      </div>
      <p className="inspector-field__label">Open from</p>
      <div className="inspector-preset-chips">
        {(['top', 'bottom'] as const).map((side) => (
          <button
            key={side}
            type="button"
            className={`inspector-preset-chip ${openFrom === side ? 'inspector-preset-chip--active' : ''}`}
            onClick={() => setOpenFrom(side)}
          >
            {side === 'top' ? 'Top (cup, tray, planter)' : 'Bottom (cap, lid)'}
          </button>
        ))}
      </div>
      <button type="button" className="inspector-export-btn inspector-export-btn--primary" onClick={run}>
        Hollow out
      </button>
      <p className="inspector-note">
        Makes a hole object from this shape's outline, inset by the wall, reaching from {floorLayers} layer{floorLayers === 1 ? '' : 's'} (
        {round(floorLayers * layerHeight)} mm) {openFrom === 'top' ? 'above the bottom up through the top' : 'below the top down through the bottom'}.
        Rounded corners and polish carry into the cavity; the outer bevel stays on the rim.
      </p>
    </Section>
  )
}

const MAX_TILE_BYTES = 400 * 1024
const SLOT_ASPECT_LABEL = '2.4×'

/** Compact pattern chooser: the current pattern as one row, and a popover
 * with big previews to change it — Figma's style-picker idea, so the
 * panel stays short while the previews stay legible. */
function TexturePicker({
  texture,
  onPick,
  onNone,
  onUpload,
}: {
  texture: SurfaceTexture | null
  onPick: (id: TexturePattern) => void
  onNone: () => void
  onUpload: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    // Escape closes the popover and nothing else: capture it before the
    // app-wide handler that would otherwise also clear the selection.
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key, true)
    }
  }, [open])
  const current = texture ? TEXTURE_PATTERNS.find((p) => p.id === texture.pattern) : null
  return (
    <div className="texture-picker" ref={ref}>
      <button type="button" className="texture-picker__current" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {texture && (texture.pattern !== 'custom' || texture.tile) ? (
          <TexturePreview texture={texture} width={60} height={40} />
        ) : (
          <span className="texture-choice__none" style={{ width: 60, height: 40 }}>
            {texture ? 'image' : 'None'}
          </span>
        )}
        <span className="texture-picker__label">
          <strong>{current?.label ?? 'No texture'}</strong>
          <span>{current?.hint ?? 'plain surfaces'}</span>
        </span>
        <span className="texture-picker__change">Change</span>
      </button>
      {open && (
        <div className="texture-popover" role="dialog" aria-label="Choose a texture">
          <div className="texture-grid">
            <button type="button" className={`texture-choice ${!texture ? 'texture-choice--active' : ''}`} onClick={() => { onNone(); setOpen(false) }}>
              <span className="texture-choice__none">None</span>
              <span>Plain</span>
            </button>
            {TEXTURE_PATTERNS.filter((p) => p.id !== 'custom').map((p) => (
              <button
                key={p.id}
                type="button"
                className={`texture-choice ${texture?.pattern === p.id ? 'texture-choice--active' : ''}`}
                title={p.hint}
                aria-label={p.label}
                onClick={() => { onPick(p.id); setOpen(false) }}
              >
                <TexturePreview texture={{ ...DEFAULT_TEXTURE, ...texture, pattern: p.id }} width={96} height={64} patterns={3} />
                <span>{p.label}</span>
              </button>
            ))}
            <button
              type="button"
              className={`texture-choice ${texture?.pattern === 'custom' ? 'texture-choice--active' : ''}`}
              title="Upload an SVG or PNG: dark = groove, white/transparent = flat"
              aria-label="Upload image texture"
              onClick={() => { setOpen(false); if (texture?.tile) onPick('custom'); else onUpload() }}
            >
              {texture?.tile ? <TexturePreview texture={{ ...texture, pattern: 'custom' }} width={96} height={64} patterns={3} /> : <span className="texture-choice__none">SVG / PNG</span>}
              <span>Your image</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Printable relief on the shape's surfaces — grooves cut into the
 * material so outer dimensions and fits stay exact. On a cutter it
 * decorates the cavity walls it leaves. */
function TextureSection({ layer }: { layer: ShapeLayer }) {
  const setTexture = useDocumentStore((s) => s.setTexture)
  const beginTransientEdit = useDocumentStore((s) => s.beginTransientEdit)
  const commitTransientEdit = useDocumentStore((s) => s.commitTransientEdit)
  const setNotice = useViewStore((s) => s.setNotice)
  const fileRef = useRef<HTMLInputElement>(null)
  const texture = layer.texture ?? null
  const supported = layer.regions.length === 1 && layer.regions[0].holes.length === 0
  const hasCavity = useDocumentStore((s) => s.order.some((id) => s.layers[id]?.shellOf?.solidId === layer.id))
  const patch = (p: Partial<SurfaceTexture>) => setTexture(layer.id, { ...(texture ?? DEFAULT_TEXTURE), ...p })
  const wallFrom = texture?.wallFrom ?? 0
  const wallTo = texture?.wallTo ?? layer.extrusionDepth
  const sides = texture?.sides ?? []

  const upload = async (file: File) => {
    if (file.size > MAX_TILE_BYTES) {
      setNotice(`${file.name} is ${Math.round(file.size / 1024)} KB — keep texture images under 400 KB (a simple SVG is a few KB).`)
      return
    }
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('read failed'))
        reader.readAsDataURL(file)
      })
      await prepareTile(url)
      patch({ pattern: 'custom', tile: url, repeat: texture?.repeat ?? true, target: layer.isHole ? 'walls' : (texture?.target ?? 'top') })
      setNotice(`${file.name} is now the texture: dark areas become grooves, white or transparent stays flat.`)
    } catch {
      setNotice(`${file.name} could not be read as an image.`)
    }
  }

  if (texture?.derived && layer.shellOf) {
    return (
      <Section title="Surface Texture">
        <p className="inspector-note">Follows the outer wall's texture ("Through the wall" on the solid), so the wall keeps its thickness. Change it on the solid.</p>
      </Section>
    )
  }
  if (!supported) {
    return (
      <Section title="Surface Texture">
        <p className="inspector-note">Textures need an outline without holes in it — apply them to the shapes before combining, or to a cutter.</p>
      </Section>
    )
  }
  const toggleSide = (side: WallSide) => {
    const next = sides.includes(side) ? sides.filter((x) => x !== side) : [...sides, side]
    patch({ sides: next.length === 0 || next.length === 4 ? undefined : next })
  }
  return (
    <Section
      title="Surface Texture"
      action={
        texture ? (
          <button type="button" className="inspector-section__hint inspector-section__hint--button" onClick={() => setTexture(layer.id, null)}>
            Remove
          </button>
        ) : undefined
      }
    >
      <TexturePicker
        texture={texture}
        onPick={(id) => patch({ pattern: id, target: layer.isHole ? 'walls' : (texture?.target ?? 'walls') })}
        onNone={() => setTexture(layer.id, null)}
        onUpload={() => fileRef.current?.click()}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
        hidden
        aria-label="Upload texture image"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''
        }}
      />
      {texture && (
        <>
          {texture.pattern === 'custom' && (
            <div className="inspector-preset-chips">
              <button type="button" className="inspector-preset-chip" onClick={() => fileRef.current?.click()}>
                Upload SVG / PNG…
              </button>
              <button type="button" className={`inspector-preset-chip ${texture.repeat !== false ? 'inspector-preset-chip--active' : ''}`} onClick={() => patch({ repeat: true })}>
                Repeat
              </button>
              <button type="button" className={`inspector-preset-chip ${texture.repeat === false ? 'inspector-preset-chip--active' : ''}`} onClick={() => patch({ repeat: false })}>
                Once, centered
              </button>
            </div>
          )}
          {!layer.isHole && (
            <>
              <p className="inspector-field__label">Apply to</p>
              <div className="inspector-preset-chips">
                {(
                  [
                    ['walls', 'Side walls'],
                    ['top', 'Top face'],
                    ['both', 'Both'],
                  ] as const
                ).map(([t, label]) => (
                  <button key={t} type="button" className={`inspector-preset-chip ${texture.target === t ? 'inspector-preset-chip--active' : ''}`} onClick={() => patch({ target: t })}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="inspector-field__label">Relief</p>
          <div className="inspector-preset-chips">
            {(
              [
                ['cut', 'Cut in'],
                ['raised', 'Raised'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" className={`inspector-preset-chip ${(texture.relief ?? 'cut') === id ? 'inspector-preset-chip--active' : ''}`} onClick={() => patch({ relief: id })}>
                {label}
              </button>
            ))}
          </div>
          <div className="inspector-grid-2">
            <Field label={texture.pattern === 'custom' && texture.repeat === false ? 'Image width' : 'Pattern size'} value={texture.size} suffix="mm" onChange={(v) => patch({ size: v })} />
            <Field label={texture.relief === 'raised' ? 'Relief height' : 'Groove depth'} value={texture.depth} suffix="mm" onChange={(v) => patch({ depth: v })} />
          </div>
          {texture.target !== 'top' && (
            <>
              <div className="inspector-angle">
                <AngleWheel value={texture.angle ?? 0} onChange={(deg) => patch({ angle: deg })} onStart={beginTransientEdit} onEnd={commitTransientEdit} label="Texture angle" />
                <div>
                  <Field label="Angle" value={texture.angle ?? 0} suffix="°" decimals={0} onChange={(v) => patch({ angle: v })} />
                  <p className="inspector-note">Drag the wheel to lean the pattern; Shift for 1° steps.</p>
                </div>
              </div>
              <div className="inspector-grid-2">
                <Field label="Fade out at the ends" value={texture.fade ?? 0} suffix="mm" onChange={(v) => patch({ fade: Math.max(0, v) })} />
              </div>
              {!layer.isHole && (
                <>
                  <label className={`inspector-check ${hasCavity ? '' : 'inspector-check--disabled'}`}>
                    <input type="checkbox" checked={!!texture.through && hasCavity} disabled={!hasCavity} onChange={(e) => patch({ through: e.target.checked || undefined })} />
                    Through the wall
                  </label>
                  <p className="inspector-note">
                    {hasCavity
                      ? 'The inside of the hollow follows the same relief, so the wall stays one thickness (like a fluted lamp shade). Twist and silhouette carry over.'
                      : 'Hollow out the shape first (3D tab) to show the relief on the inside as well.'}
                  </p>
                </>
              )}
            </>
          )}
          {texture.target !== 'top' && (
            <>
              <p className="inspector-field__label">Which walls</p>
              <div className="inspector-preset-chips">
                <button type="button" className={`inspector-preset-chip ${sides.length === 0 ? 'inspector-preset-chip--active' : ''}`} onClick={() => patch({ sides: undefined })}>
                  All
                </button>
                {(['front', 'back', 'left', 'right'] as const).map((side) => (
                  <button key={side} type="button" className={`inspector-preset-chip ${sides.includes(side) ? 'inspector-preset-chip--active' : ''}`} onClick={() => toggleSide(side)}>
                    {side[0].toUpperCase() + side.slice(1)}
                  </button>
                ))}
              </div>
              <div className="inspector-grid-2">
                <Field label="Band from (bottom)" value={wallFrom} suffix="mm" onChange={(v) => patch({ wallFrom: Math.max(0, v) })} />
                <Field label="Band to" value={wallTo} suffix="mm" onChange={(v) => patch({ wallTo: Math.max(0, v) })} />
              </div>
              {(texture.wallFrom != null || texture.wallTo != null) && (
                <button type="button" className="inspector-preset-chip" style={{ marginTop: 6 }} onClick={() => patch({ wallFrom: undefined, wallTo: undefined })}>
                  Whole height
                </button>
              )}
            </>
          )}
          {texture.target !== 'walls' && !layer.isHole && (
            <div className="inspector-grid-2" style={{ marginTop: 8 }}>
              <Field label="Top rim left plain" value={texture.topInset ?? 0} suffix="mm" onChange={(v) => patch({ topInset: Math.max(0, v) })} />
            </div>
          )}
          <p className="inspector-note">
            {layer.isHole
              ? 'Cut into the walls of the cavity this cutter leaves. Outer dimensions of the part stay exact.'
              : 'Cut into the surface, so the outer dimensions stay exact. Keep depth under about half the wall thickness; 0.4–1 mm reads well when printed.'}
          </p>
        </>
      )}
    </Section>
  )
}

/** Real holes drilled in a regular pattern through the walls and/or the
 * top face — cut with CSG so they print as holes, not dents. */
function PerforationSection({ layer }: { layer: ShapeLayer }) {
  const setPerforation = useDocumentStore((s) => s.setPerforation)
  const perf = layer.perforation ?? null
  const supported = layer.regions.length === 1 && layer.regions[0].holes.length === 0
  const patch = (p: Partial<Perforation>) => setPerforation(layer.id, { ...(perf ?? DEFAULT_PERFORATION), ...p })
  const sides = perf?.sides ?? []
  const toggleSide = (side: WallSide) => {
    const next = sides.includes(side) ? sides.filter((x) => x !== side) : [...sides, side]
    patch({ sides: next.length === 0 || next.length === 4 ? undefined : next })
  }
  if (!supported) return null
  return (
    <Section
      title="Holes in the walls"
      action={
        perf ? (
          <button type="button" className="inspector-section__hint inspector-section__hint--button" onClick={() => setPerforation(layer.id, null)}>
            Remove
          </button>
        ) : (
          <span className="inspector-section__hint">basket, grille</span>
        )
      }
    >
      {!perf ? (
        <>
          <button
            type="button"
            className="inspector-export-btn"
            onClick={() => patch({})}
          >
            Add a grid of holes
          </button>
          <p className="inspector-note">Evenly spaced round holes through the side walls. Hollow the shape out first for a basket; the holes stop at the cavity.</p>
        </>
      ) : (
        <>
          <p className="inspector-field__label">Hole shape</p>
          <div className="inspector-preset-chips">
            {HOLE_SHAPES.map(({ id, label }) => (
              <button key={id} type="button" className={`inspector-preset-chip ${perf.shape === id ? 'inspector-preset-chip--active' : ''}`} onClick={() => patch({ shape: id })}>
                {label}
              </button>
            ))}
          </div>
          <p className="inspector-field__label">Layout</p>
          <div className="inspector-preset-chips">
            <button type="button" className={`inspector-preset-chip ${perf.pattern === 'grid' ? 'inspector-preset-chip--active' : ''}`} onClick={() => patch({ pattern: 'grid' })}>
              Grid
            </button>
            <button type="button" className={`inspector-preset-chip ${perf.pattern === 'staggered' ? 'inspector-preset-chip--active' : ''}`} onClick={() => patch({ pattern: 'staggered' })}>
              Staggered
            </button>
          </div>
          <div className="inspector-grid-2">
            <Field label={perf.shape.startsWith('slot') ? 'Slot width' : 'Hole size'} value={perf.size} suffix="mm" onChange={(v) => patch({ size: v })} />
            <Field label="Spacing (center to center)" value={perf.spacing} suffix="mm" onChange={(v) => patch({ spacing: v })} />
          </div>
          <p className="inspector-field__label">Drill into</p>
          <div className="inspector-preset-chips">
            {(
              [
                ['walls', 'Side walls'],
                ['top', 'Top face'],
                ['both', 'Both'],
              ] as const
            ).map(([t, label]) => (
              <button key={t} type="button" className={`inspector-preset-chip ${perf.target === t ? 'inspector-preset-chip--active' : ''}`} onClick={() => patch({ target: t })}>
                {label}
              </button>
            ))}
          </div>
          <div className="inspector-preset-chips">
            <button type="button" className={`inspector-preset-chip ${perf.depth == null ? 'inspector-preset-chip--active' : ''}`} onClick={() => patch({ depth: null })}>
              Through the wall
            </button>
            <button type="button" className={`inspector-preset-chip ${perf.depth != null ? 'inspector-preset-chip--active' : ''}`} onClick={() => patch({ depth: perf.depth ?? 2 })}>
              To a depth
            </button>
          </div>
          {perf.depth != null && (
            <div className="inspector-grid-2">
              <Field label="Hole depth" value={perf.depth} suffix="mm" onChange={(v) => patch({ depth: v })} />
            </div>
          )}
          {perf.target !== 'top' && (
            <>
              <p className="inspector-field__label">Which walls</p>
              <div className="inspector-preset-chips">
                <button type="button" className={`inspector-preset-chip ${sides.length === 0 ? 'inspector-preset-chip--active' : ''}`} onClick={() => patch({ sides: undefined })}>
                  All
                </button>
                {(['front', 'back', 'left', 'right'] as const).map((side) => (
                  <button key={side} type="button" className={`inspector-preset-chip ${sides.includes(side) ? 'inspector-preset-chip--active' : ''}`} onClick={() => toggleSide(side)}>
                    {side[0].toUpperCase() + side.slice(1)}
                  </button>
                ))}
              </div>
              <div className="inspector-grid-2">
                <Field label={layer.bevelBottom > 0 ? 'Margin above the bevel' : 'Plain margin at bottom'} value={perf.wallFrom ?? (layer.bevelBottom > 0 ? 0 : defaultWallMargin(layer.extrusionDepth))} suffix="mm" onChange={(v) => patch({ wallFrom: Math.max(0, v) })} />
                <Field label={layer.bevelTop > 0 ? 'Margin below the bevel' : 'Plain margin at top'} value={perf.wallTopMargin ?? (layer.bevelTop > 0 ? 0 : defaultWallMargin(layer.extrusionDepth))} suffix="mm" onChange={(v) => patch({ wallTopMargin: Math.max(0, v) })} />
              </div>
            </>
          )}
          {perf.target !== 'walls' && (
            <div className="inspector-grid-2" style={{ marginTop: 8 }}>
              <Field label="Top margin kept plain" value={perf.topInset ?? 0} suffix="mm" onChange={(v) => patch({ topInset: Math.max(0, v) })} />
            </div>
          )}
          <p className="inspector-note">
            Holes never straddle a corner or break into a carved pocket. "Through the wall" stops at a hollowed cavity; on a solid block it makes blind holes two diameters deep. Slots are {SLOT_ASPECT_LABEL} their width long; rows spread out as needed.
          </p>
        </>
      )}
    </Section>
  )
}

/** Carve: one of two selected shapes becomes the cutter for the other, and
 * the pair is grouped — one object, the way a hand-drawn hole would be. */
function CarveSection({ ids }: { ids: string[] }) {
  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const layerHeight = useDocumentStore((s) => s.printSettings.layerHeight)
  const carveWith = useDocumentStore((s) => s.carveWith)
  const setNotice = useViewStore((s) => s.setNotice)
  const a = layers[ids[0]]
  const b = layers[ids[1]]
  // Default tool: an existing hole, else whichever was drawn later.
  const defaultTool = a?.isHole ? a.id : b?.isHole ? b.id : order.indexOf(a?.id ?? '') > order.indexOf(b?.id ?? '') ? a?.id : b?.id
  const [toolId, setToolId] = useState<string | undefined>(defaultTool)
  useEffect(() => setToolId(defaultTool), [defaultTool])
  const tool = layers[toolId ?? ''] ?? b
  const base = tool && a && b ? (tool.id === a.id ? b : a) : null

  // A cut never reaches the bed unless asked to: leave a floor of a few
  // layers under a pocket.
  const floor = Math.max(1.2, 3 * layerHeight)
  const maxPocket = base ? Math.max(0.2, base.extrusionDepth - floor) : 1
  const suggested = base && tool ? Math.min(tool.extrusionDepth, maxPocket) : 1
  const [depth, setDepth] = useState(suggested)
  useEffect(() => setDepth(suggested), [suggested])
  // If the tool already sits inside the base, "as positioned" is the
  // obvious intent; a tool resting on top means "pocket from the top".
  const overlapsInZ = base && tool ? tool.transform.z < base.transform.z + base.extrusionDepth - 0.01 && tool.transform.z + tool.extrusionDepth > base.transform.z + 0.01 : false
  const [mode, setMode] = useState<'inplace' | 'top' | 'bottom' | 'through'>(overlapsInZ ? 'inplace' : 'top')
  useEffect(() => setMode(overlapsInZ ? 'inplace' : 'top'), [overlapsInZ])

  if (!a || !b || !base || !tool) return null
  if (base.isHole) return <p className="inspector-note">Pick a solid shape to carve into.</p>
  const pocketDepth = Math.min(depth, maxPocket)

  return (
    <div className="inspector-section">
      <p className="inspector-field__label">Cut with</p>
      <div className="inspector-preset-chips">
        {[a, b].map((l) => (
          <button
            key={l.id}
            type="button"
            className={`inspector-preset-chip ${tool.id === l.id ? 'inspector-preset-chip--active' : ''}`}
            disabled={l.isHole && (l.id === a.id ? b : a).isHole}
            onClick={() => setToolId(l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>
      <p className="inspector-field__label">Into {base.name}</p>
      <div className="inspector-preset-chips">
        {(
          [
            ['inplace', 'As positioned'],
            ['top', 'Pocket from the top'],
            ['bottom', 'Pocket from the bottom'],
            ['through', 'Right through'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" className={`inspector-preset-chip ${mode === m ? 'inspector-preset-chip--active' : ''}`} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      {(mode === 'top' || mode === 'bottom') && (
        <div className="inspector-grid-2">
          <Field label="Cut depth" value={pocketDepth} suffix="mm" onChange={(v) => setDepth(Math.max(0.1, v))} />
          <Field label="Floor left" value={round(base.extrusionDepth - pocketDepth, 2)} suffix="mm" />
        </div>
      )}
      <p className="inspector-note">
        {mode === 'inplace'
          ? `${tool.name} cuts exactly the space it occupies now (Z ${round(tool.transform.z)}–${round(tool.transform.z + tool.extrusionDepth)} mm). Move it up or down first to place the cut.`
          : mode === 'through'
            ? `${tool.name}'s outline is cut through the whole height of ${base.name}.`
            : `${tool.name}'s outline is cut ${round(pocketDepth)} mm into ${base.name} from the ${mode}, leaving ${round(base.extrusionDepth - pocketDepth, 2)} mm of material.`}
      </p>
      <button
        type="button"
        className="inspector-export-btn inspector-export-btn--primary"
        onClick={() => {
          carveWith(base.id, tool.id, { mode, depth: pocketDepth })
          setNotice(`${tool.name} now carves ${base.name} — grouped as one object. Its rim bevel and texture shape the cut.`)
        }}
      >
        Carve {base.name} with {tool.name}
      </button>
      <p className="inspector-note">{tool.name} becomes the negative and stays editable: its outline, rim bevel and texture shape the cut; export cuts it out.</p>
    </div>
  )
}

function PrintSettingsSection() {
  const settings = useDocumentStore((s) => s.printSettings)
  const setPrintSettings = useDocumentStore((s) => s.setPrintSettings)
  return (
    <Section title="Print Settings" action={<span className="inspector-section__hint">preview</span>}>
      <p className="inspector-field__label">Layer height</p>
      <div className="inspector-preset-chips">
        {LAYER_HEIGHT_PRESETS_MM.map((h) => (
          <button
            key={h}
            type="button"
            className={`inspector-preset-chip ${Math.abs(settings.layerHeight - h) < 1e-6 ? 'inspector-preset-chip--active' : ''}`}
            onClick={() => setPrintSettings({ layerHeight: h })}
          >
            {h.toFixed(2)}
          </button>
        ))}
      </div>
      <div className="inspector-grid-2">
        <Field label="Layer height" value={settings.layerHeight} suffix="mm" decimals={2} onChange={(v) => setPrintSettings({ layerHeight: v })} />
        <Field label="Wall loops" value={settings.wallLoops} onChange={(v) => setPrintSettings({ wallLoops: v })} />
        <Field label="Top shell layers" value={settings.topLayers} onChange={(v) => setPrintSettings({ topLayers: v })} />
        <Field label="Bottom shell layers" value={settings.bottomLayers} onChange={(v) => setPrintSettings({ bottomLayers: v })} />
        <Field label="Infill density" value={settings.infillDensity} suffix="%" onChange={(v) => setPrintSettings({ infillDensity: v })} />
        <label className="inspector-field">
          <span className="inspector-field__label">Infill pattern</span>
          <span className="inspector-field__input-wrap">
            <select
              className="inspector-select"
              value={settings.infillPattern}
              aria-label="Infill pattern"
              onChange={(e) => setPrintSettings({ infillPattern: e.target.value as InfillPattern })}
            >
              {INFILL_PATTERNS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="inspector-field">
          <span className="inspector-field__label">Layer seam</span>
          <span className="inspector-field__input-wrap">
            <select
              className="inspector-select"
              value={settings.seam ?? 'random'}
              aria-label="Layer seam"
              title={SEAM_PLACEMENTS.find((s) => s.id === (settings.seam ?? 'random'))?.hint}
              onChange={(e) => setPrintSettings({ seam: e.target.value as SeamPlacement })}
            >
              {SEAM_PLACEMENTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>
      <p className="inspector-note">{SEAM_PLACEMENTS.find((s) => s.id === (settings.seam ?? 'random'))?.hint}</p>
      <p className="inspector-note">
        What the print preview simulates — match these to your Bambu Studio profile. Pockets snap to whole layers of this height.
      </p>
    </Section>
  )
}

const MAGNET_DIAMETERS_MM = [3, 4, 5, 6, 8, 10, 12]
const MAGNET_THICKNESSES_MM = [1, 1.5, 2, 3]
const SCREW_CLEARANCE_MM: { label: string; diameter: number }[] = [
  { label: 'M2', diameter: 2.4 },
  { label: 'M3', diameter: 3.4 },
  { label: 'M4', diameter: 4.5 },
  { label: 'M5', diameter: 5.5 },
  { label: 'M6', diameter: 6.6 },
  { label: 'M8', diameter: 9 },
]

function HoleSizePresetsSection({ layer }: { layer: ShapeLayer }) {
  const resizeShape = useDocumentStore((s) => s.resizeShape)
  const setExtrusionDepth = useDocumentStore((s) => s.setExtrusionDepth)

  const setDiameter = (diameterMM: number) => {
    const bounds = shapeWorldBounds(layer)
    resizeShape(layer.id, { ...bounds, width: diameterMM, height: diameterMM })
  }

  return (
    <Section title="Size Presets">
      <p className="inspector-field__label">Magnet diameter</p>
      <div className="inspector-preset-chips">
        {MAGNET_DIAMETERS_MM.map((d) => (
          <button key={d} type="button" className="inspector-preset-chip" onClick={() => setDiameter(d)}>
            {d}mm
          </button>
        ))}
      </div>
      <p className="inspector-field__label">Magnet thickness</p>
      <div className="inspector-preset-chips">
        {MAGNET_THICKNESSES_MM.map((t) => (
          <button key={t} type="button" className="inspector-preset-chip" onClick={() => setExtrusionDepth(layer.id, t)}>
            {t}mm
          </button>
        ))}
      </div>
      <p className="inspector-field__label">Screw clearance</p>
      <div className="inspector-preset-chips">
        {SCREW_CLEARANCE_MM.map(({ label, diameter }) => (
          <button key={label} type="button" className="inspector-preset-chip" onClick={() => setDiameter(diameter)}>
            {label}
          </button>
        ))}
      </div>
    </Section>
  )
}

const ARTBOARD_SWATCHES: { color: string; label: string }[] = [
  { color: '#ffffff', label: 'White' },
  { color: '#e6e8ee', label: 'Light grey' },
  { color: '#8a8d99', label: 'Grey' },
  { color: '#2b2e3a', label: 'Dark' },
  { color: '#111216', label: 'Black' },
]

/** The 2D artboard's background: a dark one makes a white design visible. */
function ArtboardSection() {
  const artboardColor = useDocumentStore((s) => s.artboardColor)
  const setArtboardColor = useDocumentStore((s) => s.setArtboardColor)
  return (
    <Section title="Artboard" action={<span className="inspector-section__hint">2D only</span>}>
      <div className="inspector-swatches" role="radiogroup" aria-label="Artboard color">
        {ARTBOARD_SWATCHES.map((sw) => (
          <button
            key={sw.color}
            type="button"
            role="radio"
            aria-checked={artboardColor.toLowerCase() === sw.color}
            className={`inspector-swatch ${artboardColor.toLowerCase() === sw.color ? 'inspector-swatch--on' : ''}`}
            style={{ background: sw.color }}
            title={sw.label}
            aria-label={sw.label}
            onClick={() => setArtboardColor(sw.color)}
          />
        ))}
        <label className="inspector-swatch inspector-swatch--custom" title="Custom color" style={{ background: artboardColor }}>
          <input type="color" value={artboardColor} aria-label="Custom artboard color" onChange={(e) => setArtboardColor(e.target.value)} />
        </label>
      </div>
      <p className="inspector-note">Only how the 2D canvas looks; nothing about the print changes.</p>
    </Section>
  )
}

function BedPresetsSection() {
  const [expanded, setExpanded] = useState(false)
  const bedPresetId = useDocumentStore((s) => s.bedPresetId)
  const pinnedBedPresetId = useDocumentStore((s) => s.pinnedBedPresetId)
  const customBedWidth = useDocumentStore((s) => s.customBedWidth)
  const customBedHeight = useDocumentStore((s) => s.customBedHeight)
  const setBedPreset = useDocumentStore((s) => s.setBedPreset)
  const togglePinnedBedPreset = useDocumentStore((s) => s.togglePinnedBedPreset)
  const setCustomBedSize = useDocumentStore((s) => s.setCustomBedSize)

  const isCustom = bedPresetId === CUSTOM_BED_ID
  const selectedPreset = bedPresets.find((p) => p.id === bedPresetId)
  const selectedLabel = isCustom ? 'Custom' : (selectedPreset?.label ?? bedPresets[0].label)
  const selectedWidth = isCustom ? customBedWidth : (selectedPreset?.width ?? bedPresets[0].width)
  const selectedHeight = isCustom ? customBedHeight : (selectedPreset?.height ?? bedPresets[0].height)

  return (
    <Section title="Bed Presets" action={<span className="inspector-section__hint">{bedPresets.length + 1}</span>}>
      <button
        type="button"
        className="inspector-preset-summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="inspector-preset-row__text">
          <span>{selectedLabel}</span>
          <span className="inspector-preset-row__size">
            {selectedWidth} × {selectedHeight} mm
          </span>
        </div>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="inspector-preset-list">
          {[...bedPresets].sort((a, b) => Number(b.id === pinnedBedPresetId) - Number(a.id === pinnedBedPresetId)).map((preset) => (
            <div
              key={preset.id}
              className="inspector-preset-row"
              role="button"
              tabIndex={0}
              onClick={() => setBedPreset(preset.id)}
            >
              <input type="radio" checked={bedPresetId === preset.id} readOnly />
              <div className="inspector-preset-row__text">
                <span>
                  {preset.label}
                  {pinnedBedPresetId === preset.id && <em className="inspector-preset-row__default">Default</em>}
                </span>
                <span className="inspector-preset-row__size">
                  {preset.width} × {preset.height} mm
                </span>
              </div>
              <button
                type="button"
                className="inspector-preset-row__pin"
                aria-label={pinnedBedPresetId === preset.id ? 'Unpin default printer' : 'Pin as default printer'}
                title={pinnedBedPresetId === preset.id ? 'Default for new projects — click to unpin' : 'Make this the default printer for new projects'}
                aria-pressed={pinnedBedPresetId === preset.id}
                onClick={(e) => {
                  e.stopPropagation()
                  togglePinnedBedPreset(preset.id)
                }}
              >
                <Pin size={12} fill={pinnedBedPresetId === preset.id ? 'currentColor' : 'none'} />
              </button>
            </div>
          ))}
          <div
            className="inspector-preset-row"
            role="button"
            tabIndex={0}
            onClick={() => setBedPreset(CUSTOM_BED_ID)}
          >
            <input type="radio" checked={isCustom} readOnly />
            <div className="inspector-preset-row__text">
              <span>Custom</span>
              <span className="inspector-preset-row__size">
                {customBedWidth} × {customBedHeight} mm
              </span>
            </div>
          </div>
        </div>
      )}
      {isCustom && (
        <div className="inspector-grid-2 inspector-custom-bed">
          <Field label="Width" value={customBedWidth} suffix="mm" onChange={(v) => setCustomBedSize(v, customBedHeight)} />
          <Field label="Height" value={customBedHeight} suffix="mm" onChange={(v) => setCustomBedSize(customBedWidth, v)} />
        </div>
      )}
    </Section>
  )
}

function ThreeDTab({ layer, multiCount }: { layer: ShapeLayer | null; multiCount: number }) {
  const displayUnit = useDocumentStore((s) => s.displayUnit)
  const selection = useDocumentStore((s) => s.selection)
  const setExtrusionDepth = useDocumentStore((s) => s.setExtrusionDepth)
  const setCornerRadius = useDocumentStore((s) => s.setCornerRadius)
  const setSmartPolish = useDocumentStore((s) => s.setSmartPolish)
  const setBevelBottom = useDocumentStore((s) => s.setBevelBottom)
  const setBevelTop = useDocumentStore((s) => s.setBevelTop)
  const setBevelMode = useDocumentStore((s) => s.setBevelMode)

  // The same contour the 3D mesh is actually built from, so the "clamped
  // to" hint below reflects the real geometry-safety limit for this shape,
  // not just the raw un-rounded outline.
  const effectiveContour = useMemo(() => {
    if (!layer) return null
    const rounded = roundPolygonCorners(layer.regions[0].outer.points, layer.cornerRadius)
    return smartPolishCorners(rounded, layer.smartPolish)
  }, [layer])

  if (!layer || !effectiveContour) {
    if (multiCount > 1) {
      return (
        <>
          <MultiHeightSection ids={selection} />
          <EmptyState text="Select a single shape to edit its extrusion, polish and bevel." />
        </>
      )
    }
    return <EmptyState text="Select a shape to edit its 3D properties." />
  }

  const safeBottom = computeSafeBevel(effectiveContour, layer.bevelBottom)
  const safeTop = computeSafeBevel(effectiveContour, layer.bevelTop)

  return (
    <>
      <OrientationSection layer={layer} />
      <Section title="Extrusion">
        <div className="inspector-grid-2">
          <Field label="Depth" value={layer.extrusionDepth} suffix="mm" onChange={(v) => setExtrusionDepth(layer.id, v)} />
          <Field label="Corner radius" value={layer.cornerRadius} suffix="mm" onChange={(v) => setCornerRadius(layer.id, v)} />
        </div>
      </Section>

      <Section title="Smart Polish">
        <Field label="Intensity" value={layer.smartPolish} suffix="mm" onChange={(v) => setSmartPolish(layer.id, v)} />
        <p className="inspector-note">Softens sharp corners only — gentle curves are left alone.</p>
      </Section>

      <Section title={layer.isHole ? 'Rim Bevel' : 'Edge Bevel'}>
        <div className="inspector-grid-2">
          <Field label={layer.isHole ? 'Mouth (top)' : 'Top'} value={layer.bevelTop} suffix="mm" onChange={(v) => setBevelTop(layer.id, v)} />
          <Field label="Bottom" value={layer.bevelBottom} suffix="mm" onChange={(v) => setBevelBottom(layer.id, v)} />
        </div>
        {layer.isHole ? (
          <>
            <div className="inspector-preset-chips">
              <button type="button" className={`inspector-preset-chip ${(layer.bevelMode ?? 'rim') === 'rim' ? 'inspector-preset-chip--active' : ''}`} onClick={() => setBevelMode(layer.id, 'rim')}>
                Round the rim
              </button>
              <button type="button" className={`inspector-preset-chip ${layer.bevelMode === 'shape' ? 'inspector-preset-chip--active' : ''}`} onClick={() => setBevelMode(layer.id, 'shape')}>
                Cutter's own edges
              </button>
            </div>
            <p className="inspector-note">
              {(layer.bevelMode ?? 'rim') === 'rim'
                ? 'Flares the cutter outward: a countersunk mouth at the top, a rounded floor edge at the bottom.'
                : 'The cut keeps this cutter\'s exact shape — its own rounded edges become the pocket\'s.'}
            </p>
          </>
        ) : (
          (safeTop < layer.bevelTop - 0.05 || safeBottom < layer.bevelBottom - 0.05) && (
            <p className="inspector-note inspector-note--warning">
              Clamped to what this shape can safely support: top {round(safeTop / UNIT_FACTORS[displayUnit])}
              {displayUnit}, bottom {round(safeBottom / UNIT_FACTORS[displayUnit])}
              {displayUnit}.
            </p>
          )
        )}
      </Section>
      {!layer.isHole && <ProfileSection layer={layer} />}
      {!layer.isHole && <ShellSection layer={layer} />}
    </>
  )
}

/** Side-view silhouettes (bottom at the bottom), so a shape reads at a
 * glance without a name for it. */
const PROFILE_PRESETS: { id: ProfilePreset; label: string; path: string }[] = [
  { id: 'straight', label: 'Straight walls', path: 'M8 4 H24 V28 H8 Z' },
  { id: 'bulge', label: 'Wider in the middle', path: 'M10 4 H22 C30 10 30 22 22 28 H10 C2 22 2 10 10 4 Z' },
  { id: 'taper', label: 'Narrower at the top', path: 'M11 4 H21 L26 28 H6 Z' },
  { id: 'flare', label: 'Wider at the top', path: 'M6 4 H26 L21 28 H11 Z' },
  { id: 'waist', label: 'Narrower in the middle', path: 'M6 4 H26 C18 10 18 22 26 28 H6 C14 22 14 10 6 4 Z' },
]

/** The width along the height — a vase, a cone, a barrel. Rings are set
 * here or dragged on the ruler beside the shape in 3D. */
function ProfileSection({ layer }: { layer: ShapeLayer }) {
  const setProfile = useDocumentStore((s) => s.setProfile)
  const setTwist = useDocumentStore((s) => s.setTwist)
  const beginTransientEdit = useDocumentStore((s) => s.beginTransientEdit)
  const commitTransientEdit = useDocumentStore((s) => s.commitTransientEdit)
  const profileEditing = useViewStore((s) => s.profileEditing)
  const setProfileEditing = useViewStore((s) => s.setProfileEditing)
  const depth = Math.max(0.2, layer.extrusionDepth)
  const simple = layer.regions.length === 1 && layer.regions[0].holes.length === 0
  const profile = layer.profile
  const points = profile ? orderedProfile(profile, depth) : []
  // Rings are listed as they stand on the plate: the topmost first. A
  // shape printed upside down lists its z=0 ring first, since that is
  // what ends up on top.
  const upright = new THREE.Vector3(0, 0, 1).applyQuaternion(layerPrintQuaternion(layer)).z >= 0
  const ringOrder = points.map((_, i) => i)
  if (upright) ringOrder.reverse()
  const bounds = shapeWorldBounds(layer)
  const overhangs = profile ? profileOverhangs(profile, depth, Math.max(bounds.width, bounds.height) / 2) : []
  const update = (next: ShapeProfile | undefined) => setProfile(layer.id, next && next.points.length > 0 ? next : undefined)
  const setPoint = (index: number, patch: Partial<ProfilePoint>) => {
    if (!profile) return
    update({ ...profile, points: points.map((p, i) => (i === index ? { ...p, ...patch } : p)) })
  }
  if (!simple) {
    return (
      <Section title="Shape along the height">
        <p className="inspector-note">This needs a single-outline shape; this one was combined from several.</p>
      </Section>
    )
  }
  return (
    <Section title="Shape along the height" action={<span className="inspector-section__hint">profile</span>}>
      <div className="inspector-profile__presets" role="group" aria-label="Shape along the height">
        {PROFILE_PRESETS.map((p) => {
          const active = p.id === 'straight' ? !profile : false
          return (
            <button
              key={p.id}
              type="button"
              className={`inspector-profile__preset ${active ? 'inspector-profile__preset--active' : ''}`}
              title={p.label}
              aria-label={p.label}
              onClick={() => {
                update(presetProfile(p.id, depth))
                if (p.id !== 'straight') setProfileEditing(true)
              }}
            >
              <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
                <path d={p.path} />
              </svg>
            </button>
          )
        })}
      </div>
      <div className="inspector-profile__tools">
        <button type="button" className={`inspector-preset-chip ${profileEditing ? 'inspector-preset-chip--active' : ''}`} aria-pressed={profileEditing} onClick={() => setProfileEditing(!profileEditing)}>
          <Ruler size={12} /> Ruler in 3D
        </button>
        {profile && (
          <label className="inspector-profile__smooth">
            <input type="checkbox" checked={profile.smooth} onChange={(e) => update({ ...profile, smooth: e.target.checked })} />
            Smooth
          </label>
        )}
        <button
          type="button"
          className="inspector-preset-chip"
          onClick={() => {
            const base = profile ?? { smooth: true, points: [{ z: 0, scale: 1 }, { z: depth, scale: 1 }] }
            const zs = orderedProfile(base, depth)
            // Halfway into the widest gap between rings.
            let bestZ = depth / 2
            let bestGap = -1
            const edges = [0, ...zs.map((p) => p.z), depth]
            for (let i = 1; i < edges.length; i++) {
              if (edges[i] - edges[i - 1] > bestGap) {
                bestGap = edges[i] - edges[i - 1]
                bestZ = (edges[i] + edges[i - 1]) / 2
              }
            }
            update({ ...base, points: [...zs, { z: bestZ, scale: profileScaleAt(base, depth, bestZ) }] })
            setProfileEditing(true)
          }}
        >
          <Plus size={12} /> Add ring
        </button>
      </div>
      {points.length > 0 && (
        <div className="inspector-profile__rings">
          {ringOrder.map((i, row) => {
            const p = points[i]
            return (
              <div key={i} className="inspector-profile__ring">
                <Field label={row === 0 ? 'Height' : ''} value={p.z} suffix="mm" onChange={(v) => setPoint(i, { z: Math.min(depth, Math.max(0, v)) })} />
                <Field label={row === 0 ? 'Width' : ''} value={Math.round(p.scale * 100)} suffix="%" onChange={(v) => setPoint(i, { scale: Math.max(5, v) / 100 })} />
                <button type="button" className="inspector-profile__remove" aria-label="Remove ring" onClick={() => update(profile ? { ...profile, points: points.filter((_, j) => j !== i) } : undefined)}>
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div className="inspector-profile__subtitle">Twist</div>
      <div className="inspector-angle">
        <AngleWheel value={layer.twist ?? 0} fold={false} onChange={(deg) => setTwist(layer.id, deg)} onStart={beginTransientEdit} onEnd={commitTransientEdit} label="Twist" />
        <div>
          <Field label="Turn, bottom to top" value={layer.twist ?? 0} suffix="°" decimals={0} onChange={(v) => setTwist(layer.id, v)} />
          <p className="inspector-note">Drag the wheel; Shift for 1° steps. Turns the outline as it rises, like a twisted vase.</p>
        </div>
      </div>
      {overhangs.length > 0 && <p className="inspector-note inspector-note--warning">Leans out more than 45° between {overhangs.map((o) => `${round(o.from)}–${round(o.to)} mm`).join(', ')}: that part may need support to print.</p>}
      <p className="inspector-note">{profile ? 'Drag a ring on the ruler in 3D: up/down for its height, in/out for its width. Click the ruler to add one.' : 'Pick a silhouette or add a ring, then shape it on the ruler in 3D.'}</p>
    </Section>
  )
}



function OrientationSection({ layer }: { layer: ShapeLayer }) {
  const selection = useDocumentStore((s) => s.selection)
  const bedPresetId = useDocumentStore((s) => s.bedPresetId)
  const setRotation = useDocumentStore((s) => s.setRotation)
  const setSelection = useDocumentStore((s) => s.setSelection)
  const dismiss = useAnalysisStore((s) => s.dismiss)
  const warning = useAnalysisStore((s) => visibleWarning(s, layer.id))
  const layers = useDocumentStore((s) => s.layers)
  const bedMaxZ = getBedPreset(bedPresetId)?.maxZ ?? CUSTOM_BED_MAX_Z
  const t = layer.transform
  const supporterNames = warning?.supporterIds.map((id) => layers[id]?.name).filter(Boolean).join(', ')

  return (
    <>
      <Section
        title="Orientation"
        action={
          (t.rotationX || t.rotationY || t.rotation) ? (
            <button type="button" className="inspector-section__hint inspector-section__hint--button" onClick={() => setRotation(layer.id, { x: 0, y: 0, z: 0 })}>
              Reset
            </button>
          ) : undefined
        }
      >
        <div className="inspector-orientation">
          <RotationDial layer={layer} />
          <div className="inspector-orientation__fields">
            <Field label="Tilt X" value={t.rotationX} suffix="°" disabled={layer.locked} onChange={(v) => setRotation(layer.id, { x: v })} />
            <Field label="Tilt Y" value={t.rotationY} suffix="°" disabled={layer.locked} onChange={(v) => setRotation(layer.id, { y: v })} />
            <Field label="Spin Z" value={t.rotation} suffix="°" disabled={layer.locked} onChange={(v) => setRotation(layer.id, { z: v })} />
          </div>
        </div>
        <p className="inspector-note">Drag the outer ring to spin, the inner ball to tilt. Spin shows in 2D; tilts only in 3D.</p>
      </Section>

      <Section title="Height">
        <HeightSlider layer={layer} selectionIds={selection.includes(layer.id) ? selection : [layer.id]} bedMaxZ={bedMaxZ} />
        {!layer.isHole && <PerfectFitRow layer={layer} ids={selection.includes(layer.id) ? selection : [layer.id]} />}
        {!layer.isHole && warning && (
          <div className={`support-note support-note--${warning.severity}`}>
            <span>
              {warning.severity === 'critical'
                ? warning.supporterIds.length === 0 || Math.round(warning.supportedFraction * 100) === 0
                  ? 'Floating — nothing underneath supports this shape, it will fail to print.'
                  : `Floating — only ${Math.round(warning.supportedFraction * 100)}% of it touches ${supporterNames}.`
                : `Partial support — ${Math.round(warning.supportedFraction * 100)}% of it rests on ${supporterNames}.`}
            </span>
            {warning.severity === 'partial' ? (
              <button type="button" onClick={() => dismiss(layer.id)}>
                Dismiss
              </button>
            ) : warning.supporterIds.length > 0 ? (
              <button type="button" onClick={() => setSelection(warning.supporterIds)}>
                Show
              </button>
            ) : null}
          </div>
        )}
      </Section>
    </>
  )
}

/** Perfect Fit: one click to sit a shape exactly on whatever is under it
 * (so a part drawn over a base is visible on top instead of buried in it),
 * or to put it back on the bed. */
function PerfectFitRow({ layer, ids }: { layer: ShapeLayer; ids: string[] }) {
  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const restOnShapeBelow = useDocumentStore((s) => s.restOnShapeBelow)
  const dropToBed = useDocumentStore((s) => s.dropToBed)
  const plates = useDocumentStore((s) => s.plates)
  const rest = useMemo(() => unitRest(ids, layers, orderOnPlate({ layers, order, plates }, layerPlateId(layer, plates))), [ids, layer, layers, order, plates])
  const dropDelta = useMemo(() => unitDropDelta(ids, layers), [ids, layers])
  const supporterName = rest ? layers[rest.supporterId]?.name : null
  const alreadyResting = rest ? Math.abs(rest.delta) < 0.01 : false
  const unit = ids.length > 1 ? `these ${ids.length} shapes` : 'this shape'
  const locked = ids.some((id) => layers[id]?.locked)
  return (
    <div className="inspector-fit">
      <span className="inspector-field__label">Perfect Fit{ids.length > 1 ? ' · moves the group together' : ''}</span>
      <div className="inspector-fit__row">
        <button
          type="button"
          className="inspector-export-btn"
          disabled={!rest || alreadyResting || locked}
          title={rest ? `Sit ${unit} exactly on top of ${supporterName}` : `Nothing under ${unit}`}
          onClick={() => restOnShapeBelow(ids)}
        >
          <Layers2 size={13} />
          {rest ? `Rest on ${supporterName}` : 'Rest on shape below'}
        </button>
        <button
          type="button"
          className="inspector-export-btn"
          disabled={Math.abs(dropDelta) < 0.01 || locked}
          title={`Put the lowest point of ${unit} on the print bed`}
          onClick={() => dropToBed(ids)}
        >
          <ArrowDownToLine size={13} />
          Drop to bed
        </button>
      </div>
      <p className="inspector-note">
        {ids.length > 1
          ? 'The whole selection moves as one piece, keeping how the shapes sit relative to each other.'
          : 'A shape drawn inside a bigger one starts resting on it automatically; use these to move it back down or up again.'}
      </p>
      {ids.length > 1 && layer.locked && <p className="inspector-note inspector-note--warning">Unlock every shape in the selection first.</p>}
    </div>
  )
}

/** Height controls for a multi-selection (typically a group): the slider
 * and Perfect Fit act on all of them as a unit. */
function MultiHeightSection({ ids }: { ids: string[] }) {
  const layers = useDocumentStore((s) => s.layers)
  const bedPresetId = useDocumentStore((s) => s.bedPresetId)
  const bedMaxZ = getBedPreset(bedPresetId)?.maxZ ?? CUSTOM_BED_MAX_Z
  const first = ids.map((id) => layers[id]).find((l) => l && !l.isHole) ?? layers[ids[0]]
  if (!first) return null
  return (
    <Section title="Height" action={<span className="inspector-section__hint">{ids.length} shapes</span>}>
      <HeightSlider layer={first} selectionIds={ids} bedMaxZ={bedMaxZ} />
      <PerfectFitRow layer={first} ids={ids} />
    </Section>
  )
}
