import type { ExportMesh } from './exportMeshes'

/** Binary STL: 80-byte header, uint32 triangle count, then 50 bytes per
 * triangle (normal, 3 vertices, uint16 attribute). Colors can't survive
 * STL — that's what the 3MF export is for. */
export function writeBinaryStl(meshes: ExportMesh[]): ArrayBuffer {
  const triCount = meshes.reduce((n, m) => n + m.positions.length / 9, 0)
  const buffer = new ArrayBuffer(84 + triCount * 50)
  const view = new DataView(buffer)
  const header = 'smartgrid binary STL'
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i))
  view.setUint32(80, triCount, true)

  let offset = 84
  for (const mesh of meshes) {
    const p = mesh.positions
    for (let i = 0; i < p.length; i += 9) {
      const ax = p[i], ay = p[i + 1], az = p[i + 2]
      const bx = p[i + 3], by = p[i + 4], bz = p[i + 5]
      const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8]
      const ux = bx - ax, uy = by - ay, uz = bz - az
      const vx = cx - ax, vy = cy - ay, vz = cz - az
      let nx = uy * vz - uz * vy
      let ny = uz * vx - ux * vz
      let nz = ux * vy - uy * vx
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      const values = [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]
      for (const v of values) {
        view.setFloat32(offset, v, true)
        offset += 4
      }
      view.setUint16(offset, 0, true)
      offset += 2
    }
  }
  return buffer
}
