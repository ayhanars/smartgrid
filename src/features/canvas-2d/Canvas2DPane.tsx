import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import { useDocumentStore, shapeWorldBounds, type Guide } from '../../state/documentStore'
import type { Bounds, Point2, ShapeKind } from '../../types/document'
import { ShapeElement } from './ShapeElement'
import {
  clamp,
  computeResizedBounds,
  normalizeDraftBounds,
  rectsIntersect,
  unionBounds,
  type ResizeHandle,
} from './geometry2d'
import { createShapeRegions, pointsToSvgPath } from '../../lib/geometry/primitives'
import { getBedPreset } from '../../lib/geometry/bedPresets'
import './Canvas2DPane.css'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const CLICK_THRESHOLD_PX = 4

type DrawableTool = ShapeKind
type Tool = 'select' | 'pan' | DrawableTool

const drawTools: { id: DrawableTool; label: string; icon: typeof Square }[] = [
  { id: 'rect', label: 'Rectangle', icon: Square },
  { id: 'circle', label: 'Circle', icon: Circle },
  { id: 'polygon', label: 'Polygon', icon: Pentagon },
  { id: 'star', label: 'Star', icon: Star },
  { id: 'hole', label: 'Hole', icon: Minus },
]

type Gesture =
  | { type: 'pan'; startScreen: Point2; startPan: Point2 }
  | { type: 'draft'; kind: DrawableTool; startDoc: Point2; currentDoc: Point2; shift: boolean }
  | { type: 'marquee'; startScreen: Point2; currentScreen: Point2; additive: boolean; baseSelection: string[] }
  | {
      type: 'move'
      startDoc: Point2
      originals: Record<string, Point2>
      dx: number
      dy: number
      moved: boolean
      clickedId: string
      wasAlreadySelected: boolean
    }
  | { type: 'resize'; id: string; handle: ResizeHandle; startBounds: Bounds; startDoc: Point2; preview: Bounds }
  | { type: 'ruler-drag'; orientation: Guide['orientation']; screen: Point2; overRuler: boolean }
  | { type: 'guide-drag'; id: string; orientation: Guide['orientation']; screen: Point2; overRuler: boolean }

