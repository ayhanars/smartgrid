import AppKit
import Foundation
import RobovacCore

/// Bridges the cleaning engine and the robot animation. Implements the
/// engine's observer protocol: when the engine is about to move a file, the
/// director drives the robot there and plays the suction animation first.
/// The engine never depends on this class succeeding.
@MainActor
final class RobotSessionDirector: CleaningSessionObserver {
    private weak var appState: AppState?
    private let overlay: RobotOverlayController
    private let sound: SoundManager
    private let settings: RobovacSettings
    private let showsRobot: Bool

    private var positions: [UUID: CGPoint] = [:]
    private var planner: NavigationPlanner?
    private var region: CGRect = .zero
    private var roamArea: RobotMotionController.WanderArea?
    /// Where the robot parks: just below the menu bar icon.
    private var dockPoint: CGPoint = .zero
    /// Hidden behind the menu bar, straight above the dock point.
    private var hiddenPoint: CGPoint = .zero
    private var finished = false
    private var cancelled = false
    private(set) var iconPositionSource = "grid approximation"
    /// Serpentine coverage route and how far along it the robot is.
    private var patrolRoute: [CGPoint] = []
    private var patrolIndex = 0
    /// While entering or leaving the menu bar the motor fades slowly instead of following speed.
    private var motorOverride: (level: Double, ramp: TimeInterval)?
    private var random = SplitMix64(seed: UInt64(Date().timeIntervalSince1970))

    private var scene: RobotSceneModel { overlay.scene }
    private var robotSize: CGFloat { CGFloat(settings.appearance.robotSize) }
    private var isActive: Bool { showsRobot && overlay.isShowing && !finished }
    private var bounces: Bool { settings.appearance.movementPattern == .bounce }
    private var pattern: MovementPattern { settings.appearance.movementPattern }

    init(appState: AppState, overlay: RobotOverlayController, sound: SoundManager, settings: RobovacSettings) {
        self.appState = appState
        self.overlay = overlay
        self.sound = sound
        self.settings = settings
        self.showsRobot = settings.general.showDesktopRobot
    }

    // MARK: Setup

    /// Lays out the virtual desktop grid, plans the sweep and shows the overlay.
    /// Returns the plan with targets in driving order.
    func prepare(plan: CleaningPlan) -> CleaningPlan {
        guard showsRobot else {
            print("Robovac: desktop robot is disabled in Settings › General")
            return plan
        }
        guard let screen = overlay.targetScreen else {
            print("Robovac: no display found for the overlay")
            return plan
        }

        region = overlay.desktopRegion(on: screen)
        let layout = DesktopIconLayout(
            region: region,
            columnWidth: CGFloat(settings.appearance.iconGridColumnWidth),
            rowHeight: CGFloat(settings.appearance.iconGridRowHeight),
            arrangement: settings.appearance.iconArrangement
        )
        positions = layout.positions(for: plan.scannedItems)
        var rects = layout.rects(for: plan.scannedItems)
        iconPositionSource = "grid approximation"

        // Exact positions from Finder when allowed; the grid stays as the fallback.
        if settings.appearance.useFinderIconPositions, !plan.scannedItems.isEmpty {
            let result = FinderIconPositions.fetch()
            if let error = result.error {
                iconPositionSource = "grid approximation (Finder: \(error))"
                print("Robovac: Finder icon positions unavailable: \(error)")
            } else {
                var matched = 0
                let iconSize = CGFloat(min(settings.appearance.iconGridColumnWidth, settings.appearance.iconGridRowHeight)) * 0.7
                for item in plan.scannedItems {
                    guard let finderPoint = result.positions[item.name] ?? result.positions[item.name.precomposedStringWithCanonicalMapping] else { continue }
                    let point = FinderIconPositions.overlayPoint(finderPoint, on: screen)
                    positions[item.id] = point
                    rects[item.id] = CGRect(x: point.x - iconSize / 2, y: point.y - iconSize / 2, width: iconSize, height: iconSize)
                    matched += 1
                }
                iconPositionSource = "Finder (\(matched)/\(plan.scannedItems.count) icons matched)"
                print("Robovac: icon positions from Finder, \(matched) of \(plan.scannedItems.count) matched")
            }
        }

        // Excluded folders and files are zones the robot steers around.
        let obstacles: [CGRect] = plan.excluded.compactMap { decision in
            switch decision.exclusionReason {
            case .insideExcludedFolder, .excludedFile: return rects[decision.item.id]
            default: return nil
            }
        }

        let driveBounds = region.insetBy(dx: robotSize * 0.55, dy: robotSize * 0.55)
        let planner = NavigationPlanner(
            bounds: driveBounds,
            cellSize: max(12, robotSize * 0.4),
            laneWidth: CGFloat(settings.appearance.iconGridColumnWidth),
            obstacles: obstacles,
            clearance: robotSize * 0.55
        )
        self.planner = planner
        roamArea = RobotMotionController.WanderArea(bounds: driveBounds, obstacles: obstacles)

        let anchor = overlay.menuBarAnchor(on: screen)
        dockPoint = CGPoint(x: anchor.x, y: region.minY + robotSize * 0.75)
        hiddenPoint = CGPoint(x: anchor.x, y: region.minY - robotSize * 0.8)

        let targets: [NavigationTarget] = plan.targets.compactMap { target in
            guard let position = positions[target.id] else { return nil }
            return NavigationTarget(id: target.id, position: position)
        }
        let order = planner.orderTargets(targets).map { $0.id }
        patrolRoute = buildPatrolRoute(in: driveBounds)
        patrolIndex = 0

        configureScene()
        scene.resetEffects()
        scene.place(at: hiddenPoint, heading: .pi / 2, visible: true)
        overlay.show(on: screen, layer: settings.appearance.robotLayer)
        return plan.reordered(by: order)
    }

