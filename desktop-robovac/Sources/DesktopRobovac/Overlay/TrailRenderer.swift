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
            if let last = lastSamplePosition, hypot(pose.position.x - last.x, pose.position.y - last.y) < 6 {
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

    /// One flat slice of the band between two consecutive samples.
    private struct Slice {
        var outline: Path
        var life: Double
        /// Centre line of the slice, used for the highlight streak and the edges.
        var from: CGPoint
        var to: CGPoint
        var normalFrom: CGPoint
        var normalTo: CGPoint
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

        // Build the slices as a strip: each sample gets one shared normal, so
        // neighbouring slices meet on exactly the same edge with no gap, no cap.
        var slices: [Slice] = []
        var corners: [(center: CGPoint, life: Double)] = []
        for run in runs.reversed() {
            let points = run.map { $0.position }
            var normals: [CGPoint] = []
            for i in 0..<points.count {
                let before = i > 0 ? TrailRenderer.direction(points[i - 1], points[i]) : TrailRenderer.direction(points[i], points[i + 1])
                let after = i < points.count - 1 ? TrailRenderer.direction(points[i], points[i + 1]) : before
                var sum = CGPoint(x: before.x + after.x, y: before.y + after.y)
                let length = hypot(sum.x, sum.y)
                if length < 0.001 { sum = after } else { sum = CGPoint(x: sum.x / length, y: sum.y / length) }
                // Perpendicular, scaled so the band keeps its width through the bend (mitre, clamped).
                let cosHalf = max(0.5, before.x * sum.x + before.y * sum.y)
                normals.append(CGPoint(x: -sum.y * half / cosHalf, y: sum.x * half / cosHalf))
                // Real corners (a pivot) get a round joint so the outside is smooth.
                let turn = before.x * after.x + before.y * after.y
                if i > 0, i < points.count - 1, turn < 0.94 {
                    let life = max(0, 1 - (now - run[i].time) / fade)
                    corners.append((points[i], life))
                }
            }
            for i in stride(from: points.count - 2, through: 0, by: -1) {
                let a = points[i], b = points[i + 1]
                let na = normals[i], nb = normals[i + 1]
                var outline = Path()
                outline.move(to: CGPoint(x: a.x + na.x, y: a.y + na.y))
                outline.addLine(to: CGPoint(x: b.x + nb.x, y: b.y + nb.y))
                outline.addLine(to: CGPoint(x: b.x - nb.x, y: b.y - nb.y))
                outline.addLine(to: CGPoint(x: a.x - na.x, y: a.y - na.y))
                outline.closeSubpath()
                let life = max(0, 1 - (now - run[i + 1].time) / fade)
                slices.append(Slice(outline: outline, life: life, from: a, to: b, normalFrom: na, normalTo: nb))
            }
        }

        switch style {
        case .damp:
            let tint = Color(red: 0.72, green: 0.77, blue: 0.84)
            let highlight = Color(red: 0.96, green: 0.97, blue: 0.99)
            // 1. Highlight streak: a soft strip offset to one side, the first thing to dry.
            for (streakOffset, streakWidth, strength) in [(0.26, 0.10, 0.5), (0.26, 0.22, 0.22)] {
                for slice in slices {
                    let g = gloss(life: slice.life)
                    guard g > 0.01 else { continue }
                    layer.fill(TrailRenderer.strip(slice, offset: streakOffset, width: streakWidth), with: .color(highlight.opacity(opacity * strength * g)))
                }
            }
            // 2. Crisp edges.
            for slice in slices {
                let w = wetness(life: slice.life)
                guard w > 0.01 else { continue }
                for edge in [TrailRenderer.strip(slice, offset: 0.98, width: 0.04), TrailRenderer.strip(slice, offset: -0.98, width: 0.04)] {
                    layer.fill(edge, with: .color(Color(red: 0.55, green: 0.6, blue: 0.68).opacity(opacity * 0.35 * w)))
                }
            }
            // 3. The damp band itself.
            for slice in slices {
                let w = wetness(life: slice.life)
                guard w > 0.01 else { continue }
                layer.fill(slice.outline, with: .color(tint.opacity(opacity * 0.46 * w)))
            }
            for corner in corners {
                let w = wetness(life: corner.life)
                guard w > 0.01 else { continue }
                layer.fill(Path(ellipseIn: CGRect(x: corner.center.x - half, y: corner.center.y - half, width: width, height: width)), with: .color(tint.opacity(opacity * 0.46 * w)))
            }
        case .sheen:
            for slice in slices {
                let g = gloss(life: slice.life)
                guard g > 0.01 else { continue }
                layer.fill(TrailRenderer.strip(slice, offset: 0, width: 0.3), with: .color(Color.white.opacity(opacity * 0.6 * g)))
            }
            for slice in slices {
                let w = wetness(life: slice.life)
                guard w > 0.01 else { continue }
                layer.fill(slice.outline, with: .color(Color.white.opacity(opacity * 0.25 * w)))
            }
        case .tireMarks:
            for slice in slices {
                let w = wetness(life: slice.life)
                guard w > 0.01 else { continue }
                for edge in [TrailRenderer.strip(slice, offset: 0.78, width: 0.12), TrailRenderer.strip(slice, offset: -0.78, width: 0.12)] {
                    layer.fill(edge, with: .color(Color.black.opacity(opacity * 0.6 * w)))
                }
            }
        case .none:
            break
        }
    }

    private static func direction(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
        let dx = b.x - a.x, dy = b.y - a.y
        let length = max(0.001, hypot(dx, dy))
        return CGPoint(x: dx / length, y: dy / length)
    }

    /// A sub-strip of a slice: `offset` and `width` are fractions of the half width
    /// (offset -1…1 across the band).
    private static func strip(_ slice: Slice, offset: CGFloat, width: CGFloat) -> Path {
        let lo = offset - width / 2, hi = offset + width / 2
        var path = Path()
        path.move(to: CGPoint(x: slice.from.x + slice.normalFrom.x * hi, y: slice.from.y + slice.normalFrom.y * hi))
        path.addLine(to: CGPoint(x: slice.to.x + slice.normalTo.x * hi, y: slice.to.y + slice.normalTo.y * hi))
        path.addLine(to: CGPoint(x: slice.to.x + slice.normalTo.x * lo, y: slice.to.y + slice.normalTo.y * lo))
        path.addLine(to: CGPoint(x: slice.from.x + slice.normalFrom.x * lo, y: slice.from.y + slice.normalFrom.y * lo))
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
