import SwiftUI
import RobovacCore

/// Transient surface effects behind the robot. The damp style is a continuous
/// wet-mop ribbon: a smooth band with a glossy sheen, soft edges and droplets
/// scattered along its sides, fading away after the configured time.
final class TrailRenderer {
    struct Sample {
        enum Kind {
            case drive
            case turn
            case droplet(size: CGFloat, side: CGFloat)
        }
        var position: CGPoint
        var heading: CGFloat
        var time: TimeInterval
        var kind: Kind
    }

    var style: TrailStyle = .damp
    var opacity: Double = 0.35
    var fadeDuration: TimeInterval = 3.5
    var robotSize: CGFloat = 64
    var enabled = true

    private(set) var samples: [Sample] = []
    private var lastSamplePosition: CGPoint?
    private var lastTurnSampleTime: TimeInterval = 0
    private var distanceSinceDroplet: CGFloat = 0
    private var random = SplitMix64(seed: 0xD20B)

    func reset() {
        samples.removeAll()
        lastSamplePosition = nil
        distanceSinceDroplet = 0
    }

    func record(pose: RobotPose, now: TimeInterval) {
        prune(now: now)
        guard enabled, style != .none, pose.isVisible else { return }

        switch pose.state {
        case .driving, .approaching, .avoiding, .returning, .deploying:
            let moved = lastSamplePosition.map { hypot(pose.position.x - $0.x, pose.position.y - $0.y) } ?? .greatestFiniteMagnitude
            if moved < 5 { return }
            samples.append(Sample(position: pose.position, heading: pose.heading, time: now, kind: .drive))
            lastSamplePosition = pose.position

            if style == .damp, moved.isFinite {
                distanceSinceDroplet += moved
                if distanceSinceDroplet > 28 {
                    distanceSinceDroplet = 0
                    let count = random.nextUnit() < 0.35 ? 2 : 1
                    for _ in 0..<count {
                        let side: CGFloat = random.nextUnit() < 0.5 ? -1 : 1
                        let offset = robotSize * (0.42 + CGFloat(random.nextUnit()) * 0.35)
                        let back = CGFloat(random.nextUnit()) * robotSize * 0.4
                        let nx = -sin(pose.heading)
                        let ny = cos(pose.heading)
                        let position = CGPoint(
                            x: pose.position.x + nx * side * offset - cos(pose.heading) * back,
                            y: pose.position.y + ny * side * offset - sin(pose.heading) * back
                        )
                        let size = 2 + CGFloat(random.nextUnit() * random.nextUnit()) * robotSize * 0.14
                        samples.append(Sample(position: position, heading: pose.heading, time: now, kind: .droplet(size: size, side: side)))
                    }
                }
            }
        case .turning:
            if now - lastTurnSampleTime > 0.08 {
                samples.append(Sample(position: pose.position, heading: pose.heading, time: now, kind: .turn))
                lastTurnSampleTime = now
            }
        default:
            // Break the ribbon so the next drive starts a fresh one.
            lastSamplePosition = nil
        }
    }

    private func prune(now: TimeInterval) {
        guard !samples.isEmpty else { return }
        let cutoff = now - fadeDuration
        samples.removeAll { $0.time < cutoff }
    }

    // MARK: Drawing

    func draw(in context: GraphicsContext, now: TimeInterval) {
        guard style != .none, !samples.isEmpty else { return }
        let fade = max(0.1, fadeDuration)

        // Newest first with destination-over blending: where strokes overlap, the
        // newest wins instead of alphas stacking into dark blobs. Because later
        // draws land *behind* earlier ones, each element is drawn top layer first.
        var layer = context
        layer.blendMode = .destinationOver

        // Droplets and turn marks sit on top of the band.
        for sample in samples.reversed() {
            let life = max(0, 1 - (now - sample.time) / fade)
            let alpha = opacity * fadeCurve(life)
            switch sample.kind {
            case .droplet(let size, _):
                drawDroplet(at: sample.position, size: size, alpha: alpha, in: layer)
            case .turn:
                drawTurnMark(sample, alpha: alpha, in: layer)
            case .drive:
                break
            }
        }

        // The band, as smooth runs split into short chunks so each chunk can fade.
        var run: [Sample] = []
        var runs: [[Sample]] = []
        var previous: Sample?
        for sample in samples {
            guard case .drive = sample.kind else { continue }
            if let previous, hypot(sample.position.x - previous.position.x, sample.position.y - previous.position.y) > robotSize * 1.5 {
                if run.count > 1 { runs.append(run) }
                run = []
            }
            run.append(sample)
            previous = sample
        }
        if run.count > 1 { runs.append(run) }

        for run in runs.reversed() {
            let chunkSize = 5
            var end = run.count - 1
            while end > 0 {
                let start = max(0, end - chunkSize)
                // One sample of overlap on each side keeps the curve continuous.
                let slice = Array(run[max(0, start - 1)...min(run.count - 1, end + 1)])
                let newest = run[end].time
                let life = max(0, 1 - (now - newest) / fade)
                let alpha = opacity * fadeCurve(life)
                let path = TrailRenderer.smoothPath(through: slice.map { $0.position })
                drawBand(path, alpha: alpha, in: layer)
                end = start
            }
        }
    }

