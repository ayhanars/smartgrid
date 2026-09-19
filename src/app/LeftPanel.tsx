import { useState } from 'react'
import { Layers, Shapes } from 'lucide-react'
import { LayersPanel } from '../features/layers/LayersPanel'
import { AssetsPanel } from '../features/assets/AssetsPanel'

type LeftTab = 'layers' | 'assets'

/** The left side: a Figma-style rail switching between the Layers list
 * and the Assets library. */
export function LeftPanel() {
  const [tab, setTab] = useState<LeftTab>('layers')
  const tabs: { id: LeftTab; label: string; icon: React.ReactNode }[] = [
    { id: 'layers', label: 'Layers', icon: <Layers size={17} /> },
    { id: 'assets', label: 'Assets', icon: <Shapes size={17} /> },
  ]
  return (
    <div className="left-panel">
      <nav className="left-panel__rail" aria-label="Left panel">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={`left-panel__rail-btn ${tab === t.id ? 'left-panel__rail-btn--active' : ''}`} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="left-panel__content">{tab === 'layers' ? <LayersPanel /> : <AssetsPanel />}</div>
    </div>
  )
}
