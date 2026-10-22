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
/// Top-down view of a round robot vacuum: dark bumper across the front, glossy
/// top plate, raised lidar tower at the rear, two buttons, a spinning side brush
/// at the front-left corner and a dust bin outline at the back.
enum RobotPainter {
    static func draw(pose: RobotPose, size: CGFloat, in context: GraphicsContext) {
        let r = size / 2
        context.drawLayer { layer in
            layer.translateBy(x: pose.position.x, y: pose.position.y)
            layer.rotate(by: Angle(radians: Double(pose.heading)))

            let wobble: CGFloat = pose.state == .vacuuming ? 1 + 0.03 * sin(pose.suctionProgress * .pi * 6) : 1
            layer.scaleBy(x: wobble, y: wobble)

            // Soft drop shadow
            var shadow = layer
            shadow.addFilter(.blur(radius: r * 0.12))
            shadow.fill(
                Path(ellipseIn: CGRect(x: -r + r * 0.05, y: -r + r * 0.12, width: 2 * r, height: 2 * r)),
                with: .color(.black.opacity(0.32))
            )

            // Side brush, under the body so the arms sweep out from beneath the edge.
            let brushCenter = CGPoint(x: r * 0.58, y: -r * 0.58)
            let brushSpin = pose.state == .vacuuming ? pose.lidarAngle * 1.5 : pose.lidarAngle * 3
            for arm in 0..<3 {
                let angle = brushSpin + CGFloat(arm) * (2 * .pi / 3)
                var bristle = Path()
                bristle.move(to: brushCenter)
                bristle.addLine(to: CGPoint(x: brushCenter.x + cos(angle) * r * 0.52, y: brushCenter.y + sin(angle) * r * 0.52))
                layer.stroke(bristle, with: .color(Color(white: 0.9).opacity(0.85)), style: StrokeStyle(lineWidth: max(1.5, r * 0.07), lineCap: .round))
                // Bristle tufts fan out at the tip.
                for spread: CGFloat in [-0.18, 0.18] {
                    var tuft = Path()
                    tuft.move(to: CGPoint(x: brushCenter.x + cos(angle) * r * 0.34, y: brushCenter.y + sin(angle) * r * 0.34))
                    tuft.addLine(to: CGPoint(x: brushCenter.x + cos(angle + spread) * r * 0.5, y: brushCenter.y + sin(angle + spread) * r * 0.5))
                    layer.stroke(tuft, with: .color(Color(white: 0.85).opacity(0.7)), style: StrokeStyle(lineWidth: max(1, r * 0.04), lineCap: .round))
                }
            }
            layer.fill(Path(ellipseIn: CGRect(x: brushCenter.x - r * 0.08, y: brushCenter.y - r * 0.08, width: r * 0.16, height: r * 0.16)), with: .color(Color(white: 0.35)))

            // Body
            let body = Path(ellipseIn: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r))
            let bodyGradient = Gradient(colors: [
                Color(red: 0.97, green: 0.97, blue: 0.98),
                Color(red: 0.86, green: 0.87, blue: 0.9),
                Color(red: 0.62, green: 0.64, blue: 0.7),
            ])
            layer.fill(body, with: .radialGradient(bodyGradient, center: CGPoint(x: -r * 0.35, y: -r * 0.4), startRadius: 0, endRadius: r * 1.5))
            layer.stroke(body, with: .color(Color(white: 0.25).opacity(0.6)), lineWidth: max(1, r * 0.03))

            // Front bumper: a darker ring segment across the front with a seam.
            var bumper = Path()
            bumper.addArc(center: .zero, radius: r - r * 0.015, startAngle: .degrees(-72), endAngle: .degrees(72), clockwise: false)
            bumper.addArc(center: .zero, radius: r * 0.82, startAngle: .degrees(72), endAngle: .degrees(-72), clockwise: true)
            bumper.closeSubpath()
            let bumperGradient = Gradient(colors: [Color(red: 0.3, green: 0.32, blue: 0.37), Color(red: 0.16, green: 0.17, blue: 0.2)])
            layer.fill(bumper, with: .linearGradient(bumperGradient, startPoint: CGPoint(x: r * 0.6, y: -r), endPoint: CGPoint(x: r, y: r)))
            var seam = Path()
            seam.addArc(center: .zero, radius: r * 0.82, startAngle: .degrees(-72), endAngle: .degrees(72), clockwise: false)
            layer.stroke(seam, with: .color(.black.opacity(0.35)), lineWidth: max(1, r * 0.025))
            // Bumper sensor window
            layer.fill(Path(roundedRect: CGRect(x: r * 0.84, y: -r * 0.12, width: r * 0.07, height: r * 0.24), cornerRadius: r * 0.02), with: .color(Color(red: 0.05, green: 0.05, blue: 0.08)))

            // Glossy top plate and highlight
            let plate = Path(ellipseIn: CGRect(x: -r * 0.86, y: -r * 0.86, width: r * 1.72, height: r * 1.72))
            layer.stroke(plate, with: .color(.white.opacity(0.35)), lineWidth: 1)
            var highlight = layer
            highlight.clip(to: body)
            highlight.addFilter(.blur(radius: r * 0.1))
            highlight.fill(Path(ellipseIn: CGRect(x: -r * 0.95, y: -r * 0.95, width: r * 1.1, height: r * 0.7)), with: .color(.white.opacity(0.35)))

            // Dust bin at the rear
            let bin = Path(roundedRect: CGRect(x: -r * 0.8, y: -r * 0.42, width: r * 0.42, height: r * 0.84), cornerRadius: r * 0.1)
            layer.fill(bin, with: .color(Color(red: 0.2, green: 0.22, blue: 0.27).opacity(0.12)))
            layer.stroke(bin, with: .color(Color(white: 0.3).opacity(0.35)), lineWidth: 1)
            var binHandle = Path()
            binHandle.move(to: CGPoint(x: -r * 0.62, y: -r * 0.2))
            binHandle.addLine(to: CGPoint(x: -r * 0.62, y: r * 0.2))
            layer.stroke(binHandle, with: .color(Color(white: 0.3).opacity(0.4)), style: StrokeStyle(lineWidth: max(1, r * 0.03), lineCap: .round))

            // Error tint
            if pose.errorFlash > 0 {
                layer.fill(body, with: .color(Color.red.opacity(Double(pose.errorFlash) * 0.45)))
            }

            // Lidar tower (raised, with its own shadow) at the rear-centre.
            let turretCenter = CGPoint(x: -r * 0.12, y: 0)
            let turretRadius = r * 0.27
            var towerShadow = layer
            towerShadow.addFilter(.blur(radius: r * 0.06))
            towerShadow.fill(Path(ellipseIn: CGRect(x: turretCenter.x - turretRadius + r * 0.03, y: turretCenter.y - turretRadius + r * 0.06, width: turretRadius * 2, height: turretRadius * 2)), with: .color(.black.opacity(0.35)))
            let turret = Path(ellipseIn: CGRect(x: turretCenter.x - turretRadius, y: turretCenter.y - turretRadius, width: turretRadius * 2, height: turretRadius * 2))
            let turretGradient = Gradient(colors: [Color(red: 0.42, green: 0.44, blue: 0.5), Color(red: 0.15, green: 0.16, blue: 0.19)])
            layer.fill(turret, with: .radialGradient(turretGradient, center: CGPoint(x: turretCenter.x - turretRadius * 0.4, y: turretCenter.y - turretRadius * 0.4), startRadius: 0, endRadius: turretRadius * 1.3))
            layer.stroke(turret, with: .color(.white.opacity(0.3)), lineWidth: 1)
            // Rotating lidar window
            var window = Path()
            window.addArc(center: turretCenter, radius: turretRadius * 0.78, startAngle: Angle(radians: Double(pose.lidarAngle) - 0.5), endAngle: Angle(radians: Double(pose.lidarAngle) + 0.5), clockwise: false)
            layer.stroke(window, with: .color(Color(red: 0.55, green: 0.95, blue: 1).opacity(0.9)), style: StrokeStyle(lineWidth: max(1.5, r * 0.07), lineCap: .round))
            layer.fill(Path(ellipseIn: CGRect(x: turretCenter.x - turretRadius * 0.35, y: turretCenter.y - turretRadius * 0.35, width: turretRadius * 0.7, height: turretRadius * 0.7)), with: .color(Color(red: 0.1, green: 0.11, blue: 0.13)))

            // Two buttons ahead of the tower
            let ledColor = ledColor(for: pose)
            for (offset, isPower) in [(-r * 0.17, true), (r * 0.17, false)] {
                let buttonRect = CGRect(x: r * 0.3 - r * 0.075, y: offset - r * 0.075, width: r * 0.15, height: r * 0.15)
                layer.fill(Path(ellipseIn: buttonRect), with: .color(Color(white: 0.2)))
                layer.stroke(Path(ellipseIn: buttonRect), with: .color(.white.opacity(0.3)), lineWidth: 1)
                var glow = layer
                glow.addFilter(.blur(radius: r * 0.07))
                glow.fill(Path(ellipseIn: buttonRect.insetBy(dx: -r * 0.03, dy: -r * 0.03)), with: .color(ledColor.opacity(isPower ? 0.7 : 0.4)))
                if isPower {
                    var glyph = Path()
                    glyph.addArc(center: CGPoint(x: buttonRect.midX, y: buttonRect.midY), radius: r * 0.045, startAngle: .degrees(-50), endAngle: .degrees(230), clockwise: false)
                    layer.stroke(glyph, with: .color(ledColor), lineWidth: max(1, r * 0.025))
                } else {
                    layer.fill(Path(ellipseIn: buttonRect.insetBy(dx: r * 0.045, dy: r * 0.045)), with: .color(ledColor))
                }
            }

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
        case .vacuuming: return Color(red: 0.4, green: 0.75, blue: 1)
        case .completed:
            let hue = Double(1 - pose.celebration)
            return Color(hue: hue, saturation: 0.8, brightness: 1)
        case .idle: return Color(white: 0.85)
        case .avoiding: return .yellow
        default: return Color(red: 0.45, green: 0.95, blue: 0.6)
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
