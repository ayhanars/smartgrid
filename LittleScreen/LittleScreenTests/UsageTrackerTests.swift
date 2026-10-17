import XCTest
@testable import LittleScreen

@MainActor
final class UsageTrackerTests: XCTestCase {
    private var clock = Date(timeIntervalSince1970: 1_700_000_000)
    private var suiteName = ""
    private var defaults: UserDefaults!

    override func setUp() async throws {
        suiteName = "UsageTrackerTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() async throws {
        defaults.removePersistentDomain(forName: suiteName)
    }

    private func makeTracker() -> UsageTracker {
        UsageTracker(defaults: defaults, calendar: Calendar(identifier: .gregorian)) { [self] in clock }
    }

    func testOffByDefault() {
        let tracker = makeTracker()
        XCTAssertEqual(tracker.limitMinutes, 0)
        XCTAssertFalse(tracker.isLimitEnabled)
        XCTAssertFalse(tracker.isLimitReached)
        XCTAssertNil(tracker.remainingSeconds)
        for _ in 0..<500 { tracker.tick() }
        XCTAssertFalse(tracker.isLimitReached)
    }

    func testLimitIsReachedAfterEnoughPlayback() {
        let tracker = makeTracker()
        tracker.limitMinutes = 1
        for _ in 0..<59 { tracker.tick() }
        XCTAssertFalse(tracker.isLimitReached)
        XCTAssertEqual(tracker.remainingSeconds, 1)
        tracker.tick()
        XCTAssertTrue(tracker.isLimitReached)
        XCTAssertEqual(tracker.remainingSeconds, 0)
    }

    func testBonusMinutesExtendToday() {
        let tracker = makeTracker()
        tracker.limitMinutes = 1
        for _ in 0..<60 { tracker.tick() }
        XCTAssertTrue(tracker.isLimitReached)
        tracker.addBonus(minutes: 15)
        XCTAssertFalse(tracker.isLimitReached)
        XCTAssertEqual(tracker.remainingSeconds, 15 * 60)
    }

    func testResetTodayClearsCountAndBonus() {
        let tracker = makeTracker()
        tracker.limitMinutes = 1
        for _ in 0..<30 { tracker.tick() }
        tracker.addBonus(minutes: 5)
        tracker.resetToday()
        XCTAssertEqual(tracker.secondsToday, 0)
        XCTAssertEqual(tracker.bonusSecondsToday, 0)
        XCTAssertEqual(tracker.remainingSeconds, 60)
    }

    func testRollsOverOnANewDay() {
        let tracker = makeTracker()
        tracker.limitMinutes = 1
        for _ in 0..<60 { tracker.tick() }
        tracker.addBonus(minutes: 1)
        XCTAssertEqual(tracker.secondsToday, 60)

        clock = clock.addingTimeInterval(24 * 60 * 60)
        tracker.rolloverIfNeeded()

        XCTAssertEqual(tracker.secondsToday, 0)
        XCTAssertEqual(tracker.bonusSecondsToday, 0)
        XCTAssertFalse(tracker.isLimitReached)
        XCTAssertEqual(tracker.limitMinutes, 1, "the limit itself is not daily state")
    }

    func testPersistsAcrossInstances() {
        let tracker = makeTracker()
        tracker.limitMinutes = 30
        for _ in 0..<25 { tracker.tick() }
        tracker.persist()

        let restarted = makeTracker()
        XCTAssertEqual(restarted.limitMinutes, 30)
        XCTAssertEqual(restarted.secondsToday, 25)
    }

    func testDayKeyAndFormatting() {
        let calendar = Calendar(identifier: .gregorian)
        let key = UsageTracker.key(for: clock, calendar: calendar)
        XCTAssertEqual(key.count, 10)
        XCTAssertEqual(UsageTracker.formatMinutes(0), "Off")
        XCTAssertEqual(UsageTracker.formatMinutes(45), "45 min")
        XCTAssertEqual(UsageTracker.formatMinutes(60), "1 hour")
        XCTAssertEqual(UsageTracker.formatMinutes(90), "1 h 30 min")
        XCTAssertEqual(UsageTracker.formatMinutes(120), "2 hours")
    }
}
