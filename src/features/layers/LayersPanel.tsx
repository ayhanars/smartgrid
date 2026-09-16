import { useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  FolderClosed,
  Image,
  Lock,
  Pentagon,
  Plus,
  Square,
  Unlock,
} from 'lucide-react'
import './LayersPanel.css'

type LayerKind = 'group' | 'rect' | 'circle' | 'polygon' | 'hole' | 'image'

interface LayerNode {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  locked: boolean
  children?: LayerNode[]
}

const mockLayers: LayerNode[] = [
  {
    id: 'bracket',
    name: 'Bracket',
    kind: 'group',
    visible: true,
    locked: false,
    children: [
      { id: 'base', name: 'Base Plate', kind: 'rect', visible: true, locked: false },
      { id: 'fillet', name: 'Fillet Corner', kind: 'polygon', visible: true, locked: false },
      { id: 'mount-hole', name: 'Mounting Hole', kind: 'hole', visible: true, locked: false },
    ],
  },
  { id: 'boss', name: 'Center Boss', kind: 'circle', visible: true, locked: false },
  { id: 'sketch', name: 'reference-sketch.png', kind: 'image', visible: false, locked: true },
]

const kindIcon: Record<LayerKind, ReactNode> = {
  group: <FolderClosed size={13} />,
  rect: <Square size={13} />,
  circle: <Circle size={13} />,
  polygon: <Pentagon size={13} />,
  hole: <Circle size={13} />,
  image: <Image size={13} />,
}

function LayerRow({ node, depth }: { node: LayerNode; depth: number }) {
  const [expanded, setExpanded] = useState(true)
  const [visible, setVisible] = useState(node.visible)
  const [locked, setLocked] = useState(node.locked)
  const hasChildren = !!node.children?.length

  return (
    <>
      <div className="layer-row" style={{ paddingLeft: 8 + depth * 16 }}>
        {hasChildren ? (
          <button type="button" className="layer-row__chevron" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="layer-row__chevron-spacer" />
        )}
        <span className={`layer-row__icon layer-row__icon--${node.kind}`}>{kindIcon[node.kind]}</span>
        <span className="layer-row__name">{node.name}</span>
        <div className="layer-row__actions">
          <button type="button" className="layer-row__toggle" onClick={() => setLocked((v) => !v)}>
            {locked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
          <button type="button" className="layer-row__toggle" onClick={() => setVisible((v) => !v)}>
            {visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        </div>
      </div>
      {hasChildren &&
        expanded &&
        node.children!.map((child) => <LayerRow key={child.id} node={child} depth={depth + 1} />)}
    </>
  )
}

export function LayersPanel() {
  return (
    <div className="layers-panel">
      <div className="layers-panel__header">
        <span className="layers-panel__title">Layers</span>
        <span className="layers-panel__count">{mockLayers.length}</span>
        <div className="layers-panel__header-actions">
          <button type="button" className="layers-panel__icon-btn" aria-label="Add layer">
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="layers-panel__blend-row">
        <select className="layers-panel__select" defaultValue="normal">
          <option value="normal">Normal</option>
          <option value="multiply">Multiply</option>
        </select>
        <div className="layers-panel__opacity">
          <span>Opac</span>
          <input type="text" defaultValue="100" />
          <span>%</span>
        </div>
      </div>

      <div className="layers-panel__tree">
        {mockLayers.map((node) => (
          <LayerRow key={node.id} node={node} depth={0} />
        ))}
      </div>
    </div>
  )
}
