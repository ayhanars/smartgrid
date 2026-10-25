import SwiftUI
import RobovacCore

/// Transient surface effects behind the robot. The damp style is a narrow,
/// slightly glossy footprint left on a smooth floor: it follows the robot's
/// exact path (straight runs, rounded corners) and dries section by section,
/// losing its gloss first and then its opacity until nothing is left.
final class TrailRenderer {
    struct Sample {
        enum Kind { case drive, turn }
        var position: CGPoint
        var heading: CGFloat
        var time: TimeInterval
        var kind: Kind
    }

    var style: TrailStyle = .damp
    var opacity: Double = 0.4
    var fadeDuration: TimeInterval = 4.5
    var robotSize: CGFloat = 64
    var enabled = true

    private(set) var samples: [Sample] = []
    private var lastSamplePosition: CGPoint?
    private var lastTurnSampleTime: TimeInterval = 0

    func reset() {
        samples.removeAll()
        lastSamplePosition = nil
    }

    func record(pose: RobotPose, now: TimeInterval) {
        prune(now: now)
        guard enabled, style != .none, pose.isVisible else { return }

        switch pose.state {
        case .driving, .approaching, .avoiding, .returning, .deploying:
            if let last = lastSamplePosition, hypot(pose.position.x - last.x, pose.position.y - last.y) < 8 {
                return
            }
            samples.append(Sample(position: pose.position, heading: pose.heading, time: now, kind: .drive))
            lastSamplePosition = pose.position
        case .turning:
            if now - lastTurnSampleTime > 0.08 {
                samples.append(Sample(position: pose.position, heading: pose.heading, time: now, kind: .turn))
                lastTurnSampleTime = now
            }
        default:
            // Break the footprint so the next drive starts a fresh one.
            lastSamplePosition = nil
        }
    }

    /// Smallest rectangle covering everything the trail could draw right now, or
    /// nil when there is nothing to draw. Used to size the trail's own view.
    func liveBounds() -> CGRect? {
        guard enabled, style != .none, !samples.isEmpty else { return nil }
        var minX = CGFloat.greatestFiniteMagnitude, minY = CGFloat.greatestFiniteMagnitude
        var maxX = -CGFloat.greatestFiniteMagnitude, maxY = -CGFloat.greatestFiniteMagnitude
        for sample in samples {
            minX = min(minX, sample.position.x); maxX = max(maxX, sample.position.x)
            minY = min(minY, sample.position.y); maxY = max(maxY, sample.position.y)
        }
        let margin = robotSize * 0.8
        return CGRect(x: minX - margin, y: minY - margin, width: maxX - minX + margin * 2, height: maxY - minY + margin * 2)
    }

    private func prune(now: TimeInterval) {
        guard !samples.isEmpty else { return }
        let cutoff = now - fadeDuration
        samples.removeAll { $0.time < cutoff }
    }

    // MARK: Drying

    /// How much of the wet look is left: 1 fresh, 0 dry.
    private func wetness(life: Double) -> Double {
        // Holds briefly behind the robot, then dries evenly.
        let eased = min(1, life * 1.12)
        return eased * eased * (3 - 2 * eased)
    }

    /// Gloss dries off well before the damp patch itself disappears.
    private func gloss(life: Double) -> Double {
        let g = max(0, (life - 0.4) / 0.6)
        return g * g
    }

    // MARK: Drawing

    /// One flat slice of the band between two consecutive samples. The band may
    /// be a little wider on one side than the other (mop wetness is never even),
    /// so each end carries a separate vector for its left and right edge.
    private struct Slice {
        var life: Double
        var from: CGPoint
        var to: CGPoint
        var plusFrom: CGPoint
        var minusFrom: CGPoint
        var plusTo: CGPoint
        var minusTo: CGPoint
        /// Arc length at the start, for lengthwise texture.
        var distance: CGFloat
    }

    /// A pivot: the mop pad swept a wedge of the floor while the robot turned in place.
    private struct Corner {
        var center: CGPoint
        var life: Double
        /// Angle of the outer edge where the incoming slice ends.
        var startAngle: CGFloat
        /// Signed sweep to the outer edge where the outgoing slice starts.
        var sweep: CGFloat
        /// +1 when the outer side is the "plus" side of the band.
        var outerSign: CGFloat
    }

