import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDownToLine,
  Layers2,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ChevronDown,
  ChevronRight,
  Copy,
  Pin,
  Trash2,
} from 'lucide-react'
import { shapeWorldBounds, useDocumentStore, type AlignMode } from '../../state/documentStore'
import { buildExportMeshes, downloadBlob } from '../../lib/export/exportMeshes'
import { writeBinaryStl } from '../../lib/export/stl'
import { write3mf } from '../../lib/export/threeMf'
import { IconButton } from '../../components/IconButton'
import { DEFAULT_TEXTURE, INFILL_PATTERNS, LAYER_HEIGHT_PRESETS_MM, TEXTURE_PATTERNS, type InfillPattern, type ShapeLayer, type SurfaceTexture } from '../../types/document'
import { roundPolygonCorners, smartPolishCorners } from '../../lib/geometry/rounding'
import { computeSafeBevel } from '../../lib/geometry/offset'
import { bedPresets, CUSTOM_BED_ID, CUSTOM_BED_MAX_Z, getBedPreset } from '../../lib/geometry/bedPresets'
import { RotationDial } from './RotationDial'
import { HeightSlider } from './HeightSlider'
import { useAnalysisStore, visibleWarning } from '../../state/analysisStore'
import { unitDropDelta, unitRest } from '../../lib/geometry/stacking'
import { useViewStore } from '../../state/viewStore'
import './InspectorPanel.css'

const UNIT_FACTORS = { mm: 1, cm: 10, in: 25.4 } as const

