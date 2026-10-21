import XCTest
@testable import RobovacCore

final class NavigationPlannerTests: XCTestCase {
    let bounds = CGRect(x: 0, y: 0, width: 1440, height: 860)

    func target(_ x: CGFloat, _ y: CGFloat) -> NavigationTarget {
        NavigationTarget(id: UUID(), position: CGPoint(x: x, y: y))
    }

    func testSweepOrderGoesLaneByLaneFromTheRightAlternatingDirection() {
        let planner = NavigationPlanner(bounds: bounds, laneWidth: 100)
        let a = target(1400, 100)   // lane 0, top
        let b = target(1400, 500)   // lane 0, bottom
        let c = target(1300, 100)   // lane 1, top
        let d = target(1300, 500)   // lane 1, bottom
        let e = target(200, 300)    // far left lane
        let ordered = planner.orderTargets([e, d, b, c, a]).map { $0.id }
        XCTAssertEqual(ordered, [a.id, b.id, d.id, c.id, e.id])
    }

    func testStraightLineWhenNothingIsInTheWay() {
        let planner = NavigationPlanner(bounds: bounds, obstacles: [CGRect(x: 1000, y: 600, width: 100, height: 100)])
        let route = planner.route(from: CGPoint(x: 100, y: 100), to: CGPoint(x: 500, y: 120))
        XCTAssertEqual(route.count, 2)
    }

    func testRouteDetoursAroundObstacle() {
        let obstacle = CGRect(x: 600, y: 300, width: 200, height: 200)
        let planner = NavigationPlanner(bounds: bounds, cellSize: 20, obstacles: [obstacle], clearance: 20)
        let route = planner.route(from: CGPoint(x: 100, y: 400), to: CGPoint(x: 1300, y: 400))
        XCTAssertGreaterThan(route.count, 2, "a straight line would cross the obstacle")
        XCTAssertEqual(route.first, CGPoint(x: 100, y: 400))
        XCTAssertEqual(route.last, CGPoint(x: 1300, y: 400))
        for i in 1..<route.count {
            XCTAssertTrue(planner.segmentIsClear(route[i - 1], route[i]), "segment \(i) crosses the obstacle")
        }
    }

    func testPlanVisitsEveryTargetAndReturnsHome() {
        let planner = NavigationPlanner(bounds: bounds)
        let targets = (0..<6).map { i in target(1400 - CGFloat(i) * 150, 100 + CGFloat(i) * 90) }
        let home = CGPoint(x: 1400, y: 820)
        let plan = planner.plan(start: home, targets: targets, parking: home)
        XCTAssertEqual(plan.legs.count, targets.count + 1)
        XCTAssertEqual(Set(plan.visitingOrder), Set(targets.map { $0.id }))
        XCTAssertEqual(plan.legs.last?.kind, .returnHome)
        XCTAssertEqual(plan.legs.last?.destination, home)
        XCTAssertGreaterThan(plan.totalLength, 0)
    }

    func testPlanIsDeterministic() {
        let planner = NavigationPlanner(bounds: bounds, obstacles: [CGRect(x: 700, y: 400, width: 120, height: 120)])
        let targets = (0..<8).map { i in target(1350 - CGFloat(i % 3) * 110, 80 + CGFloat(i) * 95) }
        let first = planner.plan(start: .zero, targets: targets, parking: .zero)
        let second = planner.plan(start: .zero, targets: targets, parking: .zero)
        XCTAssertEqual(first, second)
    }

    func testIconLayoutFillsColumnsFromTopRight() {
        let region = CGRect(x: 0, y: 25, width: 1440, height: 800)
        let layout = DesktopIconLayout(region: region, columnWidth: 100, rowHeight: 100, arrangement: .name)
        let items = ["a.txt", "b.txt", "c.txt"].map { makeItem($0) }
        let positions = layout.positions(for: items)
        let a = positions[items[0].id]!
        let b = positions[items[1].id]!
        XCTAssertEqual(a.x, b.x, accuracy: 0.001)
        XCTAssertLessThan(a.y, b.y)
        XCTAssertGreaterThan(a.x, region.midX)
        XCTAssertEqual(layout.rowsPerColumn, 7)
        // Slot 7 wraps to the next column on the left.
        XCTAssertLessThan(layout.slotCenter(at: 7).x, layout.slotCenter(at: 0).x)
        XCTAssertEqual(layout.slotCenter(at: 7).y, layout.slotCenter(at: 0).y, accuracy: 0.001)
    }

    func testIconLayoutDateAddedOrderPutsOldestFirst() {
        let region = CGRect(x: 0, y: 0, width: 800, height: 600)
        let layout = DesktopIconLayout(region: region, arrangement: .dateAdded)
        let old = makeItem("old.txt", added: Date(timeIntervalSince1970: 1))
        let new = makeItem("new.txt", added: Date(timeIntervalSince1970: 2))
        let ordered = layout.ordered([new, old]).map { $0.name }
        XCTAssertEqual(ordered, ["old.txt", "new.txt"])
    }
}
