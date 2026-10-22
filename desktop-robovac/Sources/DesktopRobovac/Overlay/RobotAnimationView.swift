import SwiftUI

/// Draws trail, particles and the robot in a single Canvas.
struct RobotAnimationView: View {
    @ObservedObject var scene: RobotSceneModel

    var body: some View {
        Canvas(opaque: false, colorMode: .nonLinear, rendersAsynchronously: false) { context, _ in
            let now = scene.now
            scene.trail.draw(in: context, now: now)
            scene.particles.draw(in: context)
            if let sprite = scene.sprite {
                SuctionSpritePainter.draw(sprite, mouth: scene.mouthPosition, now: now, in: context)
            }
            if scene.pose.isVisible {
                RobotPainter.draw(pose: scene.pose, size: scene.robotSize, in: context)
            }
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }
}

/// Vector artwork for the robot, drawn facing +x and rotated by the pose heading.
/// Top-down view of a white robot vacuum: thin dark bumper segments across the
/// front, a seam across the top plate, a central brushed-metal lidar with a
/// glowing ring, a small ring button and two spinning side brushes at the front.
enum RobotPainter {
    static func draw(pose: RobotPose, size: CGFloat, in context: GraphicsContext) {
        let r = size / 2
        context.drawLayer { layer in
            layer.translateBy(x: pose.position.x, y: pose.position.y)
            layer.rotate(by: Angle(radians: Double(pose.heading)))

            let wobble: CGFloat = pose.state == .vacuuming ? 1 + 0.025 * sin(pose.suctionProgress * .pi * 6) : 1
            layer.scaleBy(x: wobble, y: wobble)

            // Soft drop shadow
            var shadow = layer
            shadow.addFilter(.blur(radius: r * 0.14))
            shadow.fill(
                Path(ellipseIn: CGRect(x: -r + r * 0.06, y: -r + r * 0.14, width: 2 * r, height: 2 * r)),
                with: .color(.black.opacity(0.35))
            )

            // Side brushes at the two front corners, under the body.
            let brushSpin = pose.state == .vacuuming ? pose.lidarAngle * 1.5 : pose.lidarAngle * 3
            for side: CGFloat in [-1, 1] {
                let brushCenter = CGPoint(x: cos(0.95) * r * 0.92, y: sin(0.95) * r * 0.92 * side)
                for arm in 0..<3 {
                    let angle = brushSpin * side + CGFloat(arm) * (2 * .pi / 3)
                    for spread: CGFloat in [-0.16, 0, 0.16] {
                        var bristle = Path()
                        bristle.move(to: brushCenter)
                        let length = r * (spread == 0 ? 0.5 : 0.44)
                        bristle.addLine(to: CGPoint(x: brushCenter.x + cos(angle + spread) * length, y: brushCenter.y + sin(angle + spread) * length))
                        layer.stroke(bristle, with: .color(Color(white: 0.78).opacity(0.9)), style: StrokeStyle(lineWidth: max(1, r * 0.045), lineCap: .round))
                    }
                }
                layer.fill(Path(ellipseIn: CGRect(x: brushCenter.x - r * 0.07, y: brushCenter.y - r * 0.07, width: r * 0.14, height: r * 0.14)), with: .color(Color(white: 0.3)))
            }

            // Body: white with soft shading towards the edge.
            let body = Path(ellipseIn: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r))
            let bodyGradient = Gradient(colors: [
                Color(white: 0.995),
                Color(white: 0.96),
                Color(red: 0.8, green: 0.81, blue: 0.84),
            ])
            layer.fill(body, with: .radialGradient(bodyGradient, center: CGPoint(x: -r * 0.3, y: -r * 0.35), startRadius: r * 0.2, endRadius: r * 1.35))
            layer.stroke(body, with: .color(Color(white: 0.45).opacity(0.7)), lineWidth: max(1, r * 0.035))

            // Dark bumper segments across the front rim, with small gaps.
            for (from, to) in [(-70.0, -38.0), (-30.0, 30.0), (38.0, 70.0)] {
                var segment = Path()
                segment.addArc(center: .zero, radius: r - r * 0.045, startAngle: .degrees(from), endAngle: .degrees(to), clockwise: false)
                layer.stroke(segment, with: .color(Color(red: 0.12, green: 0.13, blue: 0.15)), style: StrokeStyle(lineWidth: r * 0.09, lineCap: .round))
            }
            // Rear rim sensor tabs
            for angle in [150.0, 210.0] {
                var tab = Path()
                tab.addArc(center: .zero, radius: r - r * 0.045, startAngle: .degrees(angle - 6), endAngle: .degrees(angle + 6), clockwise: false)
                layer.stroke(tab, with: .color(Color(red: 0.12, green: 0.13, blue: 0.15)), style: StrokeStyle(lineWidth: r * 0.09, lineCap: .round))
            }

            // Seam across the top plate (perpendicular to travel), broken by the lidar.
            for side: CGFloat in [-1, 1] {
                var seam = Path()
                seam.move(to: CGPoint(x: -r * 0.05, y: side * r * 0.36))
                seam.addLine(to: CGPoint(x: -r * 0.05, y: side * r * 0.95))
                layer.stroke(seam, with: .color(Color(white: 0.7).opacity(0.8)), lineWidth: max(1, r * 0.02))
            }

            // Glossy highlight
            var highlight = layer
            highlight.clip(to: body)
            highlight.addFilter(.blur(radius: r * 0.12))
            highlight.fill(Path(ellipseIn: CGRect(x: -r * 1.0, y: -r * 1.0, width: r * 1.2, height: r * 0.8)), with: .color(.white.opacity(0.55)))

            // Error tint
            if pose.errorFlash > 0 {
                layer.fill(body, with: .color(Color.red.opacity(Double(pose.errorFlash) * 0.4)))
            }

            // Central brushed-metal lidar with a glowing ring.
            let ringColor = ledColor(for: pose)
            let turretCenter = CGPoint(x: -r * 0.05, y: 0)
            let turretRadius = r * 0.31
            var towerShadow = layer
            towerShadow.addFilter(.blur(radius: r * 0.06))
            towerShadow.fill(Path(ellipseIn: CGRect(x: turretCenter.x - turretRadius + r * 0.03, y: turretCenter.y - turretRadius + r * 0.06, width: turretRadius * 2, height: turretRadius * 2)), with: .color(.black.opacity(0.3)))
            var glow = layer
            glow.addFilter(.blur(radius: r * 0.08))
            glow.stroke(Path(ellipseIn: CGRect(x: turretCenter.x - turretRadius, y: turretCenter.y - turretRadius, width: turretRadius * 2, height: turretRadius * 2)), with: .color(ringColor.opacity(0.9)), lineWidth: r * 0.09)
            let turret = Path(ellipseIn: CGRect(x: turretCenter.x - turretRadius, y: turretCenter.y - turretRadius, width: turretRadius * 2, height: turretRadius * 2))
            let metal = Gradient(colors: [Color(white: 0.95), Color(white: 0.78), Color(white: 0.6), Color(white: 0.82)])
            layer.fill(turret, with: .linearGradient(metal, startPoint: CGPoint(x: turretCenter.x - turretRadius, y: turretCenter.y - turretRadius), endPoint: CGPoint(x: turretCenter.x + turretRadius, y: turretCenter.y + turretRadius)))
            layer.stroke(turret, with: .color(ringColor.opacity(0.95)), lineWidth: max(1.5, r * 0.045))
            // Brushed-metal rings
            for fraction: CGFloat in [0.78, 0.56, 0.34] {
                let radius = turretRadius * fraction
                layer.stroke(Path(ellipseIn: CGRect(x: turretCenter.x - radius, y: turretCenter.y - radius, width: radius * 2, height: radius * 2)), with: .color(Color(white: 0.5).opacity(0.25)), lineWidth: 1)
            }
            // Rotating lidar tick
            var tick = Path()
            tick.move(to: CGPoint(x: turretCenter.x + cos(pose.lidarAngle) * turretRadius * 0.4, y: turretCenter.y + sin(pose.lidarAngle) * turretRadius * 0.4))
            tick.addLine(to: CGPoint(x: turretCenter.x + cos(pose.lidarAngle) * turretRadius * 0.88, y: turretCenter.y + sin(pose.lidarAngle) * turretRadius * 0.88))
            layer.stroke(tick, with: .color(ringColor.opacity(0.7)), style: StrokeStyle(lineWidth: max(1, r * 0.035), lineCap: .round))
            layer.fill(Path(ellipseIn: CGRect(x: turretCenter.x - turretRadius * 0.12, y: turretCenter.y - turretRadius * 0.12, width: turretRadius * 0.24, height: turretRadius * 0.24)), with: .color(Color(white: 0.4)))

            // Small ring button ahead of the lidar
            let buttonCenter = CGPoint(x: r * 0.5, y: -r * 0.08)
            let buttonRadius = r * 0.1
            layer.stroke(Path(ellipseIn: CGRect(x: buttonCenter.x - buttonRadius, y: buttonCenter.y - buttonRadius, width: buttonRadius * 2, height: buttonRadius * 2)), with: .color(ringColor.opacity(0.85)), lineWidth: max(1.2, r * 0.035))
            layer.fill(Path(ellipseIn: CGRect(x: buttonCenter.x - buttonRadius * 0.55, y: buttonCenter.y - buttonRadius * 0.55, width: buttonRadius * 1.1, height: buttonRadius * 1.1)), with: .color(Color(white: 0.9)))

            // Suction intake glow at the front when vacuuming
            if pose.state == .vacuuming {
                let pulse = 0.4 + 0.5 * Double(abs(sin(pose.suctionProgress * .pi * 4)))
                var intake = layer
                intake.addFilter(.blur(radius: r * 0.12))
                intake.fill(Path(roundedRect: CGRect(x: r * 0.7, y: -r * 0.45, width: r * 0.35, height: r * 0.9), cornerRadius: r * 0.1), with: .color(Color(red: 0.55, green: 0.8, blue: 1).opacity(pulse)))
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
        case .vacuuming: return Color(red: 0.35, green: 0.8, blue: 1)
        case .completed:
            let hue = Double(1 - pose.celebration)
            return Color(hue: hue, saturation: 0.8, brightness: 1)
        case .idle: return Color(red: 0.55, green: 0.75, blue: 1)
        case .avoiding: return .yellow
        default: return Color(red: 0.3, green: 0.65, blue: 1)
        }
    }
}

/// Draws the file being vacuumed: it lifts, wobbles, gets pulled along a curve
/// into the intake and crumples (shrinks and spins) as it goes in. Uses the file's
/// real icon when known, otherwise a sheet of paper.
enum SuctionSpritePainter {
    static func draw(_ sprite: RobotSceneModel.SuctionSprite, mouth: CGPoint, now: TimeInterval, in context: GraphicsContext) {
        let t = min(1, max(0, (now - sprite.startTime) / sprite.duration))
        // Hesitate first (the icon shivers), then accelerate into the intake.
        let pull = t < 0.3 ? 0 : pow((t - 0.3) / 0.7, 1.8)
        let shiver = t < 0.3 ? sin(now * 60) * 2.5 * (t / 0.3) : 0
        let lift = sin(min(1, t / 0.3) * .pi / 2) * 6
        let position = CGPoint(
            x: sprite.origin.x + (mouth.x - sprite.origin.x) * pull + shiver,
            y: sprite.origin.y + (mouth.y - sprite.origin.y) * pull - lift * (1 - pull)
        )
        let scale = 1 - 0.9 * pull
        let rotation = pull * 2.6 + shiver * 0.02
        let size = sprite.size * scale
        guard size > 1.5 else { return }

        context.drawLayer { layer in
            layer.translateBy(x: position.x, y: position.y)
            layer.rotate(by: Angle(radians: rotation))
            // Crumple: squash sideways as it goes in.
            layer.scaleBy(x: 1 - 0.35 * pull, y: 1)
            layer.opacity = 1 - 0.3 * pull

            let rect = CGRect(x: -size / 2, y: -size / 2, width: size, height: size)
            if let icon = sprite.icon {
                let resolved = layer.resolve(Image(nsImage: icon))
                var shadow = layer
                shadow.addFilter(.shadow(color: .black.opacity(0.4), radius: size * 0.08, x: 0, y: size * 0.05))
                shadow.draw(resolved, in: rect)
            } else {
                drawPaper(in: rect, layer: &layer)
            }
        }
    }

