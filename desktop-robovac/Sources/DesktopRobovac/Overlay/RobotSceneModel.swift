import Combine
import Foundation
import QuartzCore
import RobovacCore

/// Observable state for the overlay: the robot pose, trail, particles and the
/// animation clock that advances them. One instance per overlay.
@MainActor
final class RobotSceneModel: ObservableObject {
    @Published private(set) var pose = RobotPose()
    @Published private(set) var frame: Int = 0

    let motion = RobotMotionController()
    let trail = TrailRenderer()
    let particles = ParticleSystem()

    private(set) var appearance = AppearanceSettings()
    private(set) var isGentle = false
    private var ticker: Timer?
    private var lastTick: CFTimeInterval = 0
    private(set) var now: TimeInterval = 0
    /// Called after every simulation step with the new pose (used for the motor sound).
    var onTick: ((RobotPose) -> Void)?

    var robotSize: CGFloat { CGFloat(appearance.robotSize) }

    func configure(appearance: AppearanceSettings, gentle: Bool, movementBlipInterval: TimeInterval?) {
        self.appearance = appearance
        self.isGentle = gentle
        let speedScale: CGFloat = gentle ? 0.6 : 1
        motion.maxSpeed = CGFloat(appearance.movementSpeed) * speedScale
        motion.acceleration = 420 * speedScale + 60
        motion.deceleration = 480 * speedScale + 60
        motion.turnRate = .pi * (gentle ? 1.1 : 1.7)
        motion.reducedMotion = appearance.reducedMotion
        motion.blipInterval = movementBlipInterval
        motion.bodyRadius = robotSize / 2
        trail.style = appearance.reducedMotion ? .none : appearance.trailStyle
        trail.opacity = appearance.trailOpacity * (gentle ? 0.7 : 1)
        trail.fadeDuration = appearance.trailFadeDuration
        trail.robotSize = robotSize
        particles.enabled = appearance.particleEffects && !appearance.reducedMotion
        particles.intensity = appearance.animationIntensity * (gentle ? 0.6 : 1)
    }

    // MARK: Pose edits

    func place(at point: CGPoint, heading: CGFloat, visible: Bool) {
        var next = pose
        motion.teleport(&next, to: point, heading: heading)
        next.isVisible = visible
        next.state = .idle
        pose = next
    }

    func setVisible(_ visible: Bool) {
        pose.isVisible = visible
    }

    func beginSuction(at target: CGPoint) {
        pose.suctionTarget = target
        particles.attractor = mouthPosition
        particles.spawnDust(at: target, radius: robotSize * 0.6)
        particles.spawnSuction(at: target, radius: robotSize * 0.9)
    }

    func collected(at target: CGPoint) {
        particles.spawnBurst(at: mouthPosition)
        particles.attractor = nil
    }

    func flashError() {
        pose.errorFlash = 1
        pose.state = .blocked
        particles.attractor = nil
    }

    func celebrate() {
        pose.celebration = 1
        particles.spawnSparkles(around: pose.position, radius: robotSize * 0.7)
    }

    func resetEffects() {
        trail.reset()
        particles.reset()
    }

    /// Point in front of the robot where files get sucked in.
    var mouthPosition: CGPoint {
        let r = robotSize / 2
        return CGPoint(x: pose.position.x + cos(pose.heading) * r * 0.7, y: pose.position.y + sin(pose.heading) * r * 0.7)
    }

    // MARK: Clock

    func startClock() {
        guard ticker == nil else { return }
        lastTick = CACurrentMediaTime()
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.tick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    func stopClock() {
        ticker?.invalidate()
        ticker = nil
    }

    private func tick() {
        let current = CACurrentMediaTime()
        let dt = max(0, current - lastTick)
        lastTick = current
        now = current

        var next = pose
        motion.update(&next, dt: dt)
        pose = next
        if next.state == .vacuuming {
            particles.attractor = mouthPosition
        }
        trail.record(pose: next, now: current)
        particles.update(dt: dt)
        frame &+= 1
        onTick?(next)
    }
}
