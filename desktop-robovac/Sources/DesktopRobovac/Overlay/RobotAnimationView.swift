import SwiftUI

/// Draws trail, particles and the robot in a single Canvas.
struct RobotAnimationView: View {
    @ObservedObject var scene: RobotSceneModel

    var body: some View {
        Canvas(opaque: false, colorMode: .nonLinear, rendersAsynchronously: false) { context, _ in
            let now = scene.now
            scene.trail.draw(in: context, now: now)
            scene.particles.draw(in: context)
            if scene.pose.isVisible {
                RobotPainter.draw(pose: scene.pose, size: scene.robotSize, in: context)
            }
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }
}

/// Vector artwork for the robot, drawn facing +x and rotated by the pose heading.
enum RobotPainter {
    static func draw(pose: RobotPose, size: CGFloat, in context: GraphicsContext) {
        let r = size / 2
        context.drawLayer { layer in
            layer.translateBy(x: pose.position.x, y: pose.position.y)
            layer.rotate(by: Angle(radians: Double(pose.heading)))

            let wobble: CGFloat = pose.state == .vacuuming ? 1 + 0.035 * sin(pose.suctionProgress * .pi * 6) : 1
            layer.scaleBy(x: wobble, y: wobble)

            // Shadow
            layer.fill(
                Path(ellipseIn: CGRect(x: -r + 2, y: -r + 4, width: 2 * r, height: 2 * r)),
                with: .color(.black.opacity(0.28))
            )

            // Body
            let body = Path(ellipseIn: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r))
            let bodyGradient = Gradient(colors: [
                Color(red: 0.93, green: 0.94, blue: 0.96),
                Color(red: 0.72, green: 0.75, blue: 0.80),
                Color(red: 0.42, green: 0.45, blue: 0.52),
            ])
            layer.fill(body, with: .radialGradient(bodyGradient, center: CGPoint(x: -r * 0.3, y: -r * 0.35), startRadius: 0, endRadius: r * 1.4))
            layer.stroke(body, with: .color(.white.opacity(0.55)), lineWidth: 1)

            // Error tint
            if pose.errorFlash > 0 {
                layer.fill(body, with: .color(Color.red.opacity(Double(pose.errorFlash) * 0.45)))
            }

            // Front bumper
            var bumper = Path()
            bumper.addArc(center: .zero, radius: r - r * 0.09, startAngle: .degrees(-58), endAngle: .degrees(58), clockwise: false)
            layer.stroke(bumper, with: .color(Color(red: 0.3, green: 0.33, blue: 0.38)), style: StrokeStyle(lineWidth: r * 0.17, lineCap: .round))

            // Side wheels
            for side: CGFloat in [-1, 1] {
                let wheel = CGRect(x: -r * 0.22, y: side * r * 0.74 - r * 0.07, width: r * 0.44, height: r * 0.14)
                layer.fill(Path(roundedRect: wheel, cornerRadius: r * 0.05), with: .color(Color(red: 0.16, green: 0.17, blue: 0.2)))
            }

            // Suction mouth at the front
            let mouthRect = CGRect(x: r * 0.5, y: -r * 0.42, width: r * 0.26, height: r * 0.84)
            let suctionGlow = pose.state == .vacuuming ? 0.35 + 0.45 * Double(abs(sin(pose.suctionProgress * .pi * 4))) : 0.0
            layer.fill(Path(roundedRect: mouthRect, cornerRadius: r * 0.08), with: .color(Color(red: 0.2, green: 0.22, blue: 0.27)))
            if suctionGlow > 0 {
                layer.fill(Path(roundedRect: mouthRect.insetBy(dx: r * 0.03, dy: r * 0.06), cornerRadius: r * 0.06), with: .color(Color(red: 0.55, green: 0.8, blue: 1).opacity(suctionGlow)))
            }

            // Lidar turret
            let turretCenter = CGPoint(x: -r * 0.18, y: 0)
            let turretRadius = r * 0.24
            let turret = Path(ellipseIn: CGRect(x: turretCenter.x - turretRadius, y: turretCenter.y - turretRadius, width: turretRadius * 2, height: turretRadius * 2))
            layer.fill(turret, with: .color(Color(red: 0.24, green: 0.26, blue: 0.3)))
            layer.stroke(turret, with: .color(.white.opacity(0.35)), lineWidth: 1)
            var beam = Path()
            beam.move(to: turretCenter)
            beam.addLine(to: CGPoint(
                x: turretCenter.x + cos(pose.lidarAngle) * turretRadius * 0.85,
                y: turretCenter.y + sin(pose.lidarAngle) * turretRadius * 0.85
            ))
            layer.stroke(beam, with: .color(Color(red: 0.55, green: 0.95, blue: 1).opacity(0.9)), style: StrokeStyle(lineWidth: max(1.5, r * 0.06), lineCap: .round))

            // Status LEDs
            let ledColor = ledColor(for: pose)
            for side: CGFloat in [-1, 1] {
                let ledRect = CGRect(x: r * 0.28 - r * 0.07, y: side * r * 0.3 - r * 0.07, width: r * 0.14, height: r * 0.14)
                var glow = layer
                glow.addFilter(.blur(radius: r * 0.08))
                glow.fill(Path(ellipseIn: ledRect.insetBy(dx: -r * 0.05, dy: -r * 0.05)), with: .color(ledColor.opacity(0.6)))
                layer.fill(Path(ellipseIn: ledRect), with: .color(ledColor))
            }

            // Celebration ring
            if pose.celebration > 0 {
                let spread = r * (1.1 + (1 - pose.celebration) * 0.8)
                let ring = Path(ellipseIn: CGRect(x: -spread, y: -spread, width: spread * 2, height: spread * 2))
                layer.stroke(ring, with: .color(Color.mint.opacity(Double(pose.celebration) * 0.8)), lineWidth: 3)
            }
        }
    }

    static func ledColor(for pose: RobotPose) -> Color {
        switch pose.state {
        case .paused: return .orange
        case .blocked: return .red
        case .vacuuming: return Color(red: 0.4, green: 0.75, blue: 1)
        case .completed:
            let hue = Double(1 - pose.celebration)
            return Color(hue: hue, saturation: 0.8, brightness: 1)
        case .idle: return Color(white: 0.85)
        case .avoiding: return .yellow
        default: return .green
        }
    }
}

/// The small live robot shown in the menu bar popover.
struct RobotBadgeView: View {
    var state: RobotState
    var size: CGFloat = 56

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { timeline in
            Canvas { context, canvasSize in
                var pose = RobotPose()
                pose.position = CGPoint(x: canvasSize.width / 2, y: canvasSize.height / 2)
                pose.heading = -.pi / 2
                pose.state = state
                pose.isVisible = true
                pose.lidarAngle = CGFloat(timeline.date.timeIntervalSinceReferenceDate * (state == .idle ? 1.2 : 6))
                if state == .vacuuming {
                    pose.suctionProgress = CGFloat(timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1))
                }
                RobotPainter.draw(pose: pose, size: size, in: context)
            }
        }
        .frame(width: size + 12, height: size + 12)
        .accessibilityHidden(true)
    }
}