    func draw(in context: GraphicsContext, now: TimeInterval) {
        guard style != .none, !samples.isEmpty else { return }
        let fade = max(0.1, fadeDuration)

        // Newest first with destination-over blending: where shapes overlap, the
        // newest wins instead of alphas stacking. Because later draws land
        // *behind* earlier ones, each layer is drawn top layer first.
        var layer = context
        layer.blendMode = .destinationOver

        if style == .tireMarks {
            for sample in samples.reversed() where sample.kind == .turn {
                let life = max(0, 1 - (now - sample.time) / fade)
                drawTurnMark(sample, alpha: opacity * 0.5 * wetness(life: life), in: layer)
            }
        }

        // Continuous runs of drive samples.
        var runs: [[Sample]] = []
        var run: [Sample] = []
        var previous: Sample?
        for sample in samples where sample.kind == .drive {
            if let previous, hypot(sample.position.x - previous.position.x, sample.position.y - previous.position.y) > robotSize * 1.5 {
                if run.count > 1 { runs.append(run) }
                run = []
            }
            run.append(sample)
            previous = sample
        }
        if run.count > 1 { runs.append(run) }
        guard !runs.isEmpty else { return }

        let width = robotSize * 0.88
        let half = width / 2

        var slices: [Slice] = []
        var corners: [Corner] = []
        for run in runs.reversed() {
            let points = run.map { $0.position }
            let count = points.count
            var directionsIn: [CGPoint] = []   // direction arriving at point i
            var directionsOut: [CGPoint] = []  // direction leaving point i
            var distances: [CGFloat] = [0]
            for i in 0..<count {
                let before = i > 0 ? TrailRenderer.direction(points[i - 1], points[i]) : TrailRenderer.direction(points[i], points[i + 1])
                let after = i < count - 1 ? TrailRenderer.direction(points[i], points[i + 1]) : before
                directionsIn.append(before)
                directionsOut.append(after)
                if i > 0 { distances.append(distances[i - 1] + hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)) }
            }
            // A real pivot: the heading changes by more than ~20° at this sample.
            var isCorner = [Bool](repeating: false, count: count)
            for i in 1..<(count - 1) where directionsIn[i].x * directionsOut[i].x + directionsIn[i].y * directionsOut[i].y < 0.94 {
                isCorner[i] = true
                let before = directionsIn[i], after = directionsOut[i]
                let cross = before.x * after.y - before.y * after.x
                let dot = before.x * after.x + before.y * after.y
                let turn = atan2(cross, dot)
                // Outer side is opposite to the direction of the turn.
                let outerSign: CGFloat = cross > 0 ? -1 : 1
                let outerIn = CGPoint(x: -before.y * outerSign, y: before.x * outerSign)
                corners.append(Corner(
                    center: points[i],
                    life: max(0, 1 - (now - run[i].time) / fade),
                    startAngle: atan2(outerIn.y, outerIn.x),
                    sweep: turn,
                    outerSign: outerSign
                ))
            }

            // Edge vectors per sample: at a pivot the slice ends square to its own
            // direction (the wedge fills the corner); elsewhere a clamped mitre
            // keeps the width through gentle steering.
            func edges(at i: Int, using direction: CGPoint) -> (plus: CGPoint, minus: CGPoint) {
                let s = distances[i]
                let wobblePlus = 1 + 0.045 * sin(s * 0.041 + 1.3) + 0.025 * sin(s * 0.097 + 0.4)
                let wobbleMinus = 1 + 0.045 * sin(s * 0.037 + 4.1) + 0.025 * sin(s * 0.089 + 2.2)
                let n = CGPoint(x: -direction.y * half, y: direction.x * half)
                return (CGPoint(x: n.x * wobblePlus, y: n.y * wobblePlus), CGPoint(x: -n.x * wobbleMinus, y: -n.y * wobbleMinus))
            }
            func mitreDirection(at i: Int) -> CGPoint {
                let sum = CGPoint(x: directionsIn[i].x + directionsOut[i].x, y: directionsIn[i].y + directionsOut[i].y)
                let length = hypot(sum.x, sum.y)
                guard length > 0.001 else { return directionsOut[i] }
                let unit = CGPoint(x: sum.x / length, y: sum.y / length)
                let cosHalf = max(0.7, directionsIn[i].x * unit.x + directionsIn[i].y * unit.y)
                return CGPoint(x: unit.x / cosHalf, y: unit.y / cosHalf)
            }

            for i in stride(from: count - 2, through: 0, by: -1) {
                let dir = TrailRenderer.direction(points[i], points[i + 1])
                let start = isCorner[i] ? edges(at: i, using: dir) : edges(at: i, using: mitreDirection(at: i))
                let finish = isCorner[i + 1] ? edges(at: i + 1, using: dir) : edges(at: i + 1, using: mitreDirection(at: i + 1))
                slices.append(Slice(
                    life: max(0, 1 - (now - run[i + 1].time) / fade),
                    from: points[i], to: points[i + 1],
                    plusFrom: start.plus, minusFrom: start.minus,
                    plusTo: finish.plus, minusTo: finish.minus,
                    distance: distances[i]
                ))
            }
        }

