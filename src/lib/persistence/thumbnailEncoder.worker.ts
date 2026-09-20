/** Encodes a captured frame to WebP off the main thread: the editor keeps
 * responding while a 960×720 picture is compressed. */
export interface EncodeRequest {
  id: number
  bitmap: ImageBitmap
  quality: number
}

export type EncodeResponse = { id: number; ok: true; dataUrl: string } | { id: number; ok: false; error: string }

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  const { id, bitmap, quality } = event.data
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No 2D context in the worker')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const response: EncodeResponse = { id, ok: true, dataUrl: `data:${blob.type};base64,${btoa(binary)}` }
    self.postMessage(response)
  } catch (err) {
    const response: EncodeResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    self.postMessage(response)
  }
}
