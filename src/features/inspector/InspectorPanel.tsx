import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Copy, Pin, Trash2 } from 'lucide-react'
import { shapeWorldBounds, useDocumentStore } from '../../state/documentStore'
import type { ShapeLayer } from '../../types/document'
import { roundPolygonCorners, smartPolishCorners } from '../../lib/geometry/rounding'
import { computeSafeBevel } from '../../lib/geometry/offset'
import { bedPresets } from '../../lib/geometry/bedPresets'
import './InspectorPanel.css'

type Tab = 'design' | '3d' | 'export'

const usedColors = ['#4d8dff', '#ff5c5c', '#ffb648', '#7bd88f', '#e7e7ea']

export function InspectorPanel() {
  const [tab, setTab] = useState<Tab>('design')
  const layers = useDocumentStore((s) => s.layers)
  const selection = useDocumentStore((s) => s.selection)
  const duplicateShapes = useDocumentStore((s) => s.duplicateShapes)
  const removeShapes = useDocumentStore((s) => s.removeShapes)

  const selectedLayer = selection.length === 1 ? (layers[selection[0]] ?? null) : null

  return (
    <div className="inspector-panel">
      <div className="inspector-panel__tabs">
        {(['design', '3d', 'export'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`inspector-panel__tab ${tab === t ? 'inspector-panel__tab--active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'design' ? 'Design' : t === '3d' ? '3D' : 'Export'}
          </button>
        ))}
      </div>

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

      <div className="inspector-panel__body">
        {tab === 'design' && <DesignTab layer={selectedLayer} multiCount={selection.length} />}
        {tab === '3d' && <ThreeDTab layer={selectedLayer} multiCount={selection.length} />}
        {tab === 'export' && <ExportTab />}
      </div>
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
  const [text, setText] = useState(String(round(value)))

  useEffect(() => {
    setText(String(round(value)))
  }, [value])

  const commit = () => {
    const parsed = parseFloat(text)
    if (!Number.isNaN(parsed) && onChange) onChange(parsed)
    else setText(String(round(value)))
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
        {suffix && <span className="inspector-field__suffix">{suffix}</span>}
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
        </div>
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
    </>
  )
}

function BedPresetsSection() {
  const bedPresetId = useDocumentStore((s) => s.bedPresetId)
  const pinnedBedPresetId = useDocumentStore((s) => s.pinnedBedPresetId)
  const setBedPreset = useDocumentStore((s) => s.setBedPreset)
  const togglePinnedBedPreset = useDocumentStore((s) => s.togglePinnedBedPreset)

  return (
    <Section title="Bed Presets" action={<span className="inspector-section__hint">{bedPresets.length}</span>}>
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
      </div>
    </Section>
  )
}

function ThreeDTab({ layer, multiCount }: { layer: ShapeLayer | null; multiCount: number }) {
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
            Clamped to what this shape can safely support: top {round(safeTop)}mm, bottom {round(safeBottom)}mm.
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
      <Section title="Units">
        <div className="inspector-unit-toggle">
          <button type="button" className="inspector-unit-toggle__opt inspector-unit-toggle__opt--active">
            mm
          </button>
          <button type="button" className="inspector-unit-toggle__opt" disabled>
            cm
          </button>
          <button type="button" className="inspector-unit-toggle__opt" disabled>
            in
          </button>
        </div>
      </Section>
    </>
  )
}
