import CoreGraphics
import Foundation

/// Moves the robot along planned paths with acceleration, deceleration and
/// pivot turns. Commands are awaited by the session director, so the file
/// engine only continues once the robot really has arrived.
@MainActor
final class RobotMotionController {
    enum Event {
        case turnStarted
        case movementBlip
        case arrived(Purpose)
        case vacuumFinished
        case bumped
        case wanderEnded(found: Bool)
        case patrolStopped
    }

    /// Where the robot may roam while bouncing around.
    struct WanderArea {
        var bounds: CGRect
        var obstacles: [CGRect]
    }

    enum Purpose: Equatable {
        case deploy
        case collect
        /// A coverage lane: plain driving, never shown as a detour.
        case patrol
        case returnHome
        case exit
    }

    private struct WanderRun {
        var area: WanderArea
        var elapsed: TimeInterval = 0
        var maxDuration: TimeInterval
        /// Seconds left before the robot makes a spontaneous course change.
        var segmentRemaining: TimeInterval
        /// Heading the robot is pivoting towards, if it is mid-turn.
        var pivotTarget: CGFloat?
        var shouldStop: (CGPoint) -> Bool
    }

    private enum Command {
        case none
        case travel(waypoints: [CGPoint], index: Int, purpose: Purpose, detour: Bool, stopWhen: ((CGPoint) -> Bool)?)
        case vacuum(remaining: TimeInterval, total: TimeInterval)
        case hold(remaining: TimeInterval, state: RobotState)
        case wander(WanderRun)
    }

    var maxSpeed: CGFloat = 260
    var acceleration: CGFloat = 480
    var deceleration: CGFloat = 520
    var turnRate: CGFloat = .pi * 1.7
    var minSpeed: CGFloat = 36
    var approachDistance: CGFloat = 90
    var cornerSpeed: CGFloat = 110
    /// Seconds between motor blips while driving; nil disables them.
    var blipInterval: TimeInterval?
    var reducedMotion = false

    var eventHandler: ((Event) -> Void)?
    private(set) var isPaused = false

    private var command: Command = .none
    private var continuation: CheckedContinuation<Void, Never>?
    private var blipClock: TimeInterval = 0
    private var random = SplitMix64(seed: UInt64(Date().timeIntervalSince1970 * 1000))
    /// Robot radius, used to keep the body inside the wander area.
    var bodyRadius: CGFloat = 32

    var isBusy: Bool {
        if case .none = command { return false }
        return true
    }

    // MARK: Commands

