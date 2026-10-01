import { useEffect, useState } from 'react'
import { Copy, Download, Image, X } from 'lucide-react'
import type { ProductSpec, ProductTemplate } from '../../lib/products'
import { buildPrompt, recipeJson } from '../../lib/products/recipe'
import { buildExportMeshes } from '../../lib/export/exportMeshes'
import { renderMeshPicture } from '../../lib/export/thumbnail'
import { artboardSize, useDocumentStore } from '../../state/documentStore'
import { useViewStore } from '../../state/viewStore'
import '../auth/AuthDialog.css'
import './MockupDialog.css'

/**
 * The mockup kit for a product on the plate: a render of the exact part
 * (hooks, holes, slope and all) to attach as the reference picture, the
 * prompt that goes with it, and the recipe that rebuilds the part here.
 */
export function MockupDialog({ template, spec, layerIds, onClose }: { template: ProductTemplate; spec: ProductSpec; layerIds: string[]; onClose: () => void }) {
  const [picture, setPicture] = useState<{ url: string; blob: Blob } | null>(null)
  const [back, setBack] = useState<{ url: string; blob: Blob } | null>(null)
  const [failed, setFailed] = useState(false)
  const setNotice = useViewStore((s) => s.setNotice)
  const layers = useDocumentStore((s) => s.layers)
  const groupLayers = layerIds.map((id) => layers[id]).filter(Boolean)
  const [prompt] = useState(() => buildPrompt(template, spec, { layers: groupLayers, withPicture: true }))

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    let backUrl: string | null = null
    ;(async () => {
      try {
        const state = useDocumentStore.getState()
        const bed = artboardSize(state)
        const own = new Set(layerIds)
        const meshes = await buildExportMeshes(state.layers, state.order.filter((id) => own.has(id)), { plates: state.plates, bedWidth: bed.width, bedDepth: bed.height }, undefined, state.groups)
        const blob = await renderMeshPicture(meshes, 1280, 720, 'png', '#f4f5f7')
        if (cancelled || !blob) {
          if (!cancelled) setFailed(true)
          return
        }
        url = URL.createObjectURL(blob)
        setPicture({ url, blob })
        const rear = await renderMeshPicture(meshes, 1280, 720, 'png', '#f4f5f7', 0.9, 'back')
        if (!cancelled && rear) {
          backUrl = URL.createObjectURL(rear)
          setBack({ url: backUrl, blob: rear })
        }
      } catch (err) {
        console.warn('Mockup render failed', err)
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
      if (backUrl) URL.revokeObjectURL(backUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(`${what} copied.`)
    } catch {
      setNotice(`Could not reach the clipboard; ${what.toLowerCase()} is in the browser console.`)
      console.log(text)
    }
  }
  const copyPicture = async (p: { blob: Blob }) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': p.blob })])
      setNotice('Picture copied. Paste it into your image tool, then paste the prompt.')
    } catch {
      setNotice('Your browser cannot copy pictures; use Download instead.')
    }
  }
  const download = (p: { url: string }, suffix: string) => {
    const a = document.createElement('a')
    a.href = p.url
    a.download = `${template.id}-${suffix}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="auth-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="auth-dialog mockup-dialog" role="dialog" aria-modal="true" aria-labelledby="mockup-title">
        <button type="button" className="auth-dialog__close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
        <h2 id="mockup-title">Mockup kit · {template.name}</h2>
        <p className="mockup-dialog__lead">Three things for your image tool: attach the picture, paste the prompt, and the recipe at the end of the prompt brings the exact part back here.</p>
        <ol className="mockup-dialog__steps">
          <li>
            <div className="mockup-dialog__step-head">
              <strong>1. Reference pictures</strong>
              <span>Renders of the part as it is, holes and hooks included: the front, and the back with the mounts. Attach both so the tool keeps the geometry.</span>
            </div>
            <div className="mockup-dialog__pictures">
              {[
                { p: picture, label: 'Front', suffix: 'front' },
                { p: back, label: 'Back', suffix: 'back' },
              ].map(({ p, label, suffix }) => (
                <div key={suffix} className="mockup-dialog__shot">
                  <div className="mockup-dialog__picture">{p ? <img src={p.url} alt={`${label} render of the part`} /> : failed ? <span>Could not render here.</span> : <span>Rendering…</span>}</div>
                  <div className="mockup-dialog__row">
                    <span className="mockup-dialog__label">{label}</span>
                    <button type="button" className="mockup-dialog__btn" disabled={!p} onClick={() => p && download(p, suffix)}>
                      <Download size={14} /> PNG
                    </button>
                    <button type="button" className="mockup-dialog__btn" disabled={!p} onClick={() => p && copyPicture(p)}>
                      <Image size={14} /> Copy
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </li>
          <li>
            <div className="mockup-dialog__step-head">
              <strong>2. Prompt</strong>
              <span>Says what the part is and how to show it; the scene and colour vary each time.</span>
            </div>
            <textarea className="mockup-dialog__text" readOnly value={prompt} rows={9} />
            <div className="mockup-dialog__row">
              <button type="button" className="mockup-dialog__btn mockup-dialog__btn--primary" onClick={() => copy(prompt, 'Prompt')}>
                <Copy size={14} /> Copy prompt
              </button>
            </div>
          </li>
          <li>
            <div className="mockup-dialog__step-head">
              <strong>3. Recipe</strong>
              <span>Included at the end of the prompt. Anyone can paste it into Create → Paste recipe to get this product with these settings.</span>
            </div>
            <div className="mockup-dialog__row">
              <button type="button" className="mockup-dialog__btn" onClick={() => copy(recipeJson(template, spec), 'Recipe')}>
                <Copy size={14} /> Copy recipe only
              </button>
            </div>
          </li>
        </ol>
      </div>
    </div>
  )
}
