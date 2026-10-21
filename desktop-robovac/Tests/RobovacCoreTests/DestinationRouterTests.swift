import XCTest
@testable import RobovacCore

final class DestinationRouterTests: XCTestCase {
    func testDefaultDestinationGetsDatedSessionFolder() {
        let base = URL(fileURLWithPath: "/tmp/Cleanups", isDirectory: true)
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let router = DestinationRouter(rules: DestinationRules(defaultDestination: base), sessionDate: date)
        let url = router.destinationDirectory(for: .other)
        XCTAssertEqual(url.deletingLastPathComponent().path, base.path)
        XCTAssertEqual(url.lastPathComponent, router.sessionFolderName)
        XCTAssertTrue(url.lastPathComponent.hasPrefix("20"))
    }

    func testCategoryDestinationBypassesSessionFolder() {
        let base = URL(fileURLWithPath: "/tmp/Cleanups", isDirectory: true)
        let shots = URL(fileURLWithPath: "/tmp/Pictures/Screenshots", isDirectory: true)
        let rules = DestinationRules(defaultDestination: base, categoryDestinations: [.screenshot: shots])
        let router = DestinationRouter(rules: rules)
        XCTAssertEqual(router.destinationDirectory(for: .screenshot).path, shots.path)
        XCTAssertNotEqual(router.destinationDirectory(for: .pdf).path, shots.path)
    }

    func testSessionFoldersCanBeDisabled() {
        let base = URL(fileURLWithPath: "/tmp/Cleanups", isDirectory: true)
        let router = DestinationRouter(rules: DestinationRules(defaultDestination: base, useDatedSessionFolders: false))
        XCTAssertEqual(router.destinationDirectory(for: .pdf).path, base.path)
    }
}
