import SwiftUI

/// Dust, suction swirls and collection bursts. Purely decorative.
final class ParticleSystem {
    struct Particle {
        enum Kind { case dust, suction, burst, sparkle }
        var position: CGPoint
        var velocity: CGVector
        var age: TimeInterval = 0
        var lifetime: TimeInterval
        var size: CGFloat
        var color: Color
        var kind: Kind
    }

    var enabled = true
    var intensity: Double = 1
    /// Where suction particles are pulled to (the robot's mouth).
    var attractor: CGPoint?

    private(set) var particles: [Particle] = []
    private var random = SplitMix64(seed: 0xD15C_0BEE)

    func reset() {
        particles.removeAll()
    }

    private func unit() -> CGFloat { CGFloat(random.nextUnit()) }

    func spawnDust(at point: CGPoint, radius: CGFloat) {
        guard enabled else { return }
        let count = Int(6 * intensity.rounded())
        for _ in 0..<max(1, count) {
            let angle = unit() * 2 * .pi
            let distance = radius * (0.3 + unit() * 0.7)
            let position = CGPoint(x: point.x + cos(angle) * distance, y: point.y + sin(angle) * distance)
            particles.append(Particle(
                position: position,
                velocity: CGVector(dx: (unit() - 0.5) * 20, dy: -8 - unit() * 10),
                lifetime: 0.7 + Double(unit()) * 0.5,
                size: 2 + unit() * 2.5,
                color: Color.gray.opacity(0.6),
                kind: .dust
            ))
        }
    }

    func spawnSuction(at point: CGPoint, radius: CGFloat) {
        guard enabled else { return }
        let count = Int(14 * intensity.rounded())
        for _ in 0..<max(2, count) {
            let angle = unit() * 2 * .pi
            let distance = radius * (0.5 + unit() * 0.9)
            let position = CGPoint(x: point.x + cos(angle) * distance, y: point.y + sin(angle) * distance)
            particles.append(Particle(
                position: position,
                velocity: CGVector(dx: -sin(angle) * 40, dy: cos(angle) * 40),
                lifetime: 0.6 + Double(unit()) * 0.5,
                size: 2.5 + unit() * 3,
                color: Color(red: 0.75, green: 0.88, blue: 1.0).opacity(0.85),
                kind: .suction
            ))
        }
    }

    func spawnBurst(at point: CGPoint) {
        guard enabled else { return }
        let count = Int(12 * intensity.rounded())
        for _ in 0..<max(3, count) {
            let angle = unit() * 2 * .pi
            let speed = 60 + unit() * 90
            particles.append(Particle(
                position: point,
                velocity: CGVector(dx: cos(angle) * speed, dy: sin(angle) * speed),
                lifetime: 0.35 + Double(unit()) * 0.3,
                size: 2 + unit() * 2.5,
                color: Color(red: 0.62, green: 0.9, blue: 0.75).opacity(0.95),
                kind: .burst
            ))
        }
    }

    func spawnSparkles(around point: CGPoint, radius: CGFloat) {
        guard enabled else { return }
        for _ in 0..<Int(10 * max(0.3, intensity)) {
            let angle = unit() * 2 * .pi
            particles.append(Particle(
                position: CGPoint(x: point.x + cos(angle) * radius, y: point.y + sin(angle) * radius),
                velocity: CGVector(dx: cos(angle) * 30, dy: sin(angle) * 30 - 20),
                lifetime: 0.8 + Double(unit()) * 0.6,
                size: 2 + unit() * 3,
                color: [Color.yellow, Color.orange, Color.mint, Color.pink][Int(unit() * 3.99)].opacity(0.9),
                kind: .sparkle
            ))
        }
    }

    func update(dt: TimeInterval) {
        guard !particles.isEmpty else { return }
        for index in particles.indices {
            particles[index].age += dt
            var p = particles[index]
            switch p.kind {
            case .suction:
                if let attractor {
                    let dx = attractor.x - p.position.x
                    let dy = attractor.y - p.position.y
                    let distance = max(1, (dx * dx + dy * dy).squareRoot())
                    p.velocity.dx += dx / distance * 420 * dt
                    p.velocity.dy += dy / distance * 420 * dt
                    if distance < 6 { p.age = p.lifetime }
                }
            case .burst:
                p.velocity.dx *= 1 - 3 * dt
                p.velocity.dy *= 1 - 3 * dt
            case .dust, .sparkle:
                p.velocity.dy += 10 * dt
            }
            p.position.x += p.velocity.dx * dt
            p.position.y += p.velocity.dy * dt
            particles[index] = p
        }
        particles.removeAll { $0.age >= $0.lifetime }
    }

    func draw(in context: GraphicsContext) {
        for p in particles {
            let life = max(0, 1 - p.age / p.lifetime)
            let size = p.size * (p.kind == .burst ? CGFloat(life) : 1)
            let rect = CGRect(x: p.position.x - size / 2, y: p.position.y - size / 2, width: size, height: size)
            context.fill(Path(ellipseIn: rect), with: .color(p.color.opacity(life)))
        }
    }
}
