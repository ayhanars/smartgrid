declare module 'poly-decomp' {
  type Point = [number, number]
  const decomp: {
    makeCCW(polygon: Point[]): boolean
    isSimple(polygon: Point[]): boolean
    removeCollinearPoints(polygon: Point[], thresholdAngle?: number): number
    removeDuplicatePoints(polygon: Point[], precision?: number): void
    quickDecomp(polygon: Point[]): Point[][]
    decomp(polygon: Point[]): Point[][] | false
  }
  export default decomp
}