    private func configureScene() {
        let blipInterval: TimeInterval? = {
            let frequency = settings.sound.movementSoundFrequency
            guard settings.sound.isEnabled(.movement), frequency > 0.02 else { return nil }
            return 3.0 - 2.4 * frequency
        }()
        scene.configure(appearance: settings.appearance, gentle: settings.cleaning.mode.isGentle, movementBlipInterval: blipInterval)
        scene.skin = settings.appearance.robotSkin
        scene.motion.eventHandler = { [weak self] event in
            guard let self else { return }
            switch event {
            case .turnStarted: self.sound.play(.turn)
            case .movementBlip: self.sound.play(.movement)
            case .bumped: self.sound.play(.avoid)
            case .arrived, .vacuumFinished, .wanderEnded: break
            }
        }
        let motorEnabled = settings.sound.continuousMotorSound && settings.sound.isEnabled(.movement)
        let maxSpeed = max(1, scene.motion.maxSpeed)
        scene.onTick = { [weak self] pose in
            guard let self, motorEnabled else { return }
            if let override = self.motorOverride {
                self.sound.setMotorLevel(override.level, ramp: override.ramp)
                return
            }
            // A real robot hums from the moment it leaves the dock until it is back:
            // a steady floor, more with speed, a notch up while vacuuming.
            let level: Double
            switch pose.state {
            case .paused: level = 0
            case .vacuuming: level = 0.8
            default: level = pose.isVisible ? 0.35 + 0.65 * Double(min(1, pose.speed / maxSpeed)) : 0
            }
            self.sound.setMotorLevel(level)
        }
    }

    // MARK: CleaningSessionObserver

    func sessionDidStart(_ plan: CleaningPlan) async {
        sound.play(.start)
        guard isActive else { return }
        await deploy()
    }

    func sessionChooseNextTarget(from remaining: [CleaningTarget]) async -> CleaningTarget? {
        guard isActive, !cancelled, let area = roamArea else { return nil }
        let candidates: [(CleaningTarget, CGPoint)] = remaining.compactMap { target in
            guard let position = positions[target.id] else { return nil }
            return (target, position)
        }
        guard !candidates.isEmpty else { return nil }
        let sensorRange = robotSize * 1.4

        if pattern.isCoverage {
            // Follow the serpentine until a file is within reach of the mop; once the
            // whole desktop has been covered, go straight for whatever is left.
            await patrol { point in
                candidates.contains { hypot($0.1.x - point.x, $0.1.y - point.y) < sensorRange }
            }
            guard !cancelled else { return nil }
        } else if pattern == .bounce {
            // Roam until a file comes within sensor range; after the exploring time
            // give up and head for the nearest one so a run always finishes.
            let configured = max(0, settings.appearance.wanderSeconds)
            let budget: TimeInterval = settings.appearance.reducedMotion ? min(2, configured) : configured * (0.7 + Double(random.nextUnit()) * 0.6)
            if budget > 0.2 {
                await scene.motion.wander(in: area, maxDuration: budget) { point in
                    candidates.contains { hypot($0.1.x - point.x, $0.1.y - point.y) < sensorRange }
                }
            }
            guard !cancelled else { return nil }
        }

        let here = scene.pose.position
        let nearest = candidates.min { a, b in
            hypot(a.1.x - here.x, a.1.y - here.y) < hypot(b.1.x - here.x, b.1.y - here.y)
        }
        return nearest?.0
    }

