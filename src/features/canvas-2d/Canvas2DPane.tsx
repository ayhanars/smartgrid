import { useState } from 'react'
import {
  Circle,
  Hand,
  Minus,
  MousePointer2,
  PenTool,
  Pentagon,
  Scissors,
  Square,
  SquareDashed,
  Star,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import './Canvas2DPane.css'

const tools = [
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'pan', label: 'Pan', icon: Hand },
  { id: 'frame', label: 'Artboard', icon: SquareDashed },
  { id: 'pen', label: 'Pen', icon: PenTool },
  { id: 'rect', label: 'Rectangle', icon: Square },
  { id: 'circle', label: 'Circle', icon: Circle },
  { id: 'polygon', label: 'Polygon', icon: Pentagon },
  { id: 'star', label: 'Star', icon: Star },
  { id: 'hole', label: 'Hole', icon: Minus },
  { id: 'cut', label: 'Cut', icon: Scissors },
] as const

export function Canvas2DPane() {
  const [activeTool, setActiveTool] = useState<string>('select')
  const [zoom, setZoom] = useState(51)

  return (
    <div className="canvas-2d">
      <div className="canvas-2d__ruler canvas-2d__ruler--top" />
      <div className="canvas-2d__ruler canvas-2d__ruler--left" />

      <div className="canvas-2d__viewport">
        <div className="canvas-2d__artboard">
          <span className="canvas-2d__artboard-label">Artboard 1 · 1200 × 800</span>
          <div className="canvas-2d__shape canvas-2d__shape--rect" />
          <div className="canvas-2d__shape canvas-2d__shape--circle" />
        </div>
      </div>

      <div className="canvas-2d__toolbar">
        {tools.map(({ id, label, icon: Icon }) => (
          <IconButton
            key={id}
            size="md"
            active={activeTool === id}
            aria-label={label}
            onClick={() => setActiveTool(id)}
          >
            <Icon size={16} />
          </IconButton>
        ))}
      </div>

      <div className="canvas-2d__zoom">
        <IconButton size="sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(10, z - 10))}>
          <ZoomOut size={14} />
        </IconButton>
        <span>{zoom}%</span>
        <IconButton size="sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(400, z + 10))}>
          <ZoomIn size={14} />
        </IconButton>
      </div>

      <div className="canvas-2d__status">
        <span>Canvas: 1200 × 800 px</span>
        <span>Unit: mm</span>
        <span>Layers: 3</span>
      </div>
    </div>
  )
}
