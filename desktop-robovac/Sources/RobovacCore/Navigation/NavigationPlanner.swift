import Foundation
#if canImport(CoreGraphics)
import CoreGraphics
#endif

/// A screen-space location the robot should visit.
public struct NavigationTarget: Identifiable, Hashable, Sendable {
    public let id: UUID
    public let position: CGPoint

    public init(id: UUID, position: CGPoint) {
        self.id = id
        self.position = position
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
        hasher.combine(position.x)
        hasher.combine(position.y)
    }

    public static func == (lhs: NavigationTarget, rhs: NavigationTarget) -> Bool {
        lhs.id == rhs.id && lhs.position == rhs.position
    }
}

/// One stretch of the route.
public struct RouteLeg: Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        case travel(targetID: UUID)
        case returnHome
    }

    public let kind: Kind
    /// Starts at the robot's position and ends at the destination.
    public let waypoints: [CGPoint]

    public init(kind: Kind, waypoints: [CGPoint]) {
        self.kind = kind
        self.waypoints = waypoints
    }

    public var destination: CGPoint { waypoints.last ?? .zero }

    /// True when the planner had to steer around an obstacle.
    public var detours: Bool { waypoints.count > 2 }

    public var length: CGFloat {
        guard waypoints.count > 1 else { return 0 }
        var total: CGFloat = 0
        for i in 1..<waypoints.count {
            total += NavigationPlanner.distance(waypoints[i - 1], waypoints[i])
        }
        return total
    }
}

public struct RoutePlan: Equatable, Sendable {
    public let legs: [RouteLeg]

    public init(legs: [RouteLeg]) { self.legs = legs }

    public var totalLength: CGFloat { legs.reduce(0) { $0 + $1.length } }

    /// Target IDs in visiting order.
    public var visitingOrder: [UUID] {
        legs.compactMap { leg in
            if case .travel(let id) = leg.kind { return id }
            return nil
        }
    }
}

/// Plans the robot's path across the desktop: a systematic lane-by-lane sweep
/// through the file targets, with grid-based detours around excluded zones.
/// Deterministic: the same inputs always produce the same route.
public struct NavigationPlanner: Sendable {
    /// Usable desktop area in the overlay's coordinate space (origin top-left).
    public var bounds: CGRect
    /// Resolution of the obstacle grid used for detours.
    public var cellSize: CGFloat
    /// Width of one sweep lane. Finder arranges desktop icons in columns from the
    /// right edge, so lanes are vertical and swept right to left.
    public var laneWidth: CGFloat
    /// Rectangles the robot must route around (excluded folders, for example).
    public var obstacles: [CGRect]
    /// Extra clearance kept from obstacles, normally half the robot's size.
    public var clearance: CGFloat

    public init(bounds: CGRect, cellSize: CGFloat = 24, laneWidth: CGFloat = 104, obstacles: [CGRect] = [], clearance: CGFloat = 32) {
        self.bounds = bounds
        self.cellSize = max(4, cellSize)
        self.laneWidth = max(8, laneWidth)
        self.obstacles = obstacles
        self.clearance = clearance
    }

    // MARK: Ordering

    /// Orders targets into a boustrophedon sweep: lanes from the right edge
    /// leftwards, alternating top-to-bottom and bottom-to-top, so the robot
    /// never doubles back needlessly.
    public func orderTargets(_ targets: [NavigationTarget]) -> [NavigationTarget] {
        guard !targets.isEmpty else { return [] }
        var lanes: [Int: [NavigationTarget]] = [:]
        for target in targets {
            let lane = Int(((bounds.maxX - target.position.x) / laneWidth).rounded(.down))
            lanes[max(0, lane), default: []].append(target)
        }
        var ordered: [NavigationTarget] = []
        var downwards = true
        for lane in lanes.keys.sorted() {
            let members = lanes[lane]!.sorted { a, b in
                if a.position.y != b.position.y { return a.position.y < b.position.y }
                if a.position.x != b.position.x { return a.position.x > b.position.x }
                return a.id.uuidString < b.id.uuidString
            }
            ordered.append(contentsOf: downwards ? members : members.reversed())
            downwards.toggle()
        }
        return ordered
    }

    // MARK: Routing

    /// Builds the full route: a leg per target in sweep order, then a leg back to `parking`.
    public func plan(start: CGPoint, targets: [NavigationTarget], parking: CGPoint) -> RoutePlan {
        var legs: [RouteLeg] = []
        var position = start
        for target in orderTargets(targets) {
            let waypoints = route(from: position, to: target.position)
            legs.append(RouteLeg(kind: .travel(targetID: target.id), waypoints: waypoints))
            position = target.position
        }
        legs.append(RouteLeg(kind: .returnHome, waypoints: route(from: position, to: parking)))
        return RoutePlan(legs: legs)
    }

