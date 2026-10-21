import Foundation

/// Robot animation states from the PRD.
enum RobotState: Equatable {
    case idle
    case deploying
    case driving
    case turning
    case approaching
    case vacuuming
    case avoiding
    case returning
    case completed
    case paused
    case blocked

    var displayName: String {
        switch self {
        case .idle: return "Ready"
        case .deploying: return "Deploying"
        case .driving: return "Driving"
        case .turning: return "Turning"
        case .approaching: return "Approaching"
        case .vacuuming: return "Vacuuming"
        case .avoiding: return "Avoiding"
        case .returning: return "Returning"
        case .completed: return "Done"
        case .paused: return "Paused"
        case .blocked: return "Blocked"
        }
    }
}

/// Everything the renderer needs to draw the robot for one frame.
struct RobotPose: Equatable {
    var position: CGPoint = .zero
    /// Radians, 0 = facing right, positive = clockwise (y grows downwards).
    var heading: CGFloat = 0
    var state: RobotState = .idle
    /// Points per second.
    var speed: CGFloat = 0
    /// 0…1 while vacuuming.
    var suctionProgress: CGFloat = 0
    /// Spinning lidar turret, radians.
    var lidarAngle: CGFloat = 0
    /// 0…1 while celebrating.
    var celebration: CGFloat = 0
    /// 1 right after an error, fades to 0.
    var errorFlash: CGFloat = 0
    /// Point the suction is aimed at, if any.
    var suctionTarget: CGPoint?
    var isVisible = false

    static func shortestAngle(from: CGFloat, to: CGFloat) -> CGFloat {
        var delta = (to - from).truncatingRemainder(dividingBy: 2 * .pi)
        if delta > .pi { delta -= 2 * .pi }
        if delta < -.pi { delta += 2 * .pi }
        return delta
    }
}
