import { useState, type ReactNode } from 'react'
import { Copy, Pin, Square, Trash2 } from 'lucide-react'
import './InspectorPanel.css'

type Tab = 'design' | '3d' | 'export'

const bedPresets = [
  { id: 'a1', label: 'Bambu Lab A1', size: '256 × 256 mm' },
  { id: 'a1-mini', label: 'Bambu Lab A1 Mini', size: '180 × 180 mm' },
  { id: 'p1s', label: 'Bambu Lab P1S', size: '256 × 256 mm' },
  { id: 'x1c', label: 'Bambu Lab X1 Carbon', size: '256 × 256 mm' },
]

const usedColors = ['#4d8dff', '#ff5c5c', '#ffb648', '#7bd88f', '#e7e7ea']

export function InspectorPanel() {
  const [tab, setTab] = useState<Tab>('design')

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
        <Square size={14} />
        <span>Base Plate</span>
        <div className="inspector-panel__selection-actions">
          <button type="button" aria-label="Duplicate">
            <Copy size={13} />
          </button>
          <button type="button" aria-label="Delete">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="inspector-panel__body">
        {tab === 'design' && <DesignTab />}
        {tab === '3d' && <ThreeDTab />}
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

function Field({ label, defaultValue, suffix }: { label: string; defaultValue: string; suffix?: string }) {
  return (
    <label className="inspector-field">
      <span className="inspector-field__label">{label}</span>
      <span className="inspector-field__input-wrap">
        <input type="text" defaultValue={defaultValue} />
        {suffix && <span className="inspector-field__suffix">{suffix}</span>}
      </span>
    </label>
  )
}

function DesignTab() {
  return (
    <>
      <Section title="Position & Size">
        <div className="inspector-grid-2">
          <Field label="X" defaultValue="56" suffix="mm" />
          <Field label="Y" defaultValue="28" suffix="mm" />
          <Field label="W" defaultValue="120" suffix="mm" />
          <Field label="H" defaultValue="80" suffix="mm" />
        </div>
      </Section>

      <Section title="Bed Presets" action={<span className="inspector-section__hint">4</span>}>
        <div className="inspector-preset-list">
          {bedPresets.map((preset) => (
            <div key={preset.id} className="inspector-preset-row">
              <input type="checkbox" defaultChecked={preset.id === 'a1'} />
              <div className="inspector-preset-row__text">
                <span>{preset.label}</span>
                <span className="inspector-preset-row__size">{preset.size}</span>
              </div>
              <button type="button" className="inspector-preset-row__pin" aria-label="Pin as default">
                <Pin size={12} />
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Appearance">
        <div className="inspector-color-row">
          <span className="inspector-color-swatch" style={{ background: usedColors[0] }} />
          <input type="text" defaultValue="#4D8DFF" className="inspector-color-hex" />
        </div>
        <div className="inspector-color-palette">
          {usedColors.map((c) => (
            <button key={c} type="button" className="inspector-color-palette__dot" style={{ background: c }} />
          ))}
        </div>
      </Section>
    </>
  )
}

function ThreeDTab() {
  return (
    <>
      <Section title="Extrusion">
        <div className="inspector-grid-2">
          <Field label="Depth" defaultValue="12" suffix="mm" />
          <Field label="Corner radius" defaultValue="0" suffix="mm" />
        </div>
      </Section>

      <Section title="Smart Polish">
        <div className="inspector-toggle-row">
          <span>Adaptive corner softening</span>
          <input type="checkbox" defaultChecked />
        </div>
        <Field label="Sharpness threshold" defaultValue="35" suffix="°" />
      </Section>

      <Section title="Edge Bevel">
        <div className="inspector-grid-2">
          <Field label="Top" defaultValue="0" suffix="mm" />
          <Field label="Bottom" defaultValue="0" suffix="mm" />
        </div>
        <p className="inspector-note">Automatically clamped to what this shape's geometry can safely support.</p>
      </Section>
    </>
  )
}

function ExportTab() {
  return (
    <>
      <Section title="Format">
        <div className="inspector-export-buttons">
          <button type="button" className="inspector-export-btn inspector-export-btn--primary">
            Export STL
          </button>
          <button type="button" className="inspector-export-btn">
            Export 3MF
          </button>
        </div>
      </Section>
      <Section title="Units">
        <div className="inspector-unit-toggle">
          <button type="button" className="inspector-unit-toggle__opt inspector-unit-toggle__opt--active">
            mm
          </button>
          <button type="button" className="inspector-unit-toggle__opt">
            cm
          </button>
          <button type="button" className="inspector-unit-toggle__opt">
            in
          </button>
        </div>
      </Section>
    </>
  )
}
