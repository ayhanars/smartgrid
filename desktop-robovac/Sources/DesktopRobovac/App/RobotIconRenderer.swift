import AppKit

/// Draws the tiny robot vacuum used as the menu bar icon.
enum RobotIconRenderer {
    static func menuBarImage() -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size, flipped: false) { rect in
            let color = NSColor.black
            color.setStroke()
            color.setFill()

            // Body
            let bodyRect = rect.insetBy(dx: 2.5, dy: 2.5)
            let body = NSBezierPath(ovalIn: bodyRect)
            body.lineWidth = 1.6
            body.stroke()

            // Front bumper (robot faces right)
            let bumper = NSBezierPath()
            bumper.appendArc(
                withCenter: NSPoint(x: bodyRect.midX, y: bodyRect.midY),
                radius: bodyRect.width / 2 - 0.2,
                startAngle: -50, endAngle: 50
            )
            bumper.lineWidth = 3.2
            bumper.lineCapStyle = .round
            bumper.stroke()

            // Lidar turret
            let turret = NSBezierPath(ovalIn: NSRect(x: bodyRect.midX - 3.6, y: bodyRect.midY - 1.6, width: 3.2, height: 3.2))
            turret.fill()

            // Status LED
            let led = NSBezierPath(ovalIn: NSRect(x: bodyRect.midX + 1.2, y: bodyRect.midY + 1.8, width: 1.6, height: 1.6))
            led.fill()
            return true
        }
        image.isTemplate = true
        return image
    }
}