    func sessionWillCollect(_ target: CleaningTarget, index: Int, total: Int) async {
        appState?.progressDidChange(currentFile: target.item.name)
        guard isActive, !cancelled, let destination = positions[target.id] else { return }
        let icon = NSWorkspace.shared.icon(forFile: target.item.url.path)
        await driveAndVacuum(at: destination, icon: icon)
    }

    func sessionDidCollect(_ target: CleaningTarget, result: Result<URL, MoveFailure>) async {
        switch result {
        case .success:
            if isActive, let destination = positions[target.id] {
                scene.collected(at: destination)
            }
            sound.play(.collect)
        case .failure(let failure):
            if isActive {
                scene.flashError()
                // A short pause makes the refusal readable before driving on.
                await scene.motion.hold(duration: failure.isSkip ? 0.35 : 0.6, state: .blocked)
            }
            sound.play(.error)
        }
        if let appState {
            await appState.refreshProgressFromCoordinator()
        }
    }

    func sessionDidChangeState(_ state: CleaningCoordinator.State) async {
        switch state {
        case .paused:
            scene.motion.setPaused(true)
            sound.stopAll()
            sound.setMotorLevel(0)
        case .running:
            scene.motion.setPaused(false)
        case .cancelling:
            cancelled = true
            scene.motion.setPaused(false)
            scene.motion.abort()
        case .idle, .finished:
            break
        }
        appState?.coordinatorStateDidChange(state)
    }

    func sessionDidFinish(_ summary: CleaningSummary) async {
        guard isActive else {
            finished = true
            if summary.status == .completed { sound.play(.complete) }
            return
        }
        scene.motion.setPaused(false)
        await returnHome(celebrate: summary.status == .completed)
        finished = true
        overlay.hide()
        sound.setMotorLevel(0)
    }

    /// Stops any animation immediately (used when the app quits mid-run).
    func tearDown() {
        finished = true
        cancelled = true
        scene.motion.abort()
        scene.onTick = nil
        sound.setMotorLevel(0)
        overlay.hide()
    }

    // MARK: Rehearsal

    /// Drives the robot around without touching a single file: deploys from the
    /// menu bar, roams, "collects" a few imaginary files and returns. Used by the
    /// Test Drive button so the overlay can be checked and tuned safely.
    func rehearse() async {
        let configuration = CleaningConfiguration(settings: settings)
        let emptyPlan = CleaningPlan(configuration: configuration, createdAt: Date(), scannedItems: [], targets: [], excluded: [])
        _ = prepare(plan: emptyPlan)
        guard isActive, let area = roamArea else { return }

        sound.play(.start)
        await deploy()

        let inner = area.bounds.insetBy(dx: robotSize, dy: robotSize)
        let wanderBudget = min(5, max(0, settings.appearance.wanderSeconds))
        for _ in 0..<3 {
            guard !cancelled else { break }
            let target = CGPoint(
                x: inner.minX + CGFloat(random.nextUnit()) * inner.width,
                y: inner.minY + CGFloat(random.nextUnit()) * inner.height
            )
            let sensorRange = robotSize * 1.4
            if pattern.isCoverage {
                await patrol { point in hypot(target.x - point.x, target.y - point.y) < sensorRange }
            } else if bounces, wanderBudget > 0.2 {
                await scene.motion.wander(in: area, maxDuration: wanderBudget) { point in
                    hypot(target.x - point.x, target.y - point.y) < sensorRange
                }
            }
            guard !cancelled else { break }
            await driveAndVacuum(at: target, icon: nil)
            guard !cancelled else { break }
            scene.collected(at: target)
            sound.play(.collect)
            await scene.motion.hold(duration: 0.2, state: .driving)
        }
        await returnHome(celebrate: !cancelled)
        finished = true
        overlay.hide()
        sound.setMotorLevel(0)
    }

    // MARK: Choreography

    /// Drops out of the menu bar and settles just below it.
    private func deploy() async {
        scene.place(at: hiddenPoint, heading: .pi / 2, visible: true)
        // Motor swells in gently as the robot emerges from the menu bar.
        sound.setMotorLevel(0.02, ramp: 0.05)
        motorOverride = (0.45, 1.6)
        await scene.motion.travel(along: [hiddenPoint, dockPoint], purpose: .deploy)
        guard !cancelled else { motorOverride = nil; return }
        await scene.motion.hold(duration: settings.appearance.reducedMotion ? 0.1 : 0.35, state: .idle)
        motorOverride = nil
    }

