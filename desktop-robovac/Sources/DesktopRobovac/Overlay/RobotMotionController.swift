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
    }

    enum Purpose: Equatable {
        case deploy
        case collect
        case returnHome
        case exit
    }

    private enum Command {
        case none
        case travel(waypoints: [CGPoint], index: Int, purpose: Purpose, detour: Bool)
        case vacuum(remaining: TimeInterval, total: TimeInterval)
        case hold(remaining: TimeInterval, state: RobotState)
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
    private var errorFlashClock: TimeInterval = 0

    var isBusy: Bool {
        if case .none = command { return false }
        return true
    }

    // MARK: Commands

    func travel(along waypoints: [CGPoint], purpose: Purpose) async {
        guard waypoints.count >= 2 else { return }
        finishCurrent()
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            self.command = .travel(waypoints: waypoints, index: 1, purpose: purpose, detour: waypoints.count > 2)
        }
    }

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
            if pose.state == .paused || pose.state == .turning || pose.state == .driving {
                pose.state = .idle
            }
            pose.speed = 0
            pose.lidarAngle += CGFloat(dt) * 0.8
        case .travel(let waypoints, let index, let purpose, let detour):
            advance(&pose, waypoints: waypoints, index: index, purpose: purpose, detour: detour, dt: dt)
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
        }
    }

    private func advance(_ pose: inout RobotPose, waypoints: [CGPoint], index: Int, purpose: Purpose, detour: Bool, dt: TimeInterval) {
        guard index < waypoints.count else {
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
                stepWaypoint(waypoints: waypoints, index: index, purpose: purpose, detour: detour, pose: &pose)
            }
            return
        }

        if distance < 1.5 {
            pose.position = target
            stepWaypoint(waypoints: waypoints, index: index, purpose: purpose, detour: detour, pose: &pose)
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
            stepWaypoint(waypoints: waypoints, index: index, purpose: purpose, detour: detour, pose: &pose)
        }
    }

    private func stateWhileDriving(purpose: Purpose, detour: Bool, remaining: CGFloat) -> RobotState {
        switch purpose {
        case .deploy: return .deploying
        case .exit, .returnHome: return .returning
        case .collect:
            if remaining < approachDistance { return .approaching }
            return detour ? .avoiding : .driving
        }
    }

    private func stepWaypoint(waypoints: [CGPoint], index: Int, purpose: Purpose, detour: Bool, pose: inout RobotPose) {
        let next = index + 1
        if next >= waypoints.count {
            arrive(&pose, purpose: purpose)
        } else {
            command = .travel(waypoints: waypoints, index: next, purpose: purpose, detour: detour)
        }
    }

    private func arrive(_ pose: inout RobotPose, purpose: Purpose) {
        pose.speed = 0
        switch purpose {
        case .collect: pose.state = .approaching
        case .deploy: pose.state = .idle
        case .returnHome: pose.state = .completed
        case .exit: pose.state = .idle
        }
        finishCurrent()
        eventHandler?(.arrived(purpose))
    }
}
