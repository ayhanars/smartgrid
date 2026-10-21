import SwiftUI
import RobovacCore

/// Transient surface effects behind the robot: damp trails, sheen, tire marks
/// and turning marks. Samples expire after the configured fade duration, so
/// nothing accumulates on screen.
final class TrailRenderer {
    struct Sample {
        enum Kind { case drive, turn }
        var position: CGPoint
        var heading: CGFloat
        var time: TimeInterval
        var kind: Kind
    }

    var style: TrailStyle = .damp
    var opacity: Double = 0.35
    var fadeDuration: TimeInterval = 2.5
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
            // Break the stroke so the next drive segment starts fresh.
            lastSamplePosition = nil
        }
    }

    private func prune(now: TimeInterval) {
        guard !samples.isEmpty else { return }
        let cutoff = now - fadeDuration
        samples.removeAll { $0.time < cutoff }
    }

    func draw(in context: GraphicsContext, now: TimeInterval) {
        guard style != .none, !samples.isEmpty else { return }
        let fade = max(0.1, fadeDuration)

        var previous: Sample?
        for sample in samples {
            let age = now - sample.time
            let life = max(0, 1 - age / fade)
            let alpha = opacity * life

            switch sample.kind {
            case .turn:
                drawTurnMark(sample, alpha: alpha, in: context)
                previous = nil
            case .drive:
                if let previous, previous.kind == .drive, hypot(sample.position.x - previous.position.x, sample.position.y - previous.position.y) < robotSize * 1.5 {
                    drawSegment(from: previous, to: sample, alpha: alpha, in: context)
                }
                previous = sample
            }
        }
    }

    private func drawSegment(from a: Sample, to b: Sample, alpha: Double, in context: GraphicsContext) {
        switch style {
        case .damp:
            var path = Path()
            path.move(to: a.position)
            path.addLine(to: b.position)
            context.stroke(
                path,
                with: .color(Color(red: 0.55, green: 0.75, blue: 1.0).opacity(alpha)),
                style: StrokeStyle(lineWidth: robotSize * 0.78, lineCap: .round)
            )
        case .sheen:
            var path = Path()
            path.move(to: a.position)
            path.addLine(to: b.position)
            var glow = context
            glow.addFilter(.blur(radius: robotSize * 0.18))
            glow.stroke(path, with: .color(Color.white.opacity(alpha * 0.9)), style: StrokeStyle(lineWidth: robotSize * 0.6, lineCap: .round))
            context.stroke(path, with: .color(Color.white.opacity(alpha * 0.35)), style: StrokeStyle(lineWidth: robotSize * 0.2, lineCap: .round))
        case .tireMarks:
            let offset = robotSize * 0.34
            for side: CGFloat in [-1, 1] {
                var path = Path()
                path.move(to: wheelPoint(a, side: side, offset: offset))
                path.addLine(to: wheelPoint(b, side: side, offset: offset))
                context.stroke(
                    path,
                    with: .color(Color.black.opacity(alpha * 0.8)),
                    style: StrokeStyle(lineWidth: max(2, robotSize * 0.07), lineCap: .round)
                )
            }
        case .none:
            break
        }
    }

    private func drawTurnMark(_ sample: Sample, alpha: Double, in context: GraphicsContext) {
        let offset = robotSize * 0.34
        let color: Color = style == .tireMarks ? .black : Color(red: 0.55, green: 0.75, blue: 1.0)
        let strength = style == .tireMarks ? 0.7 : 0.5
        for side: CGFloat in [-1, 1] {
            let center = wheelPoint(sample, side: side, offset: offset)
            var path = Path()
            path.addArc(
                center: center,
                radius: robotSize * 0.09,
                startAngle: Angle(radians: Double(sample.heading) - 0.9),
                endAngle: Angle(radians: Double(sample.heading) + 0.9),
                clockwise: false
            )
            context.stroke(path, with: .color(color.opacity(alpha * strength)), style: StrokeStyle(lineWidth: 2, lineCap: .round))
        }
    }

    private func wheelPoint(_ sample: Sample, side: CGFloat, offset: CGFloat) -> CGPoint {
        let nx = -sin(sample.heading) * side * offset
        let ny = cos(sample.heading) * side * offset
        return CGPoint(x: sample.position.x + nx, y: sample.position.y + ny)
    }
}
