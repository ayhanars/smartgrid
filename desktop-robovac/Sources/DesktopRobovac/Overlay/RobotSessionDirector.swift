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
    private var parking: CGPoint = .zero
    private var offscreenEntry: CGPoint = .zero
    private var finished = false
    private var cancelled = false

    private var scene: RobotSceneModel { overlay.scene }
    private var robotSize: CGFloat { CGFloat(settings.appearance.robotSize) }

    init(appState: AppState, overlay: RobotOverlayController, sound: SoundManager, settings: RobovacSettings) {
        self.appState = appState
        self.overlay = overlay
        self.sound = sound
        self.settings = settings
        self.showsRobot = settings.general.showDesktopRobot
    }

    /// Lays out the virtual desktop grid, plans the sweep and shows the overlay.
    /// Returns the plan with targets in driving order.
    func prepare(plan: CleaningPlan) -> CleaningPlan {
        guard showsRobot, let screen = overlay.targetScreen else { return plan }

        region = overlay.desktopRegion(on: screen)
        let layout = DesktopIconLayout(
            region: region,
            columnWidth: CGFloat(settings.appearance.iconGridColumnWidth),
            rowHeight: CGFloat(settings.appearance.iconGridRowHeight),
            arrangement: settings.appearance.iconArrangement
        )
        positions = layout.positions(for: plan.scannedItems)
        let rects = layout.rects(for: plan.scannedItems)

        // Excluded folders and files are zones the robot steers around.
        let obstacles: [CGRect] = plan.excluded.compactMap { decision in
            switch decision.exclusionReason {
            case .insideExcludedFolder, .excludedFile: return rects[decision.item.id]
            default: return nil
            }
        }

        let planner = NavigationPlanner(
            bounds: region.insetBy(dx: robotSize * 0.55, dy: robotSize * 0.55),
            cellSize: max(12, robotSize * 0.4),
            laneWidth: CGFloat(settings.appearance.iconGridColumnWidth),
            obstacles: obstacles,
            clearance: robotSize * 0.55
        )
        self.planner = planner

        parking = CGPoint(x: region.minX + robotSize * 0.9, y: region.maxY - robotSize * 0.9)
        offscreenEntry = CGPoint(x: region.minX - robotSize * 1.5, y: parking.y)

        let targets: [NavigationTarget] = plan.targets.compactMap { target in
            guard let position = positions[target.id] else { return nil }
            return NavigationTarget(id: target.id, position: position)
        }
        let order = planner.orderTargets(targets).map { $0.id }

        let blipInterval: TimeInterval? = {
            let frequency = settings.sound.movementSoundFrequency
            guard settings.sound.isEnabled(.movement), frequency > 0.02 else { return nil }
            return 2.4 - 2.0 * frequency
        }()
        scene.configure(appearance: settings.appearance, gentle: settings.cleaning.mode.isGentle, movementBlipInterval: blipInterval)
        scene.motion.eventHandler = { [weak self] event in
            guard let self else { return }
            switch event {
            case .turnStarted: self.sound.play(.turn)
            case .movementBlip: self.sound.play(.movement)
            case .arrived, .vacuumFinished: break
            }
        }
        scene.resetEffects()
        scene.place(at: offscreenEntry, heading: 0, visible: true)
        overlay.show(on: screen)
        return plan.reordered(by: order)
    }

    // MARK: CleaningSessionObserver

    func sessionDidStart(_ plan: CleaningPlan) async {
        sound.play(.start)
        guard showsRobot, overlay.isShowing else { return }
        await scene.motion.travel(along: [offscreenEntry, parking], purpose: .deploy)
    }

    func sessionWillCollect(_ target: CleaningTarget, index: Int, total: Int) async {
        appState?.progressDidChange(currentFile: target.item.name)
        guard showsRobot, overlay.isShowing, let planner, let destination = positions[target.id] else { return }

        let waypoints = planner.route(from: scene.pose.position, to: approachPoint(for: destination))
        if waypoints.count > 2 { sound.play(.avoid) }
        await scene.motion.travel(along: waypoints, purpose: .collect)
        guard !finished, !cancelled else { return }

        // Face the file, then vacuum it.
        let heading = atan2(destination.y - scene.pose.position.y, destination.x - scene.pose.position.x)
        await scene.motion.travel(along: [scene.pose.position, nudge(scene.pose.position, toward: heading)], purpose: .collect)
        guard !finished, !cancelled else { return }

        scene.beginSuction(at: destination)
        sound.play(.suction)
        let duration: TimeInterval = settings.cleaning.mode.isGentle ? 1.5 : 0.9
        await scene.motion.vacuum(duration: settings.appearance.reducedMotion ? 0.25 : duration)
    }

    func sessionDidCollect(_ target: CleaningTarget, result: Result<URL, MoveFailure>) async {
        switch result {
        case .success:
            if showsRobot, overlay.isShowing, let destination = positions[target.id] {
                scene.collected(at: destination)
            }
            sound.play(.collect)
        case .failure(let failure):
            if showsRobot, overlay.isShowing {
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
        finished = true
        guard showsRobot, overlay.isShowing, let planner else {
            if summary.status == .completed { sound.play(.complete) }
            return
        }
        scene.motion.setPaused(false)
        let home = planner.route(from: scene.pose.position, to: parking)
        await scene.motion.travel(along: home, purpose: .returnHome)
        if summary.status == .completed {
            scene.celebrate()
            sound.play(.complete)
            await scene.motion.hold(duration: settings.appearance.reducedMotion ? 0.3 : 1.2, state: .completed)
        }
        await scene.motion.travel(along: [scene.pose.position, offscreenEntry], purpose: .exit)
        overlay.hide()
    }

    /// Stops any animation immediately (used when the app quits mid-run).
    func tearDown() {
        finished = true
        scene.motion.abort()
        overlay.hide()
    }

    // MARK: Geometry helpers

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