export function Canvas2DPane() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point2>({ x: 0, y: 0 })
  const [tool, setTool] = useState<Tool>('select')
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [isSpaceDown, setIsSpaceDown] = useState(false)

  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const selection = useDocumentStore((s) => s.selection)
  const setSelection = useDocumentStore((s) => s.setSelection)
  const addShape = useDocumentStore((s) => s.addShape)
  const moveShapesBy = useDocumentStore((s) => s.moveShapesBy)
  const resizeShape = useDocumentStore((s) => s.resizeShape)
  const bedPresetId = useDocumentStore((s) => s.bedPresetId)
  const bed = getBedPreset(bedPresetId)
  const ARTBOARD_WIDTH = bed.width
  const ARTBOARD_HEIGHT = bed.height
  const guides = useDocumentStore((s) => s.guides)
  const rulersVisible = useDocumentStore((s) => s.rulersVisible)
  const addGuide = useDocumentStore((s) => s.addGuide)
  const updateGuidePosition = useDocumentStore((s) => s.updateGuidePosition)
  const removeGuide = useDocumentStore((s) => s.removeGuide)
  const toggleRulersVisible = useDocumentStore((s) => s.toggleRulersVisible)
  const rulerSize = rulersVisible ? 20 : 0

  const docToScreen = useCallback((x: number, y: number) => ({ x: x * zoom + pan.x, y: y * zoom + pan.y }), [zoom, pan])
  const screenToDoc = useCallback((x: number, y: number) => ({ x: (x - pan.x) / zoom, y: (y - pan.y) / zoom }), [zoom, pan])

  const getLocalPoint = (e: { clientX: number; clientY: number }): Point2 => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const fitToView = useCallback(() => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const padding = 60
    const availW = Math.max(50, rect.width - padding * 2)
    const availH = Math.max(50, rect.height - padding * 2)
    const nextZoom = clamp(Math.min(availW / ARTBOARD_WIDTH, availH / ARTBOARD_HEIGHT), MIN_ZOOM, MAX_ZOOM)
    setZoom(nextZoom)
    setPan({
      x: (rect.width - ARTBOARD_WIDTH * nextZoom) / 2,
      y: (rect.height - ARTBOARD_HEIGHT * nextZoom) / 2,
    })
  }, [ARTBOARD_WIDTH, ARTBOARD_HEIGHT])

  useLayoutEffect(() => {
    fitToView()
  }, [fitToView])

  const zoomAtCenter = (factor: number) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const docPoint = screenToDoc(cx, cy)
    const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM)
    setZoom(nextZoom)
    setPan({ x: cx - docPoint.x * nextZoom, y: cy - docPoint.y * nextZoom })
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        setIsSpaceDown(true)
      }
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === '0')) {
        e.preventDefault()
        fitToView()
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        zoomAtCenter(1.2)
      } else if (mod && e.key === '-') {
        e.preventDefault()
        zoomAtCenter(1 / 1.2)
      } else if (mod && e.key.toLowerCase() === 'r' && !typing) {
        e.preventDefault()
        toggleRulersVisible()
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') setIsSpaceDown(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [zoom, pan, fitToView, toggleRulersVisible])

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    const local = getLocalPoint(e)
    const docPoint = screenToDoc(local.x, local.y)
    const factor = Math.exp(-e.deltaY * 0.0015)
    const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM)
    setZoom(nextZoom)
    setPan({ x: local.x - docPoint.x * nextZoom, y: local.y - docPoint.y * nextZoom })
  }

  const startPan = (e: React.PointerEvent) => {
    const local = getLocalPoint(e)
    svgRef.current?.setPointerCapture(e.pointerId)
    setGesture({ type: 'pan', startScreen: local, startPan: pan })
  }

  const handleBackgroundPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isSpaceDown || tool === 'pan') {
      startPan(e)
      return
    }
    const local = getLocalPoint(e)
    svgRef.current?.setPointerCapture(e.pointerId)
    if (tool === 'select') {
      if (!e.shiftKey) setSelection([])
      setGesture({ type: 'marquee', startScreen: local, currentScreen: local, additive: e.shiftKey, baseSelection: selection })
      return
    }
    const doc = screenToDoc(local.x, local.y)
    setGesture({ type: 'draft', kind: tool, startDoc: doc, currentDoc: doc, shift: e.shiftKey })
  }

  const handleShapePointerDown = (e: React.PointerEvent<SVGGElement>, id: string) => {
    if (isSpaceDown || tool === 'pan') {
      e.stopPropagation()
      startPan(e)
      return
    }
    // A drawing tool is active: don't swallow the event even if it landed on
    // an existing shape — let it bubble to the background handler so a new
    // shape can still be drawn on top of one that's already there.
    if (tool !== 'select') return
    e.stopPropagation()
    const layer = layers[id]
    if (!layer) return
    const local = getLocalPoint(e)
    svgRef.current?.setPointerCapture(e.pointerId)
    const doc = screenToDoc(local.x, local.y)
    const wasAlreadySelected = selection.includes(id)

    if (e.shiftKey) {
      setSelection(wasAlreadySelected ? selection.filter((sid) => sid !== id) : [...selection, id])
      return
    }

    const nextSelection = wasAlreadySelected ? selection : [id]
    if (!wasAlreadySelected) setSelection(nextSelection)

    const originals: Record<string, Point2> = {}
    for (const sid of nextSelection) {
      const l = layers[sid]
      if (l) originals[sid] = { x: l.transform.x, y: l.transform.y }
    }
    setGesture({ type: 'move', startDoc: doc, originals, dx: 0, dy: 0, moved: false, clickedId: id, wasAlreadySelected })
  }

  const handleRulerPointerDown = (e: React.PointerEvent, orientation: Guide['orientation']) => {
    e.preventDefault()
    svgRef.current?.setPointerCapture(e.pointerId)
    const local = getLocalPoint(e)
    setGesture({ type: 'ruler-drag', orientation, screen: local, overRuler: true })
  }

  const handleGuidePointerDown = (e: React.PointerEvent, id: string, orientation: Guide['orientation']) => {
    e.stopPropagation()
    svgRef.current?.setPointerCapture(e.pointerId)
    const local = getLocalPoint(e)
    setGesture({ type: 'guide-drag', id, orientation, screen: local, overRuler: false })
  }

  const handleResizePointerDown = (e: React.PointerEvent, id: string, handle: ResizeHandle) => {
    e.stopPropagation()
    const layer = layers[id]
    if (!layer) return
    const local = getLocalPoint(e)
    svgRef.current?.setPointerCapture(e.pointerId)
    const doc = screenToDoc(local.x, local.y)
    setGesture({ type: 'resize', id, handle, startBounds: shapeWorldBounds(layer), startDoc: doc, preview: shapeWorldBounds(layer) })
  }

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!gesture) return
    const local = getLocalPoint(e)

    if (gesture.type === 'pan') {
      setPan({ x: gesture.startPan.x + (local.x - gesture.startScreen.x), y: gesture.startPan.y + (local.y - gesture.startScreen.y) })
    } else if (gesture.type === 'draft') {
      setGesture({ ...gesture, currentDoc: screenToDoc(local.x, local.y), shift: e.shiftKey })
    } else if (gesture.type === 'marquee') {
      const startDoc = screenToDoc(gesture.startScreen.x, gesture.startScreen.y)
      const currentDoc = screenToDoc(local.x, local.y)
      const marqueeBounds: Bounds = {
        x: Math.min(startDoc.x, currentDoc.x),
        y: Math.min(startDoc.y, currentDoc.y),
        width: Math.abs(currentDoc.x - startDoc.x),
        height: Math.abs(currentDoc.y - startDoc.y),
      }
      const hits = order.filter((id) => rectsIntersect(marqueeBounds, shapeWorldBounds(layers[id])))
      const merged = gesture.additive ? Array.from(new Set([...gesture.baseSelection, ...hits])) : hits
      setSelection(merged)
      setGesture({ ...gesture, currentScreen: local })
    } else if (gesture.type === 'move') {
      const doc = screenToDoc(local.x, local.y)
      const dx = doc.x - gesture.startDoc.x
      const dy = doc.y - gesture.startDoc.y
      const moved = gesture.moved || Math.abs(dx * zoom) > CLICK_THRESHOLD_PX || Math.abs(dy * zoom) > CLICK_THRESHOLD_PX
      setGesture({ ...gesture, dx, dy, moved })
    } else if (gesture.type === 'resize') {
      const doc = screenToDoc(local.x, local.y)
      const preview = computeResizedBounds(gesture.startBounds, gesture.handle, doc.x - gesture.startDoc.x, doc.y - gesture.startDoc.y)
      setGesture({ ...gesture, preview })
    } else if (gesture.type === 'ruler-drag') {
      const overRuler = gesture.orientation === 'horizontal' ? local.y < 0 : local.x < 0
      setGesture({ ...gesture, screen: local, overRuler })
    } else if (gesture.type === 'guide-drag') {
      const overRuler = gesture.orientation === 'horizontal' ? local.y < 0 : local.x < 0
      if (!overRuler) {
        const doc = screenToDoc(local.x, local.y)
        updateGuidePosition(gesture.id, gesture.orientation === 'horizontal' ? doc.y : doc.x)
      }
      setGesture({ ...gesture, screen: local, overRuler })
    }
  }

  const handlePointerUp = () => {
    if (!gesture) return
    if (gesture.type === 'draft') {
      const isClickOnly = Math.abs((gesture.currentDoc.x - gesture.startDoc.x) * zoom) < CLICK_THRESHOLD_PX &&
        Math.abs((gesture.currentDoc.y - gesture.startDoc.y) * zoom) < CLICK_THRESHOLD_PX
      const bounds = isClickOnly
        ? { x: gesture.startDoc.x - 20, y: gesture.startDoc.y - 20, width: 40, height: 40 }
        : normalizeDraftBounds(gesture.startDoc, gesture.currentDoc, gesture.shift)
      const id = addShape(gesture.kind, bounds)
      setSelection([id])
      setTool('select')
    } else if (gesture.type === 'move') {
      if (gesture.dx || gesture.dy) {
        moveShapesBy(Object.keys(gesture.originals), gesture.dx, gesture.dy)
      } else if (!gesture.moved && gesture.wasAlreadySelected) {
        setSelection([gesture.clickedId])
      }
    } else if (gesture.type === 'resize') {
      resizeShape(gesture.id, gesture.preview)
    } else if (gesture.type === 'ruler-drag') {
      if (!gesture.overRuler) {
        const doc = screenToDoc(gesture.screen.x, gesture.screen.y)
        addGuide(gesture.orientation, gesture.orientation === 'horizontal' ? doc.y : doc.x)
      }
    } else if (gesture.type === 'guide-drag') {
      if (gesture.overRuler) removeGuide(gesture.id)
    }
    setGesture(null)
  }

  const selectedLayers = selection.map((id) => layers[id]).filter((l): l is NonNullable<typeof l> => !!l)
  const moveOffset = gesture?.type === 'move' ? { dx: gesture.dx, dy: gesture.dy } : undefined
  const isResizing = gesture?.type === 'resize'
  const singleSelected = selectedLayers.length === 1 ? selectedLayers[0] : null

  const selectionBounds = isResizing
    ? gesture.preview
    : unionBounds(selectedLayers.map((l) => shapeWorldBounds(l)).map((b) => (moveOffset ? { ...b, x: b.x + moveOffset.dx, y: b.y + moveOffset.dy } : b)))

  const draftBounds = gesture?.type === 'draft' ? normalizeDraftBounds(gesture.startDoc, gesture.currentDoc, gesture.shift) : null
  const draftKind = gesture?.type === 'draft' ? gesture.kind : null

  const cursor = isSpaceDown || tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair'

  return (
    <div className="canvas-2d">
      {rulersVisible && (
        <>
          <div className="canvas-2d__ruler canvas-2d__ruler--top" onPointerDown={(e) => handleRulerPointerDown(e, 'horizontal')} />
          <div className="canvas-2d__ruler canvas-2d__ruler--left" onPointerDown={(e) => handleRulerPointerDown(e, 'vertical')} />
        </>
      )}

      <svg
        ref={svgRef}
        className="canvas-2d__svg"
        style={{
          cursor,
          top: rulerSize,
          left: rulerSize,
          width: `calc(100% - ${rulerSize}px)`,
          height: `calc(100% - ${rulerSize}px)`,
        }}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          <rect className="canvas-2d__artboard" x={0} y={0} width={ARTBOARD_WIDTH} height={ARTBOARD_HEIGHT} />
          {order.map((id) => {
            const layer = layers[id]
            if (!layer) return null
            return (
              <ShapeElement
                key={id}
                layer={layer}
                isSelected={selection.includes(id)}
                previewOffset={selection.includes(id) ? moveOffset : undefined}
                onPointerDown={(e) => handleShapePointerDown(e, id)}
              />
            )
          })}
          {draftBounds && draftKind && (
            <path
              className="canvas-2d__draft"
              d={pointsToSvgPath(createShapeRegions(draftKind, draftBounds.width, draftBounds.height)[0].outer.points)}
              transform={`translate(${draftBounds.x} ${draftBounds.y})`}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>

        {rulersVisible &&
          guides.map((guide) => {
            const isHorizontal = guide.orientation === 'horizontal'
            const screenPos = isHorizontal ? docToScreen(0, guide.position).y : docToScreen(guide.position, 0).x
            const x1 = isHorizontal ? 0 : screenPos
            const y1 = isHorizontal ? screenPos : 0
            const x2 = isHorizontal ? '100%' : screenPos
            const y2 = isHorizontal ? screenPos : '100%'
            return (
              <g key={guide.id}>
                <line className={`canvas-2d__guide canvas-2d__guide--${guide.orientation}`} x1={x1} y1={y1} x2={x2} y2={y2} />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={8}
                  className={`canvas-2d__guide--${guide.orientation}`}
                  onPointerDown={(e) => handleGuidePointerDown(e, guide.id, guide.orientation)}
                />
              </g>
            )
          })}

        {gesture?.type === 'ruler-drag' && !gesture.overRuler && (
          <line
            className="canvas-2d__guide-preview"
            x1={gesture.orientation === 'horizontal' ? 0 : gesture.screen.x}
            y1={gesture.orientation === 'horizontal' ? gesture.screen.y : 0}
            x2={gesture.orientation === 'horizontal' ? '100%' : gesture.screen.x}
            y2={gesture.orientation === 'horizontal' ? gesture.screen.y : '100%'}
          />
        )}

        {gesture?.type === 'marquee' && (
          <rect
            className="canvas-2d__marquee"
            x={Math.min(gesture.startScreen.x, gesture.currentScreen.x)}
            y={Math.min(gesture.startScreen.y, gesture.currentScreen.y)}
            width={Math.abs(gesture.currentScreen.x - gesture.startScreen.x)}
            height={Math.abs(gesture.currentScreen.y - gesture.startScreen.y)}
          />
        )}

        {selectionBounds && (
          <SelectionOverlay
            bounds={selectionBounds}
            docToScreen={docToScreen}
            resizable={tool === 'select' && !!singleSelected && !singleSelected.locked}
            onResizeStart={singleSelected ? (e, handle) => handleResizePointerDown(e, singleSelected.id, handle) : undefined}
          />
        )}
      </svg>

      <div className="canvas-2d__toolbar">
        <IconButton size="md" active={tool === 'select'} aria-label="Select" onClick={() => setTool('select')}>
          <MousePointer2 size={16} />
        </IconButton>
        <IconButton size="md" active={tool === 'pan'} aria-label="Pan" onClick={() => setTool('pan')}>
          <Hand size={16} />
        </IconButton>
        <IconButton size="md" aria-label="Artboard" disabled>
          <SquareDashed size={16} />
        </IconButton>
        <IconButton size="md" aria-label="Pen" disabled>
          <PenTool size={16} />
        </IconButton>
        {drawTools.map(({ id, label, icon: Icon }) => (
          <IconButton key={id} size="md" active={tool === id} aria-label={label} onClick={() => setTool(id)}>
            <Icon size={16} />
          </IconButton>
        ))}
        <IconButton size="md" aria-label="Cut" disabled>
          <Scissors size={16} />
        </IconButton>
      </div>

      <div className="canvas-2d__zoom">
        <IconButton size="sm" aria-label="Zoom out" onClick={() => zoomAtCenter(1 / 1.2)}>
          <ZoomOut size={14} />
        </IconButton>
        <span>{Math.round(zoom * 100)}%</span>
        <IconButton size="sm" aria-label="Zoom in" onClick={() => zoomAtCenter(1.2)}>
          <ZoomIn size={14} />
        </IconButton>
      </div>

      <div className="canvas-2d__status">
        <span>
          Artboard: {ARTBOARD_WIDTH} × {ARTBOARD_HEIGHT} mm
        </span>
        <span>Layers: {order.length}</span>
        <span>Selected: {selection.length}</span>
      </div>
    </div>
  )
}

function SelectionOverlay({
  bounds,
  docToScreen,
  resizable,
  onResizeStart,
}: {
  bounds: Bounds
  docToScreen: (x: number, y: number) => Point2
  resizable: boolean
  onResizeStart?: (e: React.PointerEvent, handle: ResizeHandle) => void
}) {
  const topLeft = docToScreen(bounds.x, bounds.y)
  const bottomRight = docToScreen(bounds.x + bounds.width, bounds.y + bounds.height)
  const corners: { handle: ResizeHandle; point: Point2 }[] = [
    { handle: 'nw', point: topLeft },
    { handle: 'ne', point: { x: bottomRight.x, y: topLeft.y } },
    { handle: 'sw', point: { x: topLeft.x, y: bottomRight.y } },
    { handle: 'se', point: bottomRight },
  ]

  return (
    <g className="canvas-2d__selection">
      <rect
        x={topLeft.x}
        y={topLeft.y}
        width={bottomRight.x - topLeft.x}
        height={bottomRight.y - topLeft.y}
        className="canvas-2d__selection-outline"
      />
      {resizable &&
        corners.map(({ handle, point }) => (
          <rect
            key={handle}
            x={point.x - 4}
            y={point.y - 4}
            width={8}
            height={8}
            className="canvas-2d__selection-handle"
            style={{ cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize' }}
            onPointerDown={(e) => onResizeStart?.(e, handle)}
          />
        ))}
    </g>
  )
}