    private static func drawPaper(in rect: CGRect, layer: inout GraphicsContext) {
        let sheet = CGRect(x: rect.minX + rect.width * 0.15, y: rect.minY, width: rect.width * 0.7, height: rect.height)
        var shadow = layer
        shadow.addFilter(.shadow(color: .black.opacity(0.35), radius: rect.width * 0.06, x: 0, y: rect.height * 0.04))
        shadow.fill(Path(roundedRect: sheet, cornerRadius: rect.width * 0.04), with: .color(.white))
        layer.fill(Path(roundedRect: sheet, cornerRadius: rect.width * 0.04), with: .color(.white))
        // Folded corner
        var fold = Path()
        fold.move(to: CGPoint(x: sheet.maxX - sheet.width * 0.3, y: sheet.minY))
        fold.addLine(to: CGPoint(x: sheet.maxX, y: sheet.minY + sheet.height * 0.22))
        fold.addLine(to: CGPoint(x: sheet.maxX - sheet.width * 0.3, y: sheet.minY + sheet.height * 0.22))
        fold.closeSubpath()
        layer.fill(fold, with: .color(Color(white: 0.85)))
        // Text lines
        for line in 0..<5 {
            let y = sheet.minY + sheet.height * (0.35 + 0.11 * CGFloat(line))
            var path = Path()
            path.move(to: CGPoint(x: sheet.minX + sheet.width * 0.15, y: y))
            path.addLine(to: CGPoint(x: sheet.maxX - sheet.width * (line == 4 ? 0.45 : 0.15), y: y))
            layer.stroke(path, with: .color(Color(white: 0.6)), lineWidth: max(1, rect.height * 0.035))
        }
        layer.stroke(Path(roundedRect: sheet, cornerRadius: rect.width * 0.04), with: .color(Color(white: 0.55)), lineWidth: 1)
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
