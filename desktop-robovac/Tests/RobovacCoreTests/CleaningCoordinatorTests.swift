import XCTest
@testable import RobovacCore

/// Records observer calls and can hold the robot "in transit" so tests can
/// pause or cancel mid-run.
final class RecordingObserver: CleaningSessionObserver, @unchecked Sendable {
    var started = 0
    var collected: [String] = []
    var results: [Result<URL, MoveFailure>] = []
    var states: [CleaningCoordinator.State] = []
    var finished: CleaningSummary?
    var holdDuringTravel: ((CleaningTarget) async -> Void)?

    func sessionDidStart(_ plan: CleaningPlan) async { started += 1 }
    func sessionWillCollect(_ target: CleaningTarget, index: Int, total: Int) async {
        collected.append(target.item.name)
        await holdDuringTravel?(target)
    }
    func sessionDidCollect(_ target: CleaningTarget, result: Result<URL, MoveFailure>) async { results.append(result) }
    func sessionDidChangeState(_ state: CleaningCoordinator.State) async { states.append(state) }
    func sessionDidFinish(_ summary: CleaningSummary) async { finished = summary }
}

final class CleaningCoordinatorTests: XCTestCase {
    var desktop: TemporaryDesktop!
    var history: CleaningHistoryStore!

    override func setUpWithError() throws {
        desktop = try TemporaryDesktop()
        history = CleaningHistoryStore.inMemory()
    }

    override func tearDown() {
        desktop.tearDown()
        try? FileManager.default.removeItem(at: history.fileURL)
    }

    func configuration(mode: CleaningMode = .smartClean, rules: ExclusionRules = ExclusionRules()) -> CleaningConfiguration {
        CleaningConfiguration(
            desktopURL: desktop.desktop,
            mode: mode,
            rules: rules,
            destinations: DestinationRules(defaultDestination: desktop.destination, useDatedSessionFolders: false)
        )
    }

    func testPlanSeparatesEligibleAndExcludedItems() throws {
        try desktop.makeFile("Screenshot 2026-10-21 at 1.00.00.png")
        try desktop.makeFile("report.pdf")
        try desktop.makeFile("site.webloc")
        try desktop.makeFolder("Project")
        let rules = ExclusionRules(excludedExtensions: ["webloc"])
        let plan = try CleaningPlanner(configuration: configuration(rules: rules)).makePlan()
        XCTAssertEqual(plan.scannedItems.count, 4)
        XCTAssertEqual(Set(plan.targets.map { $0.item.name }), ["Screenshot 2026-10-21 at 1.00.00.png", "report.pdf"])
        XCTAssertEqual(plan.countsByCategory[.screenshot], 1)
        XCTAssertEqual(plan.countsByCategory[.pdf], 1)
        XCTAssertEqual(plan.excluded.count, 2)
        XCTAssertEqual(plan.destinationDirectories.map { $0.path }, [desktop.destination.path])
    }