        switch style {
        case .damp:
            let tint = Color(red: 0.72, green: 0.77, blue: 0.84)
            let highlight = Color(red: 0.96, green: 0.97, blue: 0.99)
            let edgeColor = Color(red: 0.55, green: 0.6, blue: 0.68)

            // 1. Highlight streak, offset to one side; its brightness breathes a
            //    little along the length so it does not read as a ruled line.
            for (offset, streakWidth, strength) in [(0.28, 0.10, 0.5), (0.28, 0.24, 0.2)] {
                TrailRenderer.fillBatched(slices.map { slice in
                    let breathe = 0.75 + 0.25 * sin(slice.distance * 0.03 + 0.9)
                    return (TrailRenderer.strip(slice, offset: offset, width: streakWidth), opacity * strength * gloss(life: slice.life) * breathe)
                }, color: highlight, in: layer)
                TrailRenderer.fillBatched(corners.filter { $0.outerSign > 0 }.map { corner in
                    (TrailRenderer.sector(corner, inner: half * (offset - streakWidth / 2), outer: half * (offset + streakWidth / 2)), opacity * strength * gloss(life: corner.life) * 0.85)
                }, color: highlight, in: layer)
            }
            // 2. Faint lengthwise mop streaks inside the band.
            for (offset, streakWidth, phase) in [(-0.55, 0.07, 0.0), (-0.12, 0.05, 2.1), (0.62, 0.08, 4.0)] {
                TrailRenderer.fillBatched(slices.map { slice in
                    let presence = max(0, sin(slice.distance * 0.02 + phase))
                    return (TrailRenderer.strip(slice, offset: offset, width: streakWidth), opacity * 0.12 * wetness(life: slice.life) * (presence > 0.05 ? presence : 0))
                }, color: highlight, in: layer)
            }
            // 3. Crisp edges, following the slightly uneven outline.
            for edgeOffset: CGFloat in [0.98, -0.98] {
                TrailRenderer.fillBatched(slices.map { slice in
                    (TrailRenderer.strip(slice, offset: edgeOffset, width: 0.04), opacity * 0.35 * wetness(life: slice.life))
                }, color: edgeColor, in: layer)
            }
            TrailRenderer.fillBatched(corners.map { corner in
                (TrailRenderer.sector(corner, inner: half * 0.96, outer: half), opacity * 0.35 * wetness(life: corner.life))
            }, color: edgeColor, in: layer)
            // 4. The damp band and the wedges that round each pivot.
            TrailRenderer.fillBatched(slices.map { slice in
                (TrailRenderer.outline(slice), opacity * 0.46 * wetness(life: slice.life))
            }, color: tint, in: layer)
            TrailRenderer.fillBatched(corners.map { corner in
                (TrailRenderer.sector(corner, inner: 0, outer: half), opacity * 0.46 * wetness(life: corner.life))
            }, color: tint, in: layer)
        case .sheen:
            TrailRenderer.fillBatched(slices.map { slice in
                (TrailRenderer.strip(slice, offset: 0, width: 0.3), opacity * 0.6 * gloss(life: slice.life))
            }, color: .white, in: layer)
            TrailRenderer.fillBatched(slices.map { slice in
                (TrailRenderer.outline(slice), opacity * 0.25 * wetness(life: slice.life))
            }, color: .white, in: layer)
            TrailRenderer.fillBatched(corners.map { corner in
                (TrailRenderer.sector(corner, inner: 0, outer: half), opacity * 0.25 * wetness(life: corner.life))
            }, color: .white, in: layer)
        case .tireMarks:
            for edgeOffset: CGFloat in [0.78, -0.78] {
                TrailRenderer.fillBatched(slices.map { slice in
                    (TrailRenderer.strip(slice, offset: edgeOffset, width: 0.12), opacity * 0.6 * wetness(life: slice.life))
                }, color: .black, in: layer)
            }
        case .none:
            break
        }
    }

    /// Fills many shapes of one colour in a few draws instead of one per shape:
    /// the shapes are bucketed by alpha, merged into one path per bucket and the
    /// buckets are drawn strongest (newest) first, which keeps the
    /// destination-over layering intact. Shapes in a batch must share winding so
    /// the merged non-zero fill never punches holes where they overlap.
    private static func fillBatched(_ shapes: [(Path, Double)], color: Color, in layer: GraphicsContext) {
        let peak = shapes.reduce(0.0) { max($0, $1.1) }
        guard peak > 0.004 else { return }
        let levels = 32
        var buckets = [Path?](repeating: nil, count: levels + 1)
        for (path, alpha) in shapes where alpha > 0.004 {
            let index = max(1, min(levels, Int((alpha / peak * Double(levels)).rounded())))
            if buckets[index] == nil { buckets[index] = Path() }
            buckets[index]?.addPath(path)
        }
        for index in stride(from: levels, through: 1, by: -1) {
            guard let path = buckets[index] else { continue }
            layer.fill(path, with: .color(color.opacity(peak * Double(index) / Double(levels))))
        }
    }

    private static func direction(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
        let dx = b.x - a.x, dy = b.y - a.y
        let length = max(0.001, hypot(dx, dy))
        return CGPoint(x: dx / length, y: dy / length)
    }

    /// Point across the band at `offset` (-1…1) from the centre line.
    private static func across(_ p: CGPoint, plus: CGPoint, minus: CGPoint, offset: CGFloat) -> CGPoint {
        if offset >= 0 {
            return CGPoint(x: p.x + plus.x * offset, y: p.y + plus.y * offset)
        }
        return CGPoint(x: p.x + minus.x * -offset, y: p.y + minus.y * -offset)
    }

    private static func outline(_ slice: Slice) -> Path {
        strip(slice, offset: 0, width: 2)
    }

    /// A sub-strip of a slice: `offset` and `width` are fractions of the half width.
    private static func strip(_ slice: Slice, offset: CGFloat, width: CGFloat) -> Path {
        let lo = offset - width / 2, hi = offset + width / 2
        var path = Path()
        path.move(to: across(slice.from, plus: slice.plusFrom, minus: slice.minusFrom, offset: hi))
        path.addLine(to: across(slice.to, plus: slice.plusTo, minus: slice.minusTo, offset: hi))
        path.addLine(to: across(slice.to, plus: slice.plusTo, minus: slice.minusTo, offset: lo))
        path.addLine(to: across(slice.from, plus: slice.plusFrom, minus: slice.minusFrom, offset: lo))
        path.closeSubpath()
        return path
    }

    /// Annular sector on the outer side of a pivot, built from straight segments
    /// so the sweep direction is unambiguous. `inner` of 0 gives a pie wedge.
    private static func sector(_ corner: Corner, inner: CGFloat, outer: CGFloat) -> Path {
        let steps = max(3, Int((abs(corner.sweep) / 0.2).rounded(.up)))
        var path = Path()
        func point(_ radius: CGFloat, _ step: Int) -> CGPoint {
            let angle = corner.startAngle + corner.sweep * CGFloat(step) / CGFloat(steps)
            return CGPoint(x: corner.center.x + cos(angle) * radius, y: corner.center.y + sin(angle) * radius)
        }
        var points: [CGPoint] = [point(outer, 0)]
        for step in 1...steps { points.append(point(outer, step)) }
        if inner <= 0.5 {
            points.append(corner.center)
        } else {
            for step in stride(from: steps, through: 0, by: -1) { points.append(point(inner, step)) }
        }
        // Same winding whichever way the robot turned, so merged fills never cancel.
        if corner.sweep < 0 { points.reverse() }
        path.move(to: points[0])
        for p in points.dropFirst() { path.addLine(to: p) }
        path.closeSubpath()
        return path
    }

    private func drawTurnMark(_ sample: Sample, alpha: Double, in layer: GraphicsContext) {
        let offset = robotSize * 0.3
        let color: Color = style == .tireMarks ? .black : Color(red: 0.70, green: 0.76, blue: 0.84)
        for side: CGFloat in [-1, 1] {
            let nx = -sin(sample.heading) * side * offset
            let ny = cos(sample.heading) * side * offset
            let center = CGPoint(x: sample.position.x + nx, y: sample.position.y + ny)
            var path = Path()
            path.addArc(
                center: center,
                radius: robotSize * 0.08,
                startAngle: Angle(radians: Double(sample.heading) - 0.8),
                endAngle: Angle(radians: Double(sample.heading) + 0.8),
                clockwise: false
            )
            layer.stroke(path, with: .color(color.opacity(alpha)), style: StrokeStyle(lineWidth: 2, lineCap: .round))
        }
    }
}