export function InspectorPanel() {
  const layers = useDocumentStore((s) => s.layers)
  const selection = useDocumentStore((s) => s.selection)
  const duplicateShapes = useDocumentStore((s) => s.duplicateShapes)
  const removeShapes = useDocumentStore((s) => s.removeShapes)

  const selectedLayer = selection.length === 1 ? (layers[selection[0]] ?? null) : null

  // Context follows what you're doing: shape editing while something is
  // selected, project-level settings otherwise — but either stays a click
  // away.
  const hasSelection = selection.length > 0
  const [tab, setTab] = useState<'shape' | 'project'>(hasSelection ? 'shape' : 'project')
  useEffect(() => setTab(hasSelection ? 'shape' : 'project'), [hasSelection])

  return (
    <div className="inspector-panel">
      <div className="inspector-panel__selection">
        <span>
          {selection.length === 0
            ? 'No selection'
            : selection.length === 1
              ? selectedLayer?.name
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

      <div className="inspector-panel__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'shape'} className={tab === 'shape' ? 'inspector-panel__tab--active' : ''} onClick={() => setTab('shape')}>
          Shape
        </button>
        <button type="button" role="tab" aria-selected={tab === 'project'} className={tab === 'project' ? 'inspector-panel__tab--active' : ''} onClick={() => setTab('project')}>
          Project
        </button>
      </div>

      <div className="inspector-panel__body">
        {tab === 'project' ? (
          <>
            <CollapsibleGroup title="Printer" defaultOpen>
              <BedPresetsSection />
            </CollapsibleGroup>
            <CollapsibleGroup title="Print Settings" defaultOpen>
              <PrintSettingsSection />
            </CollapsibleGroup>
            <CollapsibleGroup title="Export" defaultOpen>
              <ExportTab />
            </CollapsibleGroup>
          </>
        ) : selection.length === 0 ? (
          <EmptyState text="Select a shape (or draw one) to edit it here. Printer, print settings and export live under Project." />
        ) : (
          <>
            <CollapsibleGroup title="Design" defaultOpen>
              <AlignmentSection ids={selection} />
              <DesignTab layer={selectedLayer} multiCount={selection.length} />
            </CollapsibleGroup>
            <CollapsibleGroup title="3D" defaultOpen>
              <ThreeDTab layer={selectedLayer} multiCount={selection.length} />
            </CollapsibleGroup>
            {selection.length === 2 && (
              <CollapsibleGroup title="Carve" defaultOpen>
                <CarveSection ids={selection} />
              </CollapsibleGroup>
            )}
          </>
        )}
      </div>
    </div>
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

function CollapsibleGroup({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="inspector-panel__group">
      <button type="button" className="inspector-panel__group-header" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{title}</span>
      </button>
      {open && <div className="inspector-panel__group-body">{children}</div>}
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
  const resizeShape = useDocumentStore((s) => s.resizeShape)
  const moveShapesBy = useDocumentStore((s) => s.moveShapesBy)
  const setLayerZ = useDocumentStore((s) => s.setLayerZ)

  if (!layer) {
    return <EmptyState text={`${multiCount} shapes selected — position & size editing needs just one.`} />
  }

  const bounds = shapeWorldBounds(layer)

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
        {layer.isHole && (
          <p className="inspector-note">
            Print height of this cutter's own bottom — independent of whatever solid it cuts into.
          </p>
        )}
      </Section>

      <AppearanceSection layer={layer} />

      {layer.isHole && <RecessedPocketSection layer={layer} />}
      {layer.isHole && <HoleSizePresetsSection layer={layer} />}
      {!layer.isHole && <ShellSection layer={layer} />}
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
  return (
    <Section title="Alignment" action={<span className="inspector-section__hint">{ids.length > 1 ? 'to selection' : 'to artboard'}</span>}>
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
function ShellSection({ layer }: { layer: ShapeLayer }) {
  const [wall, setWall] = useState(DEFAULT_WALL_MM)
  const [floor, setFloor] = useState(DEFAULT_SHELL_FLOOR_MM)
  const [openFrom, setOpenFrom] = useState<'top' | 'bottom'>('top')
  const hollowOut = useDocumentStore((s) => s.hollowOut)
  const layerHeight = useDocumentStore((s) => s.printSettings.layerHeight)
  const setNotice = useViewStore((s) => s.setNotice)
  const floorLayers = Math.max(1, Math.ceil(floor / layerHeight - 1e-6))

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

/** Printable relief on the shape's surfaces — grooves cut into the
 * material so outer dimensions and fits stay exact. On a cutter it
 * decorates the cavity walls it leaves. */
function TextureSection({ layer }: { layer: ShapeLayer }) {
  const setTexture = useDocumentStore((s) => s.setTexture)
  const texture = layer.texture ?? null
  const supported = layer.regions.length === 1 && layer.regions[0].holes.length === 0
  const patch = (p: Partial<SurfaceTexture>) => setTexture(layer.id, { ...(texture ?? DEFAULT_TEXTURE), ...p })

  if (!supported) {
    return (
      <Section title="Surface Texture">
        <p className="inspector-note">Textures need an outline without holes in it — apply them to the shapes before combining, or to a cutter.</p>
      </Section>
    )
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
      <div className="inspector-preset-chips">
        <button type="button" className={`inspector-preset-chip ${!texture ? 'inspector-preset-chip--active' : ''}`} onClick={() => setTexture(layer.id, null)}>
          None
        </button>
        {TEXTURE_PATTERNS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`inspector-preset-chip ${texture?.pattern === p.id ? 'inspector-preset-chip--active' : ''}`}
            title={p.hint}
            onClick={() => patch({ pattern: p.id, target: layer.isHole ? 'walls' : (texture?.target ?? 'walls') })}
          >
            {p.label}
          </button>
        ))}
      </div>
      {texture && (
        <>
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
                  <button
                    key={t}
                    type="button"
                    className={`inspector-preset-chip ${texture.target === t ? 'inspector-preset-chip--active' : ''}`}
                    onClick={() => patch({ target: t })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="inspector-grid-2">
            <Field label="Pattern size" value={texture.size} suffix="mm" onChange={(v) => patch({ size: v })} />
            <Field label="Groove depth" value={texture.depth} suffix="mm" onChange={(v) => patch({ depth: v })} />
          </div>
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

/** Carve: one of two selected shapes becomes the cutter for the other, and
 * the pair is grouped — one object, the way a hand-drawn hole would be. */
function CarveSection({ ids }: { ids: string[] }) {
  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const carveWith = useDocumentStore((s) => s.carveWith)
  const setNotice = useViewStore((s) => s.setNotice)
  const a = layers[ids[0]]
  const b = layers[ids[1]]
  // Default tool: an existing hole, else whichever was drawn later.
  const defaultTool = a?.isHole ? a.id : b?.isHole ? b.id : order.indexOf(a?.id ?? '') > order.indexOf(b?.id ?? '') ? a?.id : b?.id
  const [toolId, setToolId] = useState<string | undefined>(defaultTool)
  const [mode, setMode] = useState<'top' | 'bottom' | 'through'>('top')
  useEffect(() => setToolId(defaultTool), [defaultTool])
  if (!a || !b) return null
  const tool = layers[toolId ?? ''] ?? b
  const base = tool.id === a.id ? b : a
  if (base.isHole) return <p className="inspector-note">Pick a solid shape to carve into.</p>

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
            ['top', `From the top, ${round(tool.extrusionDepth)} mm deep`],
            ['bottom', `From the bottom, ${round(tool.extrusionDepth)} mm deep`],
            ['through', 'Right through'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" className={`inspector-preset-chip ${mode === m ? 'inspector-preset-chip--active' : ''}`} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="inspector-export-btn inspector-export-btn--primary"
        onClick={() => {
          carveWith(base.id, tool.id, mode)
          setNotice(`${tool.name} now carves ${base.name} — the two are grouped as one object. Its rim bevel and texture shape the cut.`)
        }}
      >
        Carve {base.name} with {tool.name}
      </button>
      <p className="inspector-note">
        {tool.name} becomes the negative: it keeps its outline, bevel (as a rim bevel) and texture, and is grouped with {base.name} so they move together. Export cuts it out.
      </p>
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
      </div>
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
          <p className="inspector-note">Rounds the rim of the hole this cutter makes — a countersunk mouth, or a rounded pocket floor edge.</p>
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
      <TextureSection layer={layer} />
    </>
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
  const rest = useMemo(() => unitRest(ids, layers, order), [ids, layers, order])
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

function ExportTab() {
  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const solidCount = order.filter((id) => layers[id] && !layers[id].isHole && layers[id].visible).length
  const colorCount = new Set(order.filter((id) => layers[id] && !layers[id].isHole && layers[id].visible).map((id) => layers[id].color)).size

  const exportAs = (format: '3mf' | 'stl') => {
    const meshes = buildExportMeshes(layers, order)
    if (meshes.length === 0) return
    if (format === '3mf') downloadBlob(write3mf(meshes), 'smartgrid.3mf', 'model/3mf')
    else downloadBlob(writeBinaryStl(meshes), 'smartgrid.stl', 'model/stl')
  }

  return (
    <>
      <Section title="Format">
        <div className="inspector-export-buttons">
          <button
            type="button"
            className="inspector-export-btn inspector-export-btn--primary"
            disabled={solidCount === 0}
            onClick={() => exportAs('3mf')}
          >
            Export 3MF
          </button>
          <button type="button" className="inspector-export-btn" disabled={solidCount === 0} onClick={() => exportAs('stl')}>
            Export STL
          </button>
        </div>
        <p className="inspector-note">
          {solidCount === 0
            ? 'Draw a solid shape to export.'
            : `${solidCount} solid${solidCount === 1 ? '' : 's'}, ${colorCount} color${colorCount === 1 ? '' : 's'} — holes are already cut. 3MF keeps each shape's color as its own filament for Bambu Studio; STL is geometry only.`}
        </p>
      </Section>
    </>
  )
}