    func testHeadlessRunMovesFilesAndRecordsHistory() async throws {
        try desktop.makeFile("a.pdf")
        try desktop.makeFile("b.png")
        let plan = try CleaningPlanner(configuration: configuration()).makePlan()
        let coordinator = CleaningCoordinator(history: history)
        let summary = try await coordinator.run(plan: plan)

        XCTAssertEqual(summary.status, .completed)
        XCTAssertEqual(summary.movedCount, 2)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: desktop.desktop.path).count, 0)
        XCTAssertEqual(Set(try FileManager.default.contentsOfDirectory(atPath: desktop.destination.path)), ["a.pdf", "b.png"])

        let stored = try XCTUnwrap(history.session(id: summary.session.id))
        XCTAssertEqual(stored.status, .completed)
        XCTAssertEqual(stored.moves.count, 2)
        XCTAssertTrue(stored.canUndo)
        let state = await coordinator.state
        XCTAssertEqual(state, .finished)
    }

    func testObserverIsCalledForEveryTargetAndFileMovesOnlyAfterCollect() async throws {
        try desktop.makeFile("one.txt")
        try desktop.makeFile("two.txt")
        let plan = try CleaningPlanner(configuration: configuration()).makePlan()
        let observer = RecordingObserver()
        let desktopURL = desktop.desktop
        observer.holdDuringTravel = { target in
            // While the robot is "driving", the file must still be on the Desktop.
            XCTAssertTrue(FileManager.default.fileExists(atPath: desktopURL.appendingPathComponent(target.item.name).path))
        }
        let coordinator = CleaningCoordinator(history: history, observer: observer)
        let summary = try await coordinator.run(plan: plan)
        XCTAssertEqual(observer.started, 1)
        XCTAssertEqual(observer.collected, ["one.txt", "two.txt"])
        XCTAssertEqual(observer.results.count, 2)
        XCTAssertEqual(observer.finished?.movedCount, 2)
        XCTAssertEqual(summary.movedCount, 2)
    }

    func testFileRemovedDuringRunIsSkippedNotFailed() async throws {
        try desktop.makeFile("stays.txt")
        let vanishing = try desktop.makeFile("vanishes.txt")
        let plan = try CleaningPlanner(configuration: configuration()).makePlan()
        let observer = RecordingObserver()
        observer.holdDuringTravel = { target in
            if target.item.name == "vanishes.txt" { try? FileManager.default.removeItem(at: vanishing) }
        }
        let coordinator = CleaningCoordinator(history: history, observer: observer)
        let summary = try await coordinator.run(plan: plan)
        XCTAssertEqual(summary.movedCount, 1)
        XCTAssertEqual(summary.skippedCount, 1)
        XCTAssertEqual(summary.failedCount, 0)
        XCTAssertEqual(summary.session.skipped.first?.fileName, "vanishes.txt")
    }

    func testCancelDuringTravelStopsBeforeMovingThatFile() async throws {
        try desktop.makeFile("first.txt")
        try desktop.makeFile("second.txt")
        let plan = try CleaningPlanner(configuration: configuration()).makePlan()
        let observer = RecordingObserver()
        let coordinator = CleaningCoordinator(history: history, observer: observer)
        observer.holdDuringTravel = { target in
            if target.item.name == "second.txt" { await coordinator.cancel() }
        }
        let summary = try await coordinator.run(plan: plan)
        XCTAssertEqual(summary.status, .cancelled)
        XCTAssertEqual(summary.movedCount, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: desktop.desktop.appendingPathComponent("second.txt").path))
        XCTAssertEqual(history.session(id: summary.session.id)?.status, .cancelled)
    }

    func testPauseHoldsTheNextMoveUntilResumed() async throws {
        try desktop.makeFile("first.txt")
        try desktop.makeFile("second.txt")
        let plan = try CleaningPlanner(configuration: configuration()).makePlan()
        let observer = RecordingObserver()
        let coordinator = CleaningCoordinator(history: history, observer: observer)
        observer.holdDuringTravel = { target in
            if target.item.name == "second.txt" { await coordinator.pause() }
        }
        let runTask = Task { try await coordinator.run(plan: plan) }

        // Wait until the coordinator reports it is paused.
        var paused = false
        for _ in 0..<200 {
            if await coordinator.state == .paused { paused = true; break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertTrue(paused)
        XCTAssertTrue(FileManager.default.fileExists(atPath: desktop.desktop.appendingPathComponent("second.txt").path))

        await coordinator.resume()
        let summary = try await runTask.value
        XCTAssertEqual(summary.status, .completed)
        XCTAssertEqual(summary.movedCount, 2)
        XCTAssertTrue(observer.states.contains(.paused))
    }

    func testRunningTwiceConcurrentlyIsRejected() async throws {
        try desktop.makeFile("a.txt")
        let plan = try CleaningPlanner(configuration: configuration()).makePlan()
        let observer = RecordingObserver()
        let coordinator = CleaningCoordinator(history: history, observer: observer)
        observer.holdDuringTravel = { _ in
            do {
                _ = try await coordinator.run(plan: plan)
                XCTFail("second run should be rejected")
            } catch {
                XCTAssertEqual(error as? CleaningError, .alreadyRunning)
            }
        }
        _ = try await coordinator.run(plan: plan)
    }

    func testUndoRestoresFilesAndReportsConflicts() async throws {
        try desktop.makeFile("a.txt", contents: "A")
        try desktop.makeFile("b.txt", contents: "B")
        let plan = try CleaningPlanner(configuration: configuration()).makePlan()
        let summary = try await CleaningCoordinator(history: history).run(plan: plan)

        // Something new appears where b.txt used to be.
        try "intruder".data(using: .utf8)!.write(to: desktop.desktop.appendingPathComponent("b.txt"))

        let undo = UndoService(history: history)
        let session = try XCTUnwrap(history.session(id: summary.session.id))
        let report = undo.undo(session: session, onConflict: .skip)
        XCTAssertEqual(report.restored.map { $0.fileName }, ["a.txt"])
        XCTAssertEqual(report.conflicts.map { $0.record.fileName }, ["b.txt"])
        XCTAssertEqual(report.conflicts.first?.failure, .originalOccupied)
        XCTAssertEqual(try String(contentsOf: desktop.desktop.appendingPathComponent("b.txt"), encoding: .utf8), "intruder")

        // Second pass with renaming resolves the conflict without overwriting.
        let remaining = try XCTUnwrap(history.session(id: summary.session.id))
        XCTAssertEqual(remaining.restorableMoves.map { $0.fileName }, ["b.txt"])
        let second = undo.undo(session: remaining, onConflict: .restoreWithUniqueName)
        XCTAssertTrue(second.isComplete)
        XCTAssertTrue(FileManager.default.fileExists(atPath: desktop.desktop.appendingPathComponent("b 2.txt").path))
        XCTAssertNil(history.lastUndoableSession)
    }

    func testInterruptedSessionsAreMarkedOnNextLaunch() throws {
        history.upsert(CleaningSession(mode: .smartClean, status: .running))
        let reloaded = CleaningHistoryStore(fileURL: history.fileURL)
        let changed = reloaded.markRunningSessionsInterrupted()
        XCTAssertEqual(changed.count, 1)
        XCTAssertEqual(reloaded.sessions.first?.status, .interrupted)
    }

    func testHistoryRoundTripsThroughDisk() throws {
        // History stores dates with millisecond precision.
        var session = CleaningSession(startedAt: Date(timeIntervalSince1970: 1_700_000_000.25), mode: .screenshotSweep)
        session.moves.append(MoveRecord(
            fileName: "x.png", originalPath: "/a/x.png", destinationPath: "/b/x.png",
            category: .screenshot, timestamp: Date(timeIntervalSince1970: 1_700_000_001.5)
        ))
        session.status = .completed
        history.upsert(session)
        let reloaded = CleaningHistoryStore(fileURL: history.fileURL)
        XCTAssertEqual(reloaded.sessions, [session])
    }
}
