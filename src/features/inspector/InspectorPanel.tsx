import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Copy, Pin, Trash2 } from 'lucide-react'
import { shapeWorldBounds, useDocumentStore } from '../../state/documentStore'
import type { ShapeLayer } from '../../types/document'
import { roundPolygonCorners, smartPolishCorners } from '../../lib/geometry/rounding'
import { computeSafeBevel } from '../../lib/geometry/offset'
import { bedPresets, CUSTOM_BED_ID } from '../../lib/geometry/bedPresets'
import './InspectorPanel.css'

const usedColors = ['#4d8dff', '#ff5c5c', '#ffb648', '#7bd88f', '#e7e7ea']

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

function round(v: number) {
  return Math.round(v * 10) / 10
}

function Field({
  label,
  value,
  onChange,
  suffix,
  disabled,
}: {
  label: string
  value: number
  onChange?: (v: number) => void
  suffix?: string
  disabled?: boolean
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

  const [text, setText] = useState(String(round(displayValue)))

  useEffect(() => {
    setText(String(round(displayValue)))
  }, [displayValue])

  const commit = () => {
    const parsed = parseFloat(text)
    if (!Number.isNaN(parsed) && onChange) onChange(parsed * factor)
    else setText(String(round(displayValue)))
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
  const setColor = useDocumentStore((s) => s.setColor)
  const setLayerZ = useDocumentStore((s) => s.setLayerZ)

  if (!layer) {
    return (
      <>
        <BedPresetsSection />
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

      <Section title="Appearance">
        <div className="inspector-color-row">
          <span className="inspector-color-swatch" style={{ background: layer.color }} />
          <input type="text" value={layer.color} onChange={(e) => setColor(layer.id, e.target.value)} className="inspector-color-hex" />
        </div>
        <div className="inspector-color-palette">
          {usedColors.map((c) => (
            <button key={c} type="button" className="inspector-color-palette__dot" style={{ background: c }} onClick={() => setColor(layer.id, c)} />
          ))}
        </div>
      </Section>

      {layer.isHole && <RecessedPocketSection layer={layer} />}
      {layer.isHole && <HoleSizePresetsSection layer={layer} />}
    </>
  )
}

const DEFAULT_FLOOR_THICKNESS_MM = 0.6

function RecessedPocketSection({ layer }: { layer: ShapeLayer }) {
  const [floorThickness, setFloorThickness] = useState(DEFAULT_FLOOR_THICKNESS_MM)
  const snapHoleToPocket = useDocumentStore((s) => s.snapHoleToPocket)

  return (
    <Section title="Recessed Pocket">
      <Field
        label="Floor thickness"
        value={floorThickness}
        suffix="mm"
        onChange={(v) => setFloorThickness(Math.max(0, v))}
      />
      <p className="inspector-note">
        Sinks this hole so it stops just short of the bottom of whatever it overlaps — enough to hide a magnet
        flush without cutting all the way through.
      </p>
      <button
        type="button"
        className="inspector-export-btn"
        onClick={() => snapHoleToPocket(layer.id, floorThickness)}
      >
        Snap to Recessed Pocket
      </button>
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

function ExportTab() {
  return (
    <>
      <Section title="Format">
        <div className="inspector-export-buttons">
          <button type="button" className="inspector-export-btn inspector-export-btn--primary" disabled>
            Export STL
          </button>
          <button type="button" className="inspector-export-btn" disabled>
            Export 3MF
          </button>
        </div>
        <p className="inspector-note">Not wired yet — needs the 3D extrusion engine.</p>
      </Section>
    </>
  )
}