    /// Straight line when it is clear, otherwise a shortest grid path around the
    /// obstacles, simplified so the robot drives smooth diagonals instead of stairs.
    public func route(from start: CGPoint, to goal: CGPoint) -> [CGPoint] {
        let start = clamp(start)
        let goal = clamp(goal)
        if obstacles.isEmpty || segmentIsClear(start, goal) {
            return [start, goal]
        }
        guard let cells = gridPath(from: start, to: goal) else {
            return [start, goal]
        }
        var points = [start] + cells.dropFirst().dropLast().map(center) + [goal]
        points = simplify(points)
        return points
    }

    // MARK: Geometry

    private var inflatedObstacles: [CGRect] {
        obstacles.map { $0.insetBy(dx: -clearance, dy: -clearance) }
    }

    func isBlocked(_ point: CGPoint) -> Bool {
        for rect in inflatedObstacles where rect.contains(point) { return true }
        return false
    }

    func segmentIsClear(_ a: CGPoint, _ b: CGPoint) -> Bool {
        let length = NavigationPlanner.distance(a, b)
        let step = max(2, cellSize / 3)
        let samples = max(1, Int((length / step).rounded(.up)))
        for i in 0...samples {
            let t = CGFloat(i) / CGFloat(samples)
            let point = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
            if isBlocked(point) { return false }
        }
        return true
    }

    private func clamp(_ point: CGPoint) -> CGPoint {
        CGPoint(
            x: min(max(point.x, bounds.minX), bounds.maxX),
            y: min(max(point.y, bounds.minY), bounds.maxY)
        )
    }

    private struct Cell: Hashable {
        let column: Int
        let row: Int
    }

    private var columns: Int { max(1, Int((bounds.width / cellSize).rounded(.up))) }
    private var rows: Int { max(1, Int((bounds.height / cellSize).rounded(.up))) }

    private func cell(for point: CGPoint) -> Cell {
        let column = Int(((point.x - bounds.minX) / cellSize).rounded(.down))
        let row = Int(((point.y - bounds.minY) / cellSize).rounded(.down))
        return Cell(column: min(max(column, 0), columns - 1), row: min(max(row, 0), rows - 1))
    }

    private func center(_ cell: Cell) -> CGPoint {
        CGPoint(
            x: bounds.minX + (CGFloat(cell.column) + 0.5) * cellSize,
            y: bounds.minY + (CGFloat(cell.row) + 0.5) * cellSize
        )
    }

    /// Breadth-first search over the grid. Start and goal cells are always passable.
    private func gridPath(from start: CGPoint, to goal: CGPoint) -> [Cell]? {
        let startCell = cell(for: start)
        let goalCell = cell(for: goal)
        if startCell == goalCell { return [startCell, goalCell] }

        var cameFrom: [Cell: Cell] = [:]
        var visited: Set<Cell> = [startCell]
        var queue: [Cell] = [startCell]
        var head = 0
        let neighbours = [(1, 0), (-1, 0), (0, 1), (0, -1)]

        while head < queue.count {
            let current = queue[head]
            head += 1
            if current == goalCell { break }
            for (dc, dr) in neighbours {
                let next = Cell(column: current.column + dc, row: current.row + dr)
                guard next.column >= 0, next.column < columns, next.row >= 0, next.row < rows else { continue }
                guard !visited.contains(next) else { continue }
                if next != goalCell, isBlocked(center(next)) { continue }
                visited.insert(next)
                cameFrom[next] = current
                queue.append(next)
            }
        }
        guard visited.contains(goalCell) else { return nil }

        var path = [goalCell]
        var cursor = goalCell
        while let previous = cameFrom[cursor] {
            path.append(previous)
            cursor = previous
        }
        return path.reversed()
    }

    /// Greedy line-of-sight simplification ("string pulling").
    private func simplify(_ points: [CGPoint]) -> [CGPoint] {
        guard points.count > 2 else { return points }
        var result = [points[0]]
        var anchor = 0
        while anchor < points.count - 1 {
            var furthest = anchor + 1
            var candidate = anchor + 2
            while candidate < points.count {
                if segmentIsClear(points[anchor], points[candidate]) {
                    furthest = candidate
                }
                candidate += 1
            }
            result.append(points[furthest])
            anchor = furthest
        }
        return result
    }

    public static func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = a.x - b.x
        let dy = a.y - b.y
        return (dx * dx + dy * dy).squareRoot()
    }
}
