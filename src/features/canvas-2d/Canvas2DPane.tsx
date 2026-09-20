import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react'
import {
  Circle,
  Combine,
  Hand,
  CircleDashed,
  MousePointer2,
  PenTool,
  Pentagon,
  Scissors,
  Square,
  SquareDashed,
  SquaresExclude,
  SquaresIntersect,
  SquaresSubtract,
  SquaresUnite,
  Star,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useDocumentStore, shapeWorldBounds, expandToGroup, type Guide, orderOnPlate } from '../../state/documentStore'
import type { Bounds, Point2, ShapeKind, ShapeLayer } from '../../types/document'
import type { BooleanOp } from '../../lib/geometry/boolean'
import { isTextEntryTarget } from '../../lib/dom/isTextEntryTarget'
import { importSvgFiles } from '../../lib/import/importSvgFiles'
import { ShapeElement } from './ShapeElement'
import { LayerContextMenu, type ContextMenuState } from '../layers/LayerContextMenu'
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
import { plateSlot } from '../../lib/geometry/plateLayout'
import { flattenPenAnchors, type PenAnchor } from '../../lib/geometry/pen'
import { RulerTicks } from './RulerTicks'
import { ASSET_MIME } from '../assets/assetDrag'
import type { AssetDefinition } from '../../lib/assets/types'
import './Canvas2DPane.css'

/** Screen pixels per document mm at "100%": real size on a 96 dpi
 * display, the same 1 mm = 3.78 px that Illustrator/Inkscape/Sketch use
 * for physical units — so a 256 mm plate at 100% is about as big as the
 * real thing, instead of 1 px per mm. */
export const PX_PER_MM_AT_100 = 96 / 25.4
const MIN_ZOOM = 0.02 * PX_PER_MM_AT_100
const MAX_ZOOM = 16 * PX_PER_MM_AT_100
const CLICK_THRESHOLD_PX = 4
const PEN_CLOSE_THRESHOLD_PX = 10

type DrawableTool = ShapeKind
type Tool = 'select' | 'pan' | 'pen' | 'zoom' | DrawableTool

const drawTools: { id: DrawableTool; label: string; icon: typeof Square }[] = [
  { id: 'rect', label: 'Rectangle', icon: Square },
  { id: 'circle', label: 'Circle', icon: Circle },
  { id: 'polygon', label: 'Polygon', icon: Pentagon },
  { id: 'star', label: 'Star', icon: Star },
  { id: 'hole', label: 'Hole', icon: CircleDashed },
]

const booleanOps: { id: BooleanOp; label: string; icon: typeof Square }[] = [
  { id: 'union', label: 'Union', icon: SquaresUnite },
  { id: 'subtract', label: 'Subtract', icon: SquaresSubtract },
  { id: 'intersect', label: 'Intersect', icon: SquaresIntersect },
  { id: 'exclude', label: 'Exclude', icon: SquaresExclude },
]