    /// Holds at full strength for the first third, then fades out.
    private func fadeCurve(_ life: Double) -> Double {
        min(1, life * 1.5)
    }

    private func drawBand(_ path: Path, alpha: Double, in layer: GraphicsContext) {
        let width = robotSize * 0.92
        switch style {
        case .damp:
            // Top to bottom: sheen highlight, bright core, wide soft band.
            layer.stroke(path, with: .color(Color.white.opacity(alpha * 0.55)), style: StrokeStyle(lineWidth: width * 0.16, lineCap: .round, lineJoin: .round))
            layer.stroke(path, with: .color(Color(red: 0.8, green: 0.9, blue: 1.0).opacity(alpha * 0.75)), style: StrokeStyle(lineWidth: width * 0.62, lineCap: .round, lineJoin: .round))
            layer.stroke(path, with: .color(Color(red: 0.6, green: 0.78, blue: 1.0).opacity(alpha * 0.6)), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
            layer.stroke(path, with: .color(Color(red: 0.55, green: 0.74, blue: 1.0).opacity(alpha * 0.25)), style: StrokeStyle(lineWidth: width * 1.18, lineCap: .round, lineJoin: .round))
        case .sheen:
            layer.stroke(path, with: .color(Color.white.opacity(alpha * 0.9)), style: StrokeStyle(lineWidth: width * 0.2, lineCap: .round, lineJoin: .round))
            layer.stroke(path, with: .color(Color.white.opacity(alpha * 0.35)), style: StrokeStyle(lineWidth: width * 0.7, lineCap: .round, lineJoin: .round))
        case .tireMarks:
            // Two parallel tracks; approximated by stroking the centre path twice with a dashed pattern.
            layer.stroke(path, with: .color(Color.black.opacity(alpha * 0.75)), style: StrokeStyle(lineWidth: width, lineCap: .butt, lineJoin: .round, dash: [3, 6]))
        case .none:
            break
        }
    }

    private func drawDroplet(at point: CGPoint, size: CGFloat, alpha: Double, in layer: GraphicsContext) {
        guard style == .damp else { return }
        let rect = CGRect(x: point.x - size / 2, y: point.y - size * 0.4, width: size, height: size * 0.8)
        // Highlight first (it ends up on top), then the body.
        layer.fill(Path(ellipseIn: CGRect(x: rect.minX + size * 0.18, y: rect.minY + size * 0.12, width: size * 0.3, height: size * 0.22)), with: .color(Color.white.opacity(alpha * 0.9)))
        layer.fill(Path(ellipseIn: rect), with: .color(Color(red: 0.7, green: 0.85, blue: 1.0).opacity(alpha * 0.85)))
        layer.stroke(Path(ellipseIn: rect), with: .color(Color(red: 0.45, green: 0.65, blue: 0.95).opacity(alpha * 0.5)), lineWidth: 0.8)
    }

    private func drawTurnMark(_ sample: Sample, alpha: Double, in layer: GraphicsContext) {
        let offset = robotSize * 0.34
        let color: Color = style == .tireMarks ? .black : Color(red: 0.6, green: 0.78, blue: 1.0)
        for side: CGFloat in [-1, 1] {
            let nx = -sin(sample.heading) * side * offset
            let ny = cos(sample.heading) * side * offset
            let center = CGPoint(x: sample.position.x + nx, y: sample.position.y + ny)
            var path = Path()
            path.addArc(
                center: center,
                radius: robotSize * 0.1,
                startAngle: Angle(radians: Double(sample.heading) - 0.9),
                endAngle: Angle(radians: Double(sample.heading) + 0.9),
                clockwise: false
            )
            layer.stroke(path, with: .color(color.opacity(alpha * 0.6)), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
        }
    }

    /// Catmull-Rom spline through the points, as cubic Béziers.
    static func smoothPath(through points: [CGPoint]) -> Path {
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: first)
        guard points.count > 1 else { return path }
        if points.count == 2 {
            path.addLine(to: points[1])
            return path
        }
        for i in 0..<(points.count - 1) {
            let p0 = i > 0 ? points[i - 1] : points[i]
            let p1 = points[i]
            let p2 = points[i + 1]
            let p3 = i + 2 < points.count ? points[i + 2] : points[i + 1]
            let c1 = CGPoint(x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6)
            let c2 = CGPoint(x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6)
            path.addCurve(to: p2, control1: c1, control2: c2)
        }
        return path
    }
}