    /// Drives along `waypoints`. With `stopWhen`, the trip ends early as soon as the
    /// predicate is true for the robot's position (a patrol that found a file).
    /// Returns true when the whole path was driven, false when stopped or aborted.
    @discardableResult
    func travel(along waypoints: [CGPoint], purpose: Purpose, stopWhen: ((CGPoint) -> Bool)? = nil) async -> Bool {
        guard waypoints.count >= 2 else { return true }
        finishCurrent()
        travelCompleted = false
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            self.command = .travel(waypoints: waypoints, index: 1, purpose: purpose, detour: waypoints.count > 2, stopWhen: stopWhen)
        }
        return travelCompleted
    }

    private var travelCompleted = false

    func vacuum(duration: TimeInterval) async {
        finishCurrent()
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            self.command = .vacuum(remaining: duration, total: duration)
        }
    }

    func hold(duration: TimeInterval, state: RobotState) async {
        finishCurrent()
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            self.command = .hold(remaining: duration, state: state)
        }
    }

    /// Roams in straight runs, bouncing off the edges and obstacles with a random
    /// new heading, until `shouldStop` says the robot has found something or
    /// `maxDuration` runs out. Returns true when stopped by `shouldStop`.
    @discardableResult
    func wander(in area: WanderArea, maxDuration: TimeInterval, shouldStop: @escaping (CGPoint) -> Bool) async -> Bool {
        finishCurrent()
        wanderFound = false
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            self.command = .wander(WanderRun(
                area: area,
                maxDuration: maxDuration,
                segmentRemaining: nextSegmentDuration(),
                shouldStop: shouldStop
            ))
        }
        return wanderFound
    }

    private var wanderFound = false

    private func nextSegmentDuration() -> TimeInterval {
        1.2 + random.nextUnit() * 2.6
    }

    private func randomJitter(_ magnitude: CGFloat) -> CGFloat {
        CGFloat(random.nextUnit() * 2 - 1) * magnitude
    }

    /// Cancels whatever is in progress and releases the waiter.
    func abort() {
        finishCurrent()
    }

    func setPaused(_ paused: Bool) {
        isPaused = paused
    }

    func teleport(_ pose: inout RobotPose, to point: CGPoint, heading: CGFloat) {
        pose.position = point
        pose.heading = heading
        pose.speed = 0
    }

    private func finishCurrent() {
        command = .none
        let waiter = continuation
        continuation = nil
        waiter?.resume()
    }

    // MARK: Simulation

    func update(_ pose: inout RobotPose, dt: TimeInterval) {
        let dt = min(dt, 1.0 / 20.0)
        pose.errorFlash = max(0, pose.errorFlash - CGFloat(dt) * 2.2)
        pose.celebration = max(0, pose.celebration - CGFloat(dt) * 0.8)

        if isPaused {
            pose.state = .paused
            pose.speed = 0
            return
        }

        switch command {
        case .none:
            if pose.state == .paused || pose.state == .turning || pose.state == .driving || pose.state == .avoiding {
                pose.state = .idle
            }
            pose.speed = 0
            pose.lidarAngle += CGFloat(dt) * 0.8
        case .travel(let waypoints, let index, let purpose, let detour, let stopWhen):
            if let stopWhen, stopWhen(pose.position) {
                pose.state = .approaching
                finishCurrent()
                eventHandler?(.patrolStopped)
                return
            }
            advance(&pose, waypoints: waypoints, index: index, purpose: purpose, detour: detour, stopWhen: stopWhen, dt: dt)
        case .vacuum(let remaining, let total):
            pose.state = .vacuuming
            pose.speed = 0
            pose.lidarAngle += CGFloat(dt) * 9
            let left = remaining - dt
            pose.suctionProgress = CGFloat(1 - max(0, left) / total)
            if left <= 0 {
                pose.suctionProgress = 1
                pose.suctionTarget = nil
                finishCurrent()
                eventHandler?(.vacuumFinished)
                pose.suctionProgress = 0
            } else {
                command = .vacuum(remaining: left, total: total)
            }
        case .hold(let remaining, let state):
            pose.state = state
            pose.speed = 0
            pose.lidarAngle += CGFloat(dt) * (state == .completed ? 14 : 0.8)
            let left = remaining - dt
            if left <= 0 {
                finishCurrent()
            } else {
                command = .hold(remaining: left, state: state)
            }
        case .wander(let run):
            roam(&pose, run: run, dt: dt)
        }
    }

    // MARK: Wandering

    private func roam(_ pose: inout RobotPose, run: WanderRun, dt: TimeInterval) {
        var run = run
        run.elapsed += dt
        pose.lidarAngle += CGFloat(dt) * 5

        if run.shouldStop(pose.position) {
            wanderFound = true
            pose.state = .approaching
            finishCurrent()
            eventHandler?(.wanderEnded(found: true))
            return
        }
        if run.elapsed >= run.maxDuration {
            finishCurrent()
            eventHandler?(.wanderEnded(found: false))
            return
        }

        // Mid-pivot: rotate in place until aligned, then drive on.
        if let target = run.pivotTarget {
            let delta = RobotPose.shortestAngle(from: pose.heading, to: target)
            let step = min(abs(delta), turnRate * CGFloat(dt))
            pose.heading += step * (delta > 0 ? 1 : -1)
            pose.speed = max(0, pose.speed - deceleration * CGFloat(dt))
            pose.state = .turning
            if abs(delta) <= step + 0.001 {
                pose.heading = target
                run.pivotTarget = nil
            }
            command = .wander(run)
            return
        }

        // Look a little ahead; bounce when the next stretch would leave the area.
        let lookAhead = bodyRadius + 10 + pose.speed * 0.12
        let ahead = CGPoint(x: pose.position.x + cos(pose.heading) * lookAhead, y: pose.position.y + sin(pose.heading) * lookAhead)
        let inner = run.area.bounds.insetBy(dx: bodyRadius, dy: bodyRadius)
        var bounceHeading: CGFloat?
        if ahead.x < inner.minX || ahead.x > inner.maxX {
            bounceHeading = .pi - pose.heading
        } else if ahead.y < inner.minY || ahead.y > inner.maxY {
            bounceHeading = -pose.heading
        } else if run.area.obstacles.contains(where: { $0.insetBy(dx: -bodyRadius, dy: -bodyRadius).contains(ahead) }) {
            bounceHeading = pose.heading + .pi
        }

        if let bounce = bounceHeading {
            // Already stuck inside? Push back towards the centre instead of oscillating.
            var heading = bounce + randomJitter(0.6)
            if !inner.contains(pose.position) {
                heading = atan2(inner.midY - pose.position.y, inner.midX - pose.position.x) + randomJitter(0.5)
            }
            run.pivotTarget = normalized(heading)
            run.segmentRemaining = nextSegmentDuration()
            pose.speed = min(pose.speed, minSpeed)
            eventHandler?(.turnStarted)
            eventHandler?(.bumped)
            command = .wander(run)
            return
        }

        // Spontaneous course change, like a vacuum probing the room.
        run.segmentRemaining -= dt
        if run.segmentRemaining <= 0 {
            run.pivotTarget = normalized(pose.heading + randomJitter(1.1) + (random.nextUnit() < 0.5 ? 0.5 : -0.5))
            run.segmentRemaining = nextSegmentDuration()
            eventHandler?(.turnStarted)
            command = .wander(run)
            return
        }

        // Cruise.
        let cruise = reducedMotion ? maxSpeed * 1.6 : maxSpeed * 0.85
        if pose.speed < cruise {
            pose.speed = min(cruise, pose.speed + acceleration * CGFloat(dt))
        } else {
            pose.speed = max(cruise, pose.speed - deceleration * CGFloat(dt))
        }
        let step = pose.speed * CGFloat(dt)
        pose.position.x += cos(pose.heading) * step
        pose.position.y += sin(pose.heading) * step
        pose.position.x = min(max(pose.position.x, run.area.bounds.minX), run.area.bounds.maxX)
        pose.position.y = min(max(pose.position.y, run.area.bounds.minY), run.area.bounds.maxY)
        pose.state = .driving

        if let interval = blipInterval, pose.speed > minSpeed {
            blipClock += dt
            if blipClock >= interval {
                blipClock = 0
                eventHandler?(.movementBlip)
            }
        }
        command = .wander(run)
    }

    private func normalized(_ angle: CGFloat) -> CGFloat {
        var a = angle.truncatingRemainder(dividingBy: 2 * .pi)
        if a > .pi { a -= 2 * .pi }
        if a < -.pi { a += 2 * .pi }
        return a
    }

    private func advance(_ pose: inout RobotPose, waypoints: [CGPoint], index: Int, purpose: Purpose, detour: Bool, stopWhen: ((CGPoint) -> Bool)?, dt: TimeInterval) {
        guard index < waypoints.count else {
            travelCompleted = true
            arrive(&pose, purpose: purpose)
            return
        }
        let target = waypoints[index]
        let dx = target.x - pose.position.x
        let dy = target.y - pose.position.y
        let distance = (dx * dx + dy * dy).squareRoot()

        if reducedMotion {
            // Reduced motion: no pivots or easing, just a brisk straight glide.
            let step = min(distance, CGFloat(dt) * maxSpeed * 2.5)
            if distance > 0.5 {
                pose.heading = atan2(dy, dx)
                pose.position.x += dx / distance * step
                pose.position.y += dy / distance * step
            }
            pose.state = stateWhileDriving(purpose: purpose, detour: detour, remaining: distance)
            if distance - step < 1 {
                pose.position = target
                stepWaypoint(waypoints: waypoints, index: index, purpose: purpose, detour: detour, stopWhen: stopWhen, pose: &pose)
            }
            return
        }

        if distance < 1.5 {
            pose.position = target
            stepWaypoint(waypoints: waypoints, index: index, purpose: purpose, detour: detour, stopWhen: stopWhen, pose: &pose)
            return
        }

        let desiredHeading = atan2(dy, dx)
        let delta = RobotPose.shortestAngle(from: pose.heading, to: desiredHeading)
        let isLastLeg = index == waypoints.count - 1
        var remaining = distance
        if !isLastLeg {
            for i in index..<(waypoints.count - 1) {
                remaining += hypot(waypoints[i + 1].x - waypoints[i].x, waypoints[i + 1].y - waypoints[i].y)
            }
        }

        // Pivot in place when the robot has to turn sharply.
        if abs(delta) > 0.14, pose.speed < minSpeed + 1 {
            if pose.state != .turning {
                pose.state = .turning
                eventHandler?(.turnStarted)
            }
            let step = min(abs(delta), turnRate * CGFloat(dt))
            pose.heading += step * (delta > 0 ? 1 : -1)
            pose.speed = max(0, pose.speed - deceleration * CGFloat(dt))
            pose.lidarAngle += CGFloat(dt) * 6
            return
        }

        // Gentle steering while moving.
        let steer = min(abs(delta), turnRate * 0.7 * CGFloat(dt))
        pose.heading += steer * (delta > 0 ? 1 : -1)

        // Speed profile: brake for sharp turns, corners and the final stop.
        var targetSpeed = maxSpeed
        if abs(delta) > 0.6 {
            targetSpeed = 0
        } else {
            let stoppingSpeed = (2 * deceleration * remaining).squareRoot()
            targetSpeed = min(targetSpeed, max(minSpeed, stoppingSpeed))
            if !isLastLeg, distance < 60 {
                targetSpeed = min(targetSpeed, cornerSpeed)
            }
        }
        if pose.speed < targetSpeed {
            pose.speed = min(targetSpeed, pose.speed + acceleration * CGFloat(dt))
        } else {
            pose.speed = max(targetSpeed, pose.speed - deceleration * CGFloat(dt))
        }

        let step = min(distance, pose.speed * CGFloat(dt))
        pose.position.x += dx / distance * step
        pose.position.y += dy / distance * step
        pose.lidarAngle += CGFloat(dt) * (4 + pose.speed / 40)
        pose.state = stateWhileDriving(purpose: purpose, detour: detour, remaining: remaining)

        if let interval = blipInterval, pose.speed > minSpeed {
            blipClock += dt
            if blipClock >= interval {
                blipClock = 0
                eventHandler?(.movementBlip)
            }
        }

        if distance - step < 1 {
            pose.position = target
            stepWaypoint(waypoints: waypoints, index: index, purpose: purpose, detour: detour, stopWhen: stopWhen, pose: &pose)
        }
    }

    private func stateWhileDriving(purpose: Purpose, detour: Bool, remaining: CGFloat) -> RobotState {
        switch purpose {
        case .deploy: return .deploying
        case .exit, .returnHome: return .returning
        case .patrol: return .driving
        case .collect:
            if remaining < approachDistance { return .approaching }
            return detour ? .avoiding : .driving
        }
    }

    private func stepWaypoint(waypoints: [CGPoint], index: Int, purpose: Purpose, detour: Bool, stopWhen: ((CGPoint) -> Bool)?, pose: inout RobotPose) {
        let next = index + 1
        if next >= waypoints.count {
            travelCompleted = true
            arrive(&pose, purpose: purpose)
        } else {
            command = .travel(waypoints: waypoints, index: next, purpose: purpose, detour: detour, stopWhen: stopWhen)
        }
    }

    private func arrive(_ pose: inout RobotPose, purpose: Purpose) {
        pose.speed = 0
        switch purpose {
        case .collect: pose.state = .approaching
        case .patrol: pose.state = .driving
        case .deploy: pose.state = .idle
        case .returnHome: pose.state = .completed
        case .exit: pose.state = .idle
        }
        finishCurrent()
        eventHandler?(.arrived(purpose))
    }
}