    private func driveAndVacuum(at destination: CGPoint, icon: NSImage?) async {
        guard let planner else { return }
        let waypoints = planner.route(from: scene.pose.position, to: approachPoint(for: destination))
        if waypoints.count > 2 { sound.play(.avoid) }
        await scene.motion.travel(along: waypoints, purpose: .collect)
        guard !finished, !cancelled else { return }

        // Face the file, then vacuum it.
        let heading = atan2(destination.y - scene.pose.position.y, destination.x - scene.pose.position.x)
        await scene.motion.travel(along: [scene.pose.position, nudge(scene.pose.position, toward: heading)], purpose: .collect)
        guard !finished, !cancelled else { return }

        let duration = settings.appearance.reducedMotion ? 0.3 : (settings.cleaning.mode.isGentle ? 1.9 : 1.4)
        scene.beginSuction(at: destination, icon: icon, duration: duration)
        sound.play(.suction)
        await scene.motion.vacuum(duration: duration)
    }

    /// Drives back under the menu bar icon and slips up behind the menu bar.
    private func returnHome(celebrate: Bool) async {
        guard let planner else { return }
        let home = planner.route(from: scene.pose.position, to: dockPoint)
        await scene.motion.travel(along: home, purpose: .returnHome)
        if celebrate {
            scene.celebrate()
            sound.play(.complete)
            await scene.motion.hold(duration: settings.appearance.reducedMotion ? 0.3 : 1.2, state: .completed)
        }
        // Motor winds down as the robot slips back under the menu bar.
        motorOverride = (0, 1.8)
        await scene.motion.travel(along: [scene.pose.position, hiddenPoint], purpose: .exit)
        await scene.motion.hold(duration: 0.6, state: .idle)
        motorOverride = nil
    }

    // MARK: Coverage route

    /// Vertical serpentine lanes across the desktop, starting at the right edge
    /// (near the dock) and working left; lane spacing comes from the pattern.
    private func buildPatrolRoute(in bounds: CGRect) -> [CGPoint] {
        guard let factor = pattern.laneSpacingFactor else { return [] }
        let spacing = max(16, robotSize * 0.88 * CGFloat(factor))
        var route: [CGPoint] = []
        var x = bounds.maxX
        var downwards = true
        while x >= bounds.minX - 0.5 {
            let top = CGPoint(x: x, y: bounds.minY)
            let bottom = CGPoint(x: x, y: bounds.maxY)
            route.append(downwards ? top : bottom)
            route.append(downwards ? bottom : top)
            downwards.toggle()
            x -= spacing
        }
        return route
    }

    /// Drives the remaining part of the serpentine until `found` is true for the
    /// robot's position. Resumes where it left off on the next call.
    private func patrol(until found: @escaping (CGPoint) -> Bool) async {
        guard !patrolRoute.isEmpty, patrolIndex < patrolRoute.count else { return }
        if found(scene.pose.position) { return }
        let remaining = Array(patrolRoute[patrolIndex...])
        let waypoints = [scene.pose.position] + remaining
        let completed = await scene.motion.travel(along: waypoints, purpose: .collect, stopWhen: found)
        if completed {
            patrolIndex = patrolRoute.count
        } else {
            // Find the lane segment the robot was on and resume towards its end,
            // so no part of the desktop gets driven twice.
            let here = scene.pose.position
            var bestEnd = patrolIndex
            var bestDistance = CGFloat.greatestFiniteMagnitude
            var previous = waypoints[0]
            for index in patrolIndex..<patrolRoute.count {
                let end = patrolRoute[index]
                let distance = RobotSessionDirector.distance(from: here, toSegment: previous, end)
                if distance < bestDistance { bestDistance = distance; bestEnd = index }
                previous = end
            }
            patrolIndex = min(patrolRoute.count - 1, bestEnd)
        }
    }

    // MARK: Geometry helpers

    private static func distance(from p: CGPoint, toSegment a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = b.x - a.x, dy = b.y - a.y
        let lengthSquared = dx * dx + dy * dy
        guard lengthSquared > 0.001 else { return hypot(p.x - a.x, p.y - a.y) }
        let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
        return hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
    }

    /// Stop a little short of the icon so the mouth, not the body, covers it.
    private func approachPoint(for destination: CGPoint) -> CGPoint {
        let from = scene.pose.position
        let dx = destination.x - from.x
        let dy = destination.y - from.y
        let distance = max(1, (dx * dx + dy * dy).squareRoot())
        let standoff = min(distance * 0.5, robotSize * 0.55)
        return CGPoint(x: destination.x - dx / distance * standoff, y: destination.y - dy / distance * standoff)
    }

    private func nudge(_ point: CGPoint, toward heading: CGFloat) -> CGPoint {
        CGPoint(x: point.x + cos(heading) * 2, y: point.y + sin(heading) * 2)
    }
}
