import { zipSync, strToU8 } from 'fflate'
import type { ExportMesh } from './exportMeshes'
import type { PrintSettings } from '../../types/document'
import { BAMBU_GENERATOR, bambuProjectConfig, isBambuPrinter } from './bambuProject'

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
}

function normalizeColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  return m ? `#${m[1].toUpperCase()}` : '#4D8DFF'
}

/** Welds the flat triangle list back into a shared vertex table, which 3MF
 * requires (triangles reference vertex indices). */
function indexTriangles(positions: Float32Array) {
  const vertices: number[] = []
  const triangles: number[] = []
  const lookup = new Map<string, number>()
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`
    let idx = lookup.get(key)
    if (idx === undefined) {
      idx = vertices.length / 3
      lookup.set(key, idx)
      vertices.push(x, y, z)
    }
    triangles.push(idx)
  }
  return { vertices, triangles }
}

/**
 * Writes a 3MF (a zip) with one object per shape. Colors travel two ways:
 * - as core-spec <basematerials> on each object, which any 3MF consumer
 *   understands, and
 * - as Bambu Studio's own project metadata (Metadata/model_settings.config
 *   assigning each object an extruder, Metadata/project_settings.config
 *   listing the filament colours in that order), so opening the file in
 *   Bambu Studio lands each shape on a filament of its own color rather
 *   than everything on filament 1.
 */
/** Free-form key/value pairs written as <metadata> in the model file:
 * slicers show them, and Bambu Studio reads printer / plate hints. */
export type ThreeMfMetadata = Record<string, string | number | undefined>

export interface ThreeMfOptions {
  metadata?: ThreeMfMetadata
  /** Plate names, in order, for a multi-plate project; meshes carry their
   * 1-based plate number. Written as Bambu Studio plate blocks so the file
   * opens with the same plates. */
  plates?: string[]
  /** Written as a Bambu Studio project for this printer (bed preset id):
   * the file then opens with its plates, print settings and filaments
   * instead of as loose geometry. */
  bambu?: { bedPresetId: string; printSettings?: Partial<PrintSettings> }
}

export function write3mf(meshes: ExportMesh[], metadataOrOptions: ThreeMfMetadata | ThreeMfOptions = {}): Uint8Array<ArrayBuffer> {
  const options: ThreeMfOptions = 'metadata' in metadataOrOptions || 'plates' in metadataOrOptions ? (metadataOrOptions as ThreeMfOptions) : { metadata: metadataOrOptions as ThreeMfMetadata }
  const metadata = options.metadata ?? {}
  const plateNames = options.plates && options.plates.length > 1 ? options.plates : null
  const bambu = options.bambu && isBambuPrinter(options.bambu.bedPresetId) ? options.bambu : null
  const colors = [...new Set(meshes.map((m) => normalizeColor(m.color)))]

  const baseMaterials = colors
    .map((c, i) => `      <base name="${escapeXml(`Color ${i + 1}`)}" displaycolor="${c}FF" />`)
    .join('\n')

  const objects: string[] = []
  const buildItems: string[] = []
  const objectSettings: string[] = []
  meshes.forEach((mesh, i) => {
    const objectId = i + 2 // id 1 is the basematerials group
    const colorIndex = colors.indexOf(normalizeColor(mesh.color))
    const { vertices, triangles } = indexTriangles(mesh.positions)
    const vertexXml: string[] = []
    for (let v = 0; v < vertices.length; v += 3) {
      vertexXml.push(`          <vertex x="${vertices[v].toFixed(4)}" y="${vertices[v + 1].toFixed(4)}" z="${vertices[v + 2].toFixed(4)}" />`)
    }
    const triXml: string[] = []
    for (let t = 0; t < triangles.length; t += 3) {
      triXml.push(`          <triangle v1="${triangles[t]}" v2="${triangles[t + 1]}" v3="${triangles[t + 2]}" />`)
    }
    objects.push(
      `    <object id="${objectId}" name="${escapeXml(mesh.name)}" type="model" pid="1" pindex="${colorIndex}">\n` +
        `      <mesh>\n        <vertices>\n${vertexXml.join('\n')}\n        </vertices>\n` +
        `        <triangles>\n${triXml.join('\n')}\n        </triangles>\n      </mesh>\n    </object>`,
    )
    buildItems.push(`    <item objectid="${objectId}" />`)
    objectSettings.push(
      `  <object id="${objectId}">\n    <metadata key="name" value="${escapeXml(mesh.name)}"/>\n` +
        `    <metadata key="extruder" value="${colorIndex + 1}"/>\n  </object>`,
    )
  })

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">\n` +
    `  <metadata name="Application">${bambu ? BAMBU_GENERATOR : 'smartgrid'}</metadata>\n` +
    (bambu ? `  <metadata name="BambuStudio:3mfVersion">1</metadata>\n  <metadata name="Generator">smartgrid</metadata>\n` : '') +
    (plateNames ? `  <metadata name="PlateCount">${plateNames.length}</metadata>\n` : '') +
    Object.entries(metadata)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `  <metadata name="${escapeXml(k)}">${escapeXml(String(v))}</metadata>\n`)
      .join('') +
    `  <resources>\n    <basematerials id="1">\n${baseMaterials}\n    </basematerials>\n${objects.join('\n')}\n  </resources>\n` +
    `  <build>\n${buildItems.join('\n')}\n  </build>\n</model>\n`

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
    `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />\n` +
    `  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />\n` +
    `  <Default Extension="config" ContentType="text/xml" />\n</Types>\n`

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />\n` +
    `</Relationships>\n`

  const plateBlocks = plateNames
    ? plateNames.map((name, i) => {
        const instances = meshes
          .map((m, mi) => ({ m, objectId: mi + 2 }))
          .filter(({ m }) => (m.plate ?? 1) === i + 1)
          .map(({ objectId }) => `    <model_instance>\n      <metadata key="object_id" value="${objectId}"/>\n      <metadata key="instance_id" value="0"/>\n    </model_instance>`)
        return (
          `  <plate>\n    <metadata key="plater_id" value="${i + 1}"/>\n    <metadata key="plater_name" value="${escapeXml(name)}"/>\n` +
          `    <metadata key="locked" value="false"/>\n${instances.join('\n')}${instances.length ? '\n' : ''}  </plate>`
        )
      })
    : []
  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${[...objectSettings, ...plateBlocks].join('\n')}\n</config>\n`
  const projectSettings = JSON.stringify(
    bambu
      ? bambuProjectConfig(bambu.bedPresetId, bambu.printSettings ?? {}, colors)
      : {
          filament_colour: colors,
          filament_type: colors.map(() => 'PLA'),
        },
    null,
    2,
  )

  const zipped = zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/model_settings.config': strToU8(modelSettings),
      'Metadata/project_settings.config': strToU8(projectSettings),
    },
    { level: 6 },
  )
  // Copy into a plain ArrayBuffer-backed view so it satisfies BlobPart typing.
  return new Uint8Array(zipped)
}
