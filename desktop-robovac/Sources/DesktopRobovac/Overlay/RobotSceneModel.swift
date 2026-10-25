import AppKit
import Combine
import Foundation
import QuartzCore
import SwiftUI
import RobovacCore

/// Observable state for the overlay: the robot pose, trail, particles and the
/// animation clock that advances them. One instance per overlay.
@MainActor
final class RobotSceneModel: NSObject, ObservableObject {
    @Published private(set) var pose = RobotPose()
    @Published private(set) var frame: Int = 0

    /// The file being sucked in: its real icon (or a paper sheet) flying into the intake.
    struct SuctionSprite {
        var icon: NSImage?
        var origin: CGPoint
        var startTime: TimeInterval
        var duration: TimeInterval
        var size: CGFloat
    }
    private(set) var sprite: SuctionSprite?

    let motion = RobotMotionController()
    let trail = TrailRenderer()
    let particles = ParticleSystem()

    private(set) var appearance = AppearanceSettings()
    private(set) var isGentle = false
    var skin: RobotSkin = .light
    private var ticker: Timer?
    private var displayLink: CADisplayLink?
    private var lastTick: CFTimeInterval = 0
    /// Static robot artwork (shadow, body, bumper, turret base) rendered once per size and skin.
    private(set) var bodyImage: Image?
    private var bodyImageKey: String = ""
    private(set) var now: TimeInterval = 0
    /// Called after every simulation step with the new pose (used for the motor sound).
    var onTick: ((RobotPose) -> Void)?
    /// Called after every step so the overlay can move its views.
    var onFrame: (() -> Void)?

    /// Publishes at half the frame rate: the trail only dries slowly, so its
    /// (larger) view is redrawn every other frame.
    final class TrailClock: ObservableObject {
        @Published var revision: Int = 0
        /// Top-left of the trail view in overlay coordinates.
        var origin: CGPoint = .zero
    }
    let trailClock = TrailClock()

    /// Top-left of the robot's own small view in overlay coordinates.
    private(set) var robotHostOrigin: CGPoint = .zero
    /// Side of the robot's view: room for the intake sprite and the dust around it.
    var robotHostSide: CGFloat { (robotSize * 3.4).rounded(.up) }
    /// Backing scale used to pixel-align the moving view.
    var backingScale: CGFloat = 2

    /// Frame pacing, for diagnostics: how many frames were simulated and how many
    /// took longer than 25 ms since the previous one.
    private(set) var frameCount = 0
    private(set) var slowFrameCount = 0
    private(set) var longestFrame: TimeInterval = 0

    var robotSize: CGFloat { CGFloat(appearance.robotSize) }

    func configure(appearance: AppearanceSettings, gentle: Bool, movementBlipInterval: TimeInterval?) {
        self.appearance = appearance
        self.isGentle = gentle
        skin = appearance.robotSkin
        rebuildBodyImage()
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

    func beginSuction(at target: CGPoint, icon: NSImage?, duration: TimeInterval) {
        pose.suctionTarget = target
        particles.attractor = mouthPosition
        particles.spawnDust(at: target, radius: robotSize * 0.5)
        sprite = SuctionSprite(icon: icon, origin: target, startTime: now, duration: max(0.2, duration), size: max(robotSize * 0.95, 72))
    }

    func collected(at target: CGPoint) {
        particles.spawnBurst(at: mouthPosition)
        particles.attractor = nil
        sprite = nil
    }

    func flashError() {
        pose.errorFlash = 1
        pose.state = .blocked
        particles.attractor = nil
        sprite = nil
    }

    func celebrate() {
        pose.celebration = 1
        particles.spawnSparkles(around: pose.position, radius: robotSize * 0.7)
    }

    func resetEffects() {
        trail.reset()
        particles.reset()
        sprite = nil
    }

    /// Point in front of the robot where files get sucked in.
    var mouthPosition: CGPoint {
        let r = robotSize / 2
        return CGPoint(x: pose.position.x + cos(pose.heading) * r * 0.7, y: pose.position.y + sin(pose.heading) * r * 0.7)
    }

    // MARK: Body cache

    /// Renders the static part of the robot once, at the screen's scale, so each
    /// frame only draws the moving parts on top of a bitmap.
    func rebuildBodyImage() {
        let key = "\(skin.rawValue)-\(Int(robotSize))"
        guard key != bodyImageKey else { return }
        bodyImageKey = key
        let size = robotSize
        let skin = self.skin
        let canvasSize = size * RobotPainter.bodyImageScale
        let renderer = ImageRenderer(content:
            Canvas { context, _ in
                RobotPainter.drawStaticBody(size: size, skin: skin, center: CGPoint(x: canvasSize / 2, y: canvasSize / 2), in: context)
            }
            .frame(width: canvasSize, height: canvasSize)
        )
        renderer.scale = NSScreen.main?.backingScaleFactor ?? 2
        if let nsImage = renderer.nsImage {
            bodyImage = Image(nsImage: nsImage)
        }
    }

    // MARK: Clock

    /// Ticks in step with the display's refresh; falls back to a timer.
    func startClock(on view: NSView? = nil) {
        guard ticker == nil, displayLink == nil else { return }
        lastTick = CACurrentMediaTime()
        if let view {
            let link = view.displayLink(target: self, selector: #selector(displayLinkFired))
            link.add(to: .main, forMode: .common)
            displayLink = link
        } else {
            let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in self?.tick() }
            }
            RunLoop.main.add(timer, forMode: .common)
            ticker = timer
        }
    }

    func stopClock() {
        ticker?.invalidate()
        ticker = nil
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func displayLinkFired(_ link: CADisplayLink) {
        tick()
    }

    private func tick() {
        let current = CACurrentMediaTime()
        let dt = max(0, current - lastTick)
        lastTick = current
        now = current

        if frameCount > 0 {
            longestFrame = max(longestFrame, dt)
            if dt > 0.025 { slowFrameCount += 1 }
        }
        frameCount += 1

        var next = pose
        motion.update(&next, dt: dt)
        if next.state == .vacuuming {
            particles.attractor = CGPoint(x: next.position.x + cos(next.heading) * robotSize / 2 * 0.7, y: next.position.y + sin(next.heading) * robotSize / 2 * 0.7)
        }
        trail.record(pose: next, now: current)
        particles.update(dt: dt)

        // Keep the robot view pixel-aligned and centred on the robot.
        let half = robotHostSide / 2
        let scale = max(1, backingScale)
        robotHostOrigin = CGPoint(
            x: (next.position.x * scale).rounded() / scale - half,
            y: (next.position.y * scale).rounded() / scale - half
        )

        pose = next
        frame &+= 1
        if frame % 2 == 0 { trailClock.revision &+= 1 }
        onTick?(next)
        onFrame?()
    }

    func resetFrameStats() {
        frameCount = 0
        slowFrameCount = 0
        longestFrame = 0
    }
}
