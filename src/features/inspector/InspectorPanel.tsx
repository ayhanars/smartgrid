import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
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
import { INFILL_PATTERNS, LAYER_HEIGHT_PRESETS_MM, type InfillPattern, type ShapeLayer } from '../../types/document'
import { roundPolygonCorners, smartPolishCorners } from '../../lib/geometry/rounding'
import { computeSafeBevel } from '../../lib/geometry/offset'
import { bedPresets, CUSTOM_BED_ID, CUSTOM_BED_MAX_Z, getBedPreset } from '../../lib/geometry/bedPresets'
import { RotationDial } from './RotationDial'
import { HeightSlider } from './HeightSlider'
import { useAnalysisStore, visibleWarning } from '../../state/analysisStore'
import './InspectorPanel.css'

const UNIT_FACTORS = { mm: 1, cm: 10, in: 25.4 } as const

export function InspectorPanel() {
  const layers = useDocumentStore((s) => s.layers)
  const selection = useDocumentStore((s) => s.selection)
  const duplicateShapes = useDocumentStore((s) => s.duplicateShapes)
  const removeShapes = useDocumentStore((s) => s.removeShapes)

  const selectedLayer = selection.length === 1 ? (layers[selection[0]] ?? null) : null

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

      <div className="inspector-panel__body">
        <CollapsibleGroup title="Design" defaultOpen>
          {selection.length > 0 && <AlignmentSection ids={selection} />}
          <DesignTab layer={selectedLayer} multiCount={selection.length} />
        </CollapsibleGroup>
        <CollapsibleGroup title="3D" defaultOpen>
          <ThreeDTab layer={selectedLayer} multiCount={selection.length} />
        </CollapsibleGroup>
        <CollapsibleGroup title="Export">
          <ExportTab />
        </CollapsibleGroup>
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
    return (
      <>
        <BedPresetsSection />
        <PrintSettingsSection />
        {multiCount > 1 && <EmptyState text={`${multiCount} shapes selected — position & size editing needs just one.`} />}
      </>
    )
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
          {bedPresets.map((preset) => (
            <div
              key={preset.id}
              className="inspector-preset-row"
              role="button"
              tabIndex={0}
              onClick={() => setBedPreset(preset.id)}
            >
              <input type="radio" checked={bedPresetId === preset.id} readOnly />
              <div className="inspector-preset-row__text">
                <span>{preset.label}</span>
                <span className="inspector-preset-row__size">
                  {preset.width} × {preset.height} mm
                </span>
              </div>
              <button
                type="button"
                className="inspector-preset-row__pin"
                aria-label="Pin as default"
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
    return <EmptyState text={multiCount > 1 ? 'Select a single shape to edit its 3D properties.' : 'Select a shape to edit its 3D properties.'} />
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

      <Section title="Edge Bevel">
        <div className="inspector-grid-2">
          <Field label="Top" value={layer.bevelTop} suffix="mm" onChange={(v) => setBevelTop(layer.id, v)} />
          <Field label="Bottom" value={layer.bevelBottom} suffix="mm" onChange={(v) => setBevelBottom(layer.id, v)} />
        </div>
        {(safeTop < layer.bevelTop - 0.05 || safeBottom < layer.bevelBottom - 0.05) && (
          <p className="inspector-note inspector-note--warning">
            Clamped to what this shape can safely support: top {round(safeTop / UNIT_FACTORS[displayUnit])}
            {displayUnit}, bottom {round(safeBottom / UNIT_FACTORS[displayUnit])}
            {displayUnit}.
          </p>
        )}
      </Section>
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
