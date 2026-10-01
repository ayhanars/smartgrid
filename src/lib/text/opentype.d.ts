declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'Q' | 'C' | 'Z'
    x?: number
    y?: number
    x1?: number
    y1?: number
    x2?: number
    y2?: number
  }
  export interface Path {
    commands: PathCommand[]
  }
  export interface Glyph {
    name: string
    index: number
    advanceWidth?: number
    getPath(x: number, y: number, fontSize: number): Path
  }
  export interface Font {
    unitsPerEm: number
    tables: { os2?: { sCapHeight?: number } }
    charToGlyph(ch: string): Glyph
    getKerningValue(left: Glyph, right: Glyph): number
  }
  export function parse(buffer: ArrayBuffer): Font
}
