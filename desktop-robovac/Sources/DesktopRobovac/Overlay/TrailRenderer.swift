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
            if let last = lastSamplePosition, hypot(pose.position.x - last.x, pose.position.y - last.y) < 4 {
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

    func draw(in context: GraphicsContext, now: TimeInterval) {
        guard style != .none, !samples.isEmpty else { return }
        let fade = max(0.1, fadeDuration)

        // Newest first with destination-over blending: where strokes overlap, the
        // newest wins instead of alphas stacking. Because later draws land
        // *behind* earlier ones, each layer is drawn top layer first.
        var layer = context
        layer.blendMode = .destinationOver

        for sample in samples.reversed() where sample.kind == .turn {
            let life = max(0, 1 - (now - sample.time) / fade)
            drawTurnMark(sample, alpha: opacity * 0.5 * wetness(life: life), in: layer)
        }

        // Split the drive samples into continuous runs, then into short sections
        // that each dry on their own schedule.
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

        struct Section {
            var path: Path
            var life: Double
        }
        var sections: [Section] = []
        for run in runs.reversed() {
            let sectionSize = 4
            var end = run.count - 1
            while end > 0 {
                let start = max(0, end - sectionSize)
                var path = Path()
                path.move(to: run[start].position)
                for index in (start + 1)...end {
                    path.addLine(to: run[index].position)
                }
                let life = max(0, 1 - (now - run[end].time) / fade)
                sections.append(Section(path: path, life: life))
                end = start
            }
        }
        guard !sections.isEmpty else { return }

        let baseWidth = robotSize * 0.6
        switch style {
        case .damp:
            let tint = Color(red: 0.70, green: 0.76, blue: 0.84)
            let highlight = Color(red: 0.93, green: 0.95, blue: 0.98)
            // Top: a thin soft gloss that disappears first.
            for section in sections {
                let g = gloss(life: section.life)
                guard g > 0.01 else { continue }
                layer.stroke(section.path, with: .color(highlight.opacity(opacity * 0.4 * g)),
                             style: StrokeStyle(lineWidth: baseWidth * 0.22, lineCap: .round, lineJoin: .round))
            }
            // Middle: the damp patch, shrinking slightly from the edges as it dries.
            for section in sections {
                let w = wetness(life: section.life)
                guard w > 0.01 else { continue }
                layer.stroke(section.path, with: .color(tint.opacity(opacity * 0.42 * w)),
                             style: StrokeStyle(lineWidth: baseWidth * (0.8 + 0.2 * w), lineCap: .round, lineJoin: .round))
            }
            // Bottom: a faint soft edge.
            for section in sections {
                let w = wetness(life: section.life)
                guard w > 0.01 else { continue }
                layer.stroke(section.path, with: .color(tint.opacity(opacity * 0.14 * w)),
                             style: StrokeStyle(lineWidth: baseWidth * (1.05 + 0.15 * w), lineCap: .round, lineJoin: .round))
            }
        case .sheen:
            for section in sections {
                let g = gloss(life: section.life)
                guard g > 0.01 else { continue }
                layer.stroke(section.path, with: .color(Color.white.opacity(opacity * 0.6 * g)),
                             style: StrokeStyle(lineWidth: baseWidth * 0.3, lineCap: .round, lineJoin: .round))
            }
            for section in sections {
                let w = wetness(life: section.life)
                guard w > 0.01 else { continue }
                layer.stroke(section.path, with: .color(Color.white.opacity(opacity * 0.25 * w)),
                             style: StrokeStyle(lineWidth: baseWidth, lineCap: .round, lineJoin: .round))
            }
        case .tireMarks:
            for section in sections {
                let w = wetness(life: section.life)
                guard w > 0.01 else { continue }
                layer.stroke(section.path, with: .color(Color.black.opacity(opacity * 0.6 * w)),
                             style: StrokeStyle(lineWidth: baseWidth * 1.2, lineCap: .butt, lineJoin: .round, dash: [3, 6]))
            }
        case .none:
            break
        }
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