type Gesture =
  | { type: 'pan'; startScreen: Point2; startPan: Point2 }
  | { type: 'draft'; kind: DrawableTool; startDoc: Point2; currentDoc: Point2; shift: boolean }
  | { type: 'marquee'; startScreen: Point2; currentScreen: Point2; additive: boolean; baseSelection: string[] }
  | { type: 'zoom-drag'; startScreen: Point2; currentScreen: Point2; alt: boolean }
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
  const [isAltDown, setIsAltDown] = useState(false)
  const [penAnchors, setPenAnchors] = useState<PenAnchor[]>([])
  const [penCursor, setPenCursor] = useState<Point2 | null>(null)
  const [penDraftHandle, setPenDraftHandle] = useState<{
    anchorIndex: number
    startDoc: Point2
    mode: 'handle' | 'move'
    original?: PenAnchor
  } | null>(null)

  const layers = useDocumentStore((s) => s.layers)
  const allOrder = useDocumentStore((s) => s.order)
  const plates = useDocumentStore((s) => s.plates)
  const activePlateId = useDocumentStore((s) => s.activePlateId)
  // Only the active plate is drawn and editable here.
  const order = useMemo(() => orderOnPlate({ layers, order: allOrder, plates }, activePlateId), [layers, allOrder, plates, activePlateId])
  const setActivePlate = useDocumentStore((s) => s.setActivePlate)
  const showAllPlates = useDocumentStore((s) => s.showAllPlates)
  const artboardColor = useDocumentStore((s) => s.artboardColor)
  const moveShapesToPlate = useDocumentStore((s) => s.moveShapesToPlate)
  const activeIndex = Math.max(0, plates.findIndex((p) => p.id === activePlateId))
  const selection = useDocumentStore((s) => s.selection)
  const setSelection = useDocumentStore((s) => s.setSelection)
  const addShape = useDocumentStore((s) => s.addShape)
  const moveShapesBy = useDocumentStore((s) => s.moveShapesBy)
  const resizeShape = useDocumentStore((s) => s.resizeShape)
  const duplicateShapes = useDocumentStore((s) => s.duplicateShapes)
  const applyBoolean = useDocumentStore((s) => s.applyBoolean)
  const addPenShape = useDocumentStore((s) => s.addPenShape)
  const bedPresetId = useDocumentStore((s) => s.bedPresetId)
  const customBedWidth = useDocumentStore((s) => s.customBedWidth)
  const customBedHeight = useDocumentStore((s) => s.customBedHeight)
  const bed = getBedPreset(bedPresetId)
  const ARTBOARD_WIDTH = bed?.width ?? customBedWidth
  const ARTBOARD_HEIGHT = bed?.height ?? customBedHeight
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

  const zoomToBounds = useCallback((bounds: Bounds, padding = 60) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const availW = Math.max(50, rect.width - padding * 2)
    const availH = Math.max(50, rect.height - padding * 2)
    const w = Math.max(1, bounds.width)
    const h = Math.max(1, bounds.height)
    const nextZoom = clamp(Math.min(availW / w, availH / h), MIN_ZOOM, MAX_ZOOM)
    setZoom(nextZoom)
    setPan({
      x: rect.width / 2 - (bounds.x + w / 2) * nextZoom,
      y: rect.height / 2 - (bounds.y + h / 2) * nextZoom,
    })
  }, [])

  const fitToView = useCallback(() => {
    zoomToBounds({ x: 0, y: 0, width: ARTBOARD_WIDTH, height: ARTBOARD_HEIGHT })
  }, [zoomToBounds, ARTBOARD_WIDTH, ARTBOARD_HEIGHT])

  const zoomToSelection = useCallback(() => {
    const bounds = unionBounds(
      selection.map((id) => layers[id]).filter((l): l is ShapeLayer => !!l).map(shapeWorldBounds),
    )
    if (bounds) zoomToBounds(bounds, 100)
  }, [zoomToBounds, selection, layers])

  useLayoutEffect(() => {
    fitToView()
  }, [fitToView])

  // The other plates, drawn dimmed around the active one at their fixed
  // places (creation order, see plateLayout.ts). Document coordinates are
  // per plate, so each one is shifted by its slot minus the active slot.
  const otherPlates = useMemo(() => {
    const active = plateSlot(activeIndex, plates.length, ARTBOARD_WIDTH, ARTBOARD_HEIGHT)
    return plates
      .map((plate, index) => {
        const slot = plateSlot(index, plates.length, ARTBOARD_WIDTH, ARTBOARD_HEIGHT)
        return { plate, index, dx: slot.x - active.x, dy: slot.y - active.y, order: orderOnPlate({ layers, order: allOrder, plates }, plate.id) }
      })
      .filter((p) => p.plate.id !== activePlateId && showAllPlates)
  }, [plates, activeIndex, activePlateId, ARTBOARD_WIDTH, ARTBOARD_HEIGHT, layers, allOrder, showAllPlates])

  // Switching plates re-bases the coordinates on the new plate: shift the
  // view by the same amount so every plate stays where it was on screen,
  // then bring the new active plate into view if it was outside.
  const lastSlot = useRef<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const slot = plateSlot(activeIndex, plates.length, ARTBOARD_WIDTH, ARTBOARD_HEIGHT)
    const prev = lastSlot.current
    lastSlot.current = slot
    if (!prev || (prev.x === slot.x && prev.y === slot.y)) return
    const nextPan = { x: pan.x + (slot.x - prev.x) * zoom, y: pan.y + (slot.y - prev.y) * zoom }
    const rect = svgRef.current?.getBoundingClientRect()
    const visible = rect && nextPan.x >= 0 && nextPan.y >= 0 && nextPan.x + ARTBOARD_WIDTH * zoom <= rect.width && nextPan.y + ARTBOARD_HEIGHT * zoom <= rect.height
    if (visible || !rect) setPan(nextPan)
    else setPan({ x: rect.width / 2 - (ARTBOARD_WIDTH / 2) * zoom, y: rect.height / 2 - (ARTBOARD_HEIGHT / 2) * zoom })
  }, [activeIndex, plates.length, ARTBOARD_WIDTH, ARTBOARD_HEIGHT]) // eslint-disable-line react-hooks/exhaustive-deps

  // Back to a single plate: frame it again.
  const plateCountRef = useRef(plates.length)
  useLayoutEffect(() => {
    if (plateCountRef.current === plates.length) return
    plateCountRef.current = plates.length
    if (plates.length === 1) fitToView()
  }, [plates.length, fitToView])

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

  const cancelPenPath = () => {
    setPenAnchors([])
    setPenDraftHandle(null)
  }

  const finalizePenPath = () => {
    if (penAnchors.length >= 3) {
      const flattened = flattenPenAnchors(penAnchors, true)
      const id = addPenShape(flattened)
      setSelection([id])
    }
    setPenAnchors([])
    setPenDraftHandle(null)
    setTool('select')
  }

  useEffect(() => {
    if (tool !== 'pen') cancelPenPath()
  }, [tool])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const typing = isTextEntryTarget(e.target)
      if (e.key === 'Alt') setIsAltDown(true)
      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        setIsSpaceDown(true)
      }
      const mod = e.metaKey || e.ctrlKey
      if (e.shiftKey && (e.key === '=' || e.key === '+') && !typing) {
        e.preventDefault()
        zoomAtCenter(1.2)
      } else if (e.shiftKey && (e.key === '-' || e.key === '_') && !typing) {
        e.preventDefault()
        zoomAtCenter(1 / 1.2)
      } else if (!mod && e.shiftKey && (e.key === '1' || e.key === '!') && !typing) {
        e.preventDefault()
        fitToView()
      } else if (!mod && e.shiftKey && (e.key === '2' || e.key === '@') && !typing) {
        e.preventDefault()
        zoomToSelection()
      } else if (!mod && !e.shiftKey && e.key.toLowerCase() === 'h' && !typing) {
        e.preventDefault()
        setTool('pan')
      } else if (!mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        setTool('zoom')
      } else if (mod && (e.key === '=' || e.key === '+') && !typing) {
        // Cmd/Ctrl+= is the browser's own page-zoom shortcut — capture and
        // redirect it to the canvas instead of letting it zoom the page.
        e.preventDefault()
        zoomAtCenter(1.2)
      } else if (mod && e.key === '-' && !typing) {
        e.preventDefault()
        zoomAtCenter(1 / 1.2)
      } else if (mod && (e.key === '0' || e.key.toLowerCase() === 'o') && !typing) {
        // Cmd+0 (and Cmd+O, which is otherwise the browser's open-file
        // dialog) both go to real-size 100%.
        e.preventDefault()
        zoomAtCenter(PX_PER_MM_AT_100 / zoom)
      } else if (mod && e.key.toLowerCase() === 'r' && !typing) {
        e.preventDefault()
        toggleRulersVisible()
      } else if (e.key === 'Escape' && tool === 'pen') {
        cancelPenPath()
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') setIsSpaceDown(false)
      if (e.key === 'Alt') setIsAltDown(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [zoom, pan, fitToView, zoomToSelection, toggleRulersVisible, tool])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    // Attached as a real native listener (not React's onWheel) so
    // preventDefault reliably works — React can register its root wheel
    // listener as passive, which silently no-ops preventDefault from a JSX
    // handler in some browsers.
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      // Trackpad pinch (browsers report it as wheel + ctrlKey) or an
      // explicit Cmd/Ctrl held while scrolling zooms; a plain scroll —
      // mouse wheel or a two-finger trackpad swipe — pans instead, same as
      // every design tool.
      if (e.ctrlKey || e.metaKey) {
        const rect = svg!.getBoundingClientRect()
        const local = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        const docPoint = screenToDoc(local.x, local.y)
        // Same feel as the 3D orbit: a trackpad pinch step is a few
        // percent, a mouse-wheel notch about a quarter. Line/page deltas
        // (some mice) are normalised to pixels first, and one event never
        // jumps more than that notch.
        const delta = clamp(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1), -50, 50)
        const factor = Math.exp(-delta * 0.006)
        const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM)
        setZoom(nextZoom)
        setPan({ x: local.x - docPoint.x * nextZoom, y: local.y - docPoint.y * nextZoom })
      } else {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
      }
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoom, screenToDoc])

  const startPan = (e: React.PointerEvent) => {
    const local = getLocalPoint(e)
    svgRef.current?.setPointerCapture(e.pointerId)
    setGesture({ type: 'pan', startScreen: local, startPan: pan })
  }

  // An inspector field keeps keyboard focus after you click back onto the
  // canvas (the SVG isn't focusable), which made Backspace/Delete look
  // broken — the typing guard was correctly refusing to delete shapes while
  // a text input was still focused. Clicking the canvas now ends that edit.
  const blurActiveInput = () => {
    const active = document.activeElement
    if (active instanceof HTMLElement && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur()
  }

  const handleBackgroundPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    blurActiveInput()
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
    if (tool === 'pen') {
      handlePenPointerDown(e)
      return
    }
    if (tool === 'zoom') {
      setGesture({ type: 'zoom-drag', startScreen: local, currentScreen: local, alt: e.altKey })
      return
    }
    const doc = screenToDoc(local.x, local.y)
    setGesture({ type: 'draft', kind: tool, startDoc: doc, currentDoc: doc, shift: e.shiftKey })
  }

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  // Right-click on a shape: the same menu as the layers panel, for the
  // shape (or its group, or the whole selection when it is part of one).
  // Handled on the svg because the pointer capture taken on pointerdown
  // retargets the contextmenu event there; the shape is found by position.
  const handleContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault()
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGGElement>('[data-shape-id]')
    const id = el?.dataset.shapeId
    if (!id || !layers[id]) return
    if (!selection.includes(id)) setSelection(expandToGroup(layers, order, id))
    setContextMenu({ x: e.clientX, y: e.clientY, layerId: id })
  }

  const handleShapePointerDown = (e: React.PointerEvent<SVGGElement>, id: string) => {
    blurActiveInput()
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
    // Right button: the contextmenu handler takes it from here.
    if (e.button === 2) return
    const layer = layers[id]
    if (!layer) return
    const local = getLocalPoint(e)
    svgRef.current?.setPointerCapture(e.pointerId)
    const doc = screenToDoc(local.x, local.y)
    // Clicking a grouped shape grabs the whole group; Cmd/Ctrl-click drills
    // straight into the single member. Clicking anything already selected
    // keeps the selection so a drag moves it as a whole — and if that
    // click ends without moving, pointer-up drills one level deeper into
    // the clicked member (Figma's "click again to go deeper").
    const group = expandToGroup(layers, order, id)
    let clickTargets: string[]
    let wasAlreadySelected: boolean
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      clickTargets = e.shiftKey && !(e.metaKey || e.ctrlKey) ? group : [id]
      wasAlreadySelected = clickTargets.every((tid) => selection.includes(tid))
    } else if (selection.includes(id)) {
      clickTargets = selection
      wasAlreadySelected = true
    } else {
      clickTargets = group
      wasAlreadySelected = false
    }

    // Shift adds/removes the whole group, Cmd/Ctrl the single shape.
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelection(
        wasAlreadySelected
          ? selection.filter((sid) => !clickTargets.includes(sid))
          : Array.from(new Set([...selection, ...clickTargets])),
      )
      return
    }

    const nextSelection = wasAlreadySelected ? selection : clickTargets

    // Option/Alt-drag: duplicate first, then drag the copies — the originals
    // stay put, exactly like Option-drag in Figma/Illustrator.
    if (e.altKey && !layer.locked) {
      const newIds = duplicateShapes(nextSelection)
      moveShapesBy(newIds, -10, -10) // duplicateShapes offsets by +10,+10; undo that so the copy starts exactly where the original was
      const freshLayers = useDocumentStore.getState().layers
      const originals: Record<string, Point2> = {}
      for (const sid of newIds) {
        const l = freshLayers[sid]
        if (l) originals[sid] = { x: l.transform.x, y: l.transform.y }
      }
      const clickedIndex = nextSelection.indexOf(id)
      const clickedId = newIds[clickedIndex] ?? newIds[0]
      setGesture({ type: 'move', startDoc: doc, originals, dx: 0, dy: 0, moved: false, clickedId, wasAlreadySelected: true })
      return
    }

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

  const handlePenPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const local = getLocalPoint(e)
    const doc = screenToDoc(local.x, local.y)
    svgRef.current?.setPointerCapture(e.pointerId)

    // Cmd/Ctrl passthrough: grab an existing draft anchor to reposition it
    // instead of adding a new one.
    if (e.metaKey || e.ctrlKey) {
      const hitIndex = penAnchors.findIndex((a) => {
        const s = docToScreen(a.point.x, a.point.y)
        return Math.hypot(local.x - s.x, local.y - s.y) < PEN_CLOSE_THRESHOLD_PX
      })
      if (hitIndex >= 0) {
        setPenDraftHandle({ anchorIndex: hitIndex, startDoc: doc, mode: 'move', original: penAnchors[hitIndex] })
        return
      }
    }

    // Click back on the first anchor closes the path.
    if (penAnchors.length >= 2) {
      const firstScreen = docToScreen(penAnchors[0].point.x, penAnchors[0].point.y)
      if (Math.hypot(local.x - firstScreen.x, local.y - firstScreen.y) < PEN_CLOSE_THRESHOLD_PX) {
        finalizePenPath()
        return
      }
    }

    const anchorIndex = penAnchors.length
    setPenAnchors((prev) => [...prev, { point: doc, type: 'corner' }])
    setPenDraftHandle({ anchorIndex, startDoc: doc, mode: 'handle' })
  }

  const handlePenPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const local = getLocalPoint(e)
    const doc = screenToDoc(local.x, local.y)
    setPenCursor(doc)
    if (!penDraftHandle) return

    const dxRaw = doc.x - penDraftHandle.startDoc.x
    const dyRaw = doc.y - penDraftHandle.startDoc.y

    if (penDraftHandle.mode === 'move' && penDraftHandle.original) {
      const original = penDraftHandle.original
      const idx = penDraftHandle.anchorIndex
      setPenAnchors((prev) =>
        prev.map((a, i) =>
          i === idx
            ? {
                ...a,
                point: { x: original.point.x + dxRaw, y: original.point.y + dyRaw },
                handleIn: original.handleIn ? { x: original.handleIn.x + dxRaw, y: original.handleIn.y + dyRaw } : undefined,
                handleOut: original.handleOut ? { x: original.handleOut.x + dxRaw, y: original.handleOut.y + dyRaw } : undefined,
              }
            : a,
        ),
      )
      return
    }

    let dx = dxRaw
    let dy = dyRaw
    if (e.shiftKey) {
      const angle = Math.atan2(dy, dx)
      const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
      const dist = Math.hypot(dx, dy)
      dx = Math.cos(snapped) * dist
      dy = Math.sin(snapped) * dist
    }
    if (Math.hypot(dx * zoom, dy * zoom) <= CLICK_THRESHOLD_PX) return

    const idx = penDraftHandle.anchorIndex
    const handleOut = { x: penDraftHandle.startDoc.x + dx, y: penDraftHandle.startDoc.y + dy }
    const handleIn = { x: penDraftHandle.startDoc.x - dx, y: penDraftHandle.startDoc.y - dy }
    setPenAnchors((prev) =>
      prev.map((a, i) =>
        i === idx
          ? e.altKey
            ? { ...a, handleOut, type: 'corner' as const }
            : { ...a, handleOut, handleIn, type: 'symmetric' as const }
          : a,
      ),
    )
  }

  const handlePenPointerUp = () => {
    setPenDraftHandle(null)
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
    if (!gesture) {
      if (tool === 'pen') handlePenPointerMove(e)
      return
    }
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
      const hits = Array.from(
        new Set(
          order
            .filter((id) => rectsIntersect(marqueeBounds, shapeWorldBounds(layers[id])))
            .flatMap((id) => expandToGroup(layers, order, id)),
        ),
      )
      const merged = gesture.additive ? Array.from(new Set([...gesture.baseSelection, ...hits])) : hits
      setSelection(merged)
      setGesture({ ...gesture, currentScreen: local })
    } else if (gesture.type === 'zoom-drag') {
      setGesture({ ...gesture, currentScreen: local, alt: e.altKey })
    } else if (gesture.type === 'move') {
      const doc = screenToDoc(local.x, local.y)
      const dx = doc.x - gesture.startDoc.x
      const dy = doc.y - gesture.startDoc.y
      const moved = gesture.moved || Math.abs(dx * zoom) > CLICK_THRESHOLD_PX || Math.abs(dy * zoom) > CLICK_THRESHOLD_PX
      setGesture({ ...gesture, dx, dy, moved })
    } else if (gesture.type === 'resize') {
      const doc = screenToDoc(local.x, local.y)
      const preview = computeResizedBounds(
        gesture.startBounds,
        gesture.handle,
        doc.x - gesture.startDoc.x,
        doc.y - gesture.startDoc.y,
        e.shiftKey,
      )
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
    if (!gesture) {
      if (tool === 'pen') handlePenPointerUp()
      return
    }
    if (gesture.type === 'draft') {
      const isClickOnly = Math.abs((gesture.currentDoc.x - gesture.startDoc.x) * zoom) < CLICK_THRESHOLD_PX &&
        Math.abs((gesture.currentDoc.y - gesture.startDoc.y) * zoom) < CLICK_THRESHOLD_PX
      const bounds = isClickOnly
        ? { x: gesture.startDoc.x - 20, y: gesture.startDoc.y - 20, width: 40, height: 40 }
        : normalizeDraftBounds(gesture.startDoc, gesture.currentDoc, gesture.shift)
      const id = addShape(gesture.kind, bounds)
      setSelection([id])
      setTool('select')
    } else if (gesture.type === 'zoom-drag') {
      const dragPx = Math.hypot(gesture.currentScreen.x - gesture.startScreen.x, gesture.currentScreen.y - gesture.startScreen.y)
      if (dragPx < CLICK_THRESHOLD_PX) {
        // A plain click: zoom in centered on it, Alt/Option zooms out instead.
        const docPoint = screenToDoc(gesture.startScreen.x, gesture.startScreen.y)
        const factor = gesture.alt ? 0.5 : 2
        const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM)
        setZoom(nextZoom)
        setPan({ x: gesture.startScreen.x - docPoint.x * nextZoom, y: gesture.startScreen.y - docPoint.y * nextZoom })
      } else {
        // A drag: zoom to fit the marquee'd region.
        const startDoc = screenToDoc(gesture.startScreen.x, gesture.startScreen.y)
        const currentDoc = screenToDoc(gesture.currentScreen.x, gesture.currentScreen.y)
        zoomToBounds(
          {
            x: Math.min(startDoc.x, currentDoc.x),
            y: Math.min(startDoc.y, currentDoc.y),
            width: Math.abs(currentDoc.x - startDoc.x),
            height: Math.abs(currentDoc.y - startDoc.y),
          },
          20,
        )
      }
    } else if (gesture.type === 'move') {
      if (gesture.dx || gesture.dy) {
        const ids = Object.keys(gesture.originals)
        // Dropped onto another plate: the shapes move there, keeping their
        // place on screen.
        const bounds = unionBounds(ids.map((id) => layers[id]).filter((l): l is ShapeLayer => !!l).map(shapeWorldBounds))
        const cx = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2 + gesture.dx
        const cy = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2 + gesture.dy
        const target = otherPlates.find((p) => cx >= p.dx && cx <= p.dx + ARTBOARD_WIDTH && cy >= p.dy && cy <= p.dy + ARTBOARD_HEIGHT)
        if (target && !(cx >= 0 && cx <= ARTBOARD_WIDTH && cy >= 0 && cy <= ARTBOARD_HEIGHT)) {
          moveShapesBy(ids, gesture.dx - target.dx, gesture.dy - target.dy)
          setActivePlate(target.plate.id)
          moveShapesToPlate(ids, target.plate.id)
          setSelection(ids)
        } else moveShapesBy(ids, gesture.dx, gesture.dy)
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

  const cursor =
    isSpaceDown || tool === 'pan'
      ? 'grab'
      : tool === 'select'
        ? 'default'
        : tool === 'zoom'
          ? isAltDown
            ? 'zoom-out'
            : 'zoom-in'
          : 'crosshair'
  const rulerLengthPx = { width: svgRef.current?.clientWidth ?? 0, height: svgRef.current?.clientHeight ?? 0 }

  // Drag-and-drop SVG import: dropped files land centered on the pointer.
  const [isDropTarget, setIsDropTarget] = useState(false)
  const dragDepth = useRef(0)
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files') || Array.from(e.dataTransfer.types).includes(ASSET_MIME)
  const onDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current++
    setIsDropTarget(true)
  }
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDropTarget(false)
  }
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setIsDropTarget(false)
    const svg = svgRef.current
    let at: Point2 | undefined
    if (svg) {
      const rect = svg.getBoundingClientRect()
      at = screenToDoc(e.clientX - rect.left, e.clientY - rect.top)
    }
    const assetJson = e.dataTransfer.getData(ASSET_MIME)
    if (assetJson) {
      // An asset dragged from the Assets panel lands centered on the pointer.
      try {
        const asset = JSON.parse(assetJson) as AssetDefinition
        const center = at ?? { x: 0, y: 0 }
        useDocumentStore.getState().addAsset(asset, { x: center.x - asset.width / 2, y: center.y - asset.height / 2 })
        setTool('select')
      } catch (err) {
        console.error('Dropped asset could not be read:', err)
      }
      return
    }
    void importSvgFiles(e.dataTransfer.files, at).then((ids) => {
      if (ids.length) setTool('select')
    })
  }

  return (
    <div
      className={`canvas-2d ${isDropTarget ? 'canvas-2d--drop-target' : ''}`}
      onContextMenu={(e) => e.preventDefault()}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {rulersVisible && (
        <>
          <div className="canvas-2d__ruler canvas-2d__ruler--top" onPointerDown={(e) => handleRulerPointerDown(e, 'horizontal')}>
            <RulerTicks orientation="horizontal" lengthPx={rulerLengthPx.width} zoom={zoom} pan={pan} />
          </div>
          <div className="canvas-2d__ruler canvas-2d__ruler--left" onPointerDown={(e) => handleRulerPointerDown(e, 'vertical')}>
            <div className="canvas-2d__ruler-left-ticks" style={{ top: rulerSize }}>
              <RulerTicks orientation="vertical" lengthPx={rulerLengthPx.height} zoom={zoom} pan={pan} />
            </div>
          </div>
        </>
      )}

      <svg
        ref={svgRef}
        className="canvas-2d__svg"
        onContextMenu={handleContextMenu}
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
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {otherPlates.map(({ plate, dx, dy, order: plateOrder }) => (
            <g key={plate.id} className="canvas-2d__ghost-plate" transform={`translate(${dx} ${dy})`}>
              <rect className="canvas-2d__artboard" x={0} y={0} width={ARTBOARD_WIDTH} height={ARTBOARD_HEIGHT} style={{ fill: artboardColor, fillOpacity: 0.3 }} />
              <g className="canvas-2d__ghost-plate-shapes">
                {plateOrder.map((id) => {
                  const layer = layers[id]
                  return layer ? <ShapeElement key={id} layer={layer} isSelected={false} onPointerDown={() => {}} /> : null
                })}
              </g>
              <rect
                className="canvas-2d__ghost-plate-hit"
                x={0}
                y={0}
                width={ARTBOARD_WIDTH}
                height={ARTBOARD_HEIGHT}
                onPointerDown={(e) => {
                  // A shape drag may end here (handled on pointer-up); a plain
                  // click on a plate makes it the active one.
                  if (gesture) return
                  e.stopPropagation()
                  setActivePlate(plate.id)
                }}
              >
                <title>{`${plate.name}: click to edit this plate`}</title>
              </rect>
              <text className="canvas-2d__plate-label" x={0} y={-6 / zoom} fontSize={12 / zoom}>
                {plate.name}
              </text>
            </g>
          ))}
          <rect className="canvas-2d__artboard" x={0} y={0} width={ARTBOARD_WIDTH} height={ARTBOARD_HEIGHT} style={{ fill: artboardColor }} />
          {plates.length > 1 && (
            <text className="canvas-2d__plate-label canvas-2d__plate-label--active" x={0} y={-6 / zoom} fontSize={12 / zoom}>
              {plates[activeIndex]?.name}
            </text>
          )}
          {order.map((id) => {
            const layer = layers[id]
            if (!layer) return null
            return (
              <ShapeElement
                key={id}
                layer={layer}
                isSelected={selection.includes(id)}
                previewOffset={selection.includes(id) ? moveOffset : undefined}
                previewResize={isResizing && gesture.id === id ? { startBounds: gesture.startBounds, bounds: gesture.preview } : undefined}
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

        {(gesture?.type === 'marquee' || gesture?.type === 'zoom-drag') && (
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

        {tool === 'pen' && penAnchors.length > 0 && (
          <PenDraftOverlay anchors={penAnchors} cursor={penCursor} docToScreen={docToScreen} />
        )}
      </svg>

      {selection.length >= 2 && (
        <div className="canvas-2d__boolean-toolbar">
          {booleanOps.map(({ id, label, icon: Icon }) => (
            <IconButton key={id} size="md" aria-label={label} onClick={() => applyBoolean(id)}>
              <Icon size={16} />
            </IconButton>
          ))}
          <div className="canvas-2d__boolean-toolbar-divider" />
          <IconButton size="md" aria-label="Flatten" onClick={() => applyBoolean('union')}>
            <Combine size={16} />
          </IconButton>
        </div>
      )}

      <div className="canvas-2d__toolbar">
        <IconButton size="md" active={tool === 'select'} aria-label="Select" onClick={() => setTool('select')}>
          <MousePointer2 size={16} />
        </IconButton>
        <IconButton size="md" active={tool === 'pan'} aria-label="Pan" shortcut="H" onClick={() => setTool('pan')}>
          <Hand size={16} />
        </IconButton>
        <IconButton size="md" active={tool === 'zoom'} aria-label="Zoom" shortcut="Z" onClick={() => setTool('zoom')}>
          <ZoomIn size={16} />
        </IconButton>
        <IconButton size="md" aria-label="Artboard" disabled>
          <SquareDashed size={16} />
        </IconButton>
        <IconButton size="md" active={tool === 'pen'} aria-label="Pen" onClick={() => setTool('pen')}>
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
        <IconButton size="sm" aria-label="Zoom out" shortcut="⇧-" onClick={() => zoomAtCenter(1 / 1.2)}>
          <ZoomOut size={14} />
        </IconButton>
        <button
          type="button"
          className="canvas-2d__zoom-value"
          title="Reset to 100% (real size) — ⌘0"
          onClick={() => zoomAtCenter(PX_PER_MM_AT_100 / zoom)}
        >
          {Math.round((zoom / PX_PER_MM_AT_100) * 100)}%
        </button>
        <IconButton size="sm" aria-label="Zoom in" shortcut="⇧+" onClick={() => zoomAtCenter(1.2)}>
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
      {contextMenu && <LayerContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />}
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
  const midX = (topLeft.x + bottomRight.x) / 2
  const midY = (topLeft.y + bottomRight.y) / 2
  const corners: { handle: ResizeHandle; point: Point2 }[] = [
    { handle: 'nw', point: topLeft },
    { handle: 'ne', point: { x: bottomRight.x, y: topLeft.y } },
    { handle: 'sw', point: { x: topLeft.x, y: bottomRight.y } },
    { handle: 'se', point: bottomRight },
  ]
  // Edge midpoint handles resize a single axis, letting a shape be adjusted
  // from its sides and not just its corners.
  const edges: { handle: ResizeHandle; point: Point2; horizontal: boolean }[] = [
    { handle: 'n', point: { x: midX, y: topLeft.y }, horizontal: true },
    { handle: 's', point: { x: midX, y: bottomRight.y }, horizontal: true },
    { handle: 'w', point: { x: topLeft.x, y: midY }, horizontal: false },
    { handle: 'e', point: { x: bottomRight.x, y: midY }, horizontal: false },
  ]
  const edgeLength = Math.min(24, Math.max(0, Math.abs(bottomRight.x - topLeft.x) - 16))
  const edgeLengthV = Math.min(24, Math.max(0, Math.abs(bottomRight.y - topLeft.y) - 16))

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
        edges.map(({ handle, point, horizontal }) => {
          const len = horizontal ? edgeLength : edgeLengthV
          if (len <= 0) return null
          return (
            <rect
              key={handle}
              x={point.x - (horizontal ? len / 2 : 4)}
              y={point.y - (horizontal ? 4 : len / 2)}
              width={horizontal ? len : 8}
              height={horizontal ? 8 : len}
              className="canvas-2d__selection-edge-handle"
              style={{ cursor: horizontal ? 'ns-resize' : 'ew-resize' }}
              onPointerDown={(e) => onResizeStart?.(e, handle)}
            />
          )
        })}
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

function PenDraftOverlay({
  anchors,
  cursor,
  docToScreen,
}: {
  anchors: PenAnchor[]
  cursor: Point2 | null
  docToScreen: (x: number, y: number) => Point2
}) {
  const previewAnchors = cursor ? [...anchors, { point: cursor, type: 'corner' as const }] : anchors
  const rawPoints = flattenPenAnchors(previewAnchors, false)
  const screenPoints = rawPoints.map((p) => docToScreen(p.x, p.y))
  const d =
    screenPoints.length > 1
      ? `M ${screenPoints[0].x} ${screenPoints[0].y} ` + screenPoints.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')
      : ''

  return (
    <g className="canvas-2d__pen-draft">
      {d && <path d={d} />}
      {anchors.map((a, i) => {
        const pt = docToScreen(a.point.x, a.point.y)
        const hIn = a.handleIn ? docToScreen(a.handleIn.x, a.handleIn.y) : null
        const hOut = a.handleOut ? docToScreen(a.handleOut.x, a.handleOut.y) : null
        return (
          <g key={i}>
            {hIn && <line x1={pt.x} y1={pt.y} x2={hIn.x} y2={hIn.y} className="canvas-2d__pen-handle-line" />}
            {hOut && <line x1={pt.x} y1={pt.y} x2={hOut.x} y2={hOut.y} className="canvas-2d__pen-handle-line" />}
            {hIn && <circle cx={hIn.x} cy={hIn.y} r={3} className="canvas-2d__pen-handle-dot" />}
            {hOut && <circle cx={hOut.x} cy={hOut.y} r={3} className="canvas-2d__pen-handle-dot" />}
            <circle
              cx={pt.x}
              cy={pt.y}
              r={4}
              className={i === 0 && anchors.length >= 2 ? 'canvas-2d__pen-anchor canvas-2d__pen-anchor--close' : 'canvas-2d__pen-anchor'}
            />
          </g>
        )
      })}
    </g>
  )
}
