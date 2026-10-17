import XCTest
@testable import LittleScreen

final class PINHasherTests: XCTestCase {
    func testVerifyAcceptsCorrectAndRejectsWrongPIN() {
        let record = PINHasher.makeRecord(pin: "1234", iterations: 10)
        XCTAssertTrue(PINHasher.verify(pin: "1234", against: record))
        XCTAssertFalse(PINHasher.verify(pin: "1235", against: record))
        XCTAssertFalse(PINHasher.verify(pin: "", against: record))
    }

    func testSameSaltSamePINIsDeterministic() {
        let salt = Data(repeating: 7, count: 16)
        XCTAssertEqual(
            PINHasher.hash(pin: "0000", salt: salt, iterations: 3),
            PINHasher.hash(pin: "0000", salt: salt, iterations: 3)
        )
        XCTAssertNotEqual(
            PINHasher.hash(pin: "0000", salt: salt, iterations: 3),
            PINHasher.hash(pin: "0000", salt: salt, iterations: 4)
        )
    }

    func testRecordsUseDifferentSalts() {
        let a = PINHasher.makeRecord(pin: "4321", iterations: 2)
        let b = PINHasher.makeRecord(pin: "4321", iterations: 2)
        XCTAssertNotEqual(a.salt, b.salt)
        XCTAssertNotEqual(a.hash, b.hash)
    }
}

final class LockoutPolicyTests: XCTestCase {
    func testNoLockBeforeFreeAttemptsAreUsed() {
        let policy = LockoutPolicy(freeAttempts: 5, baseDelay: 30, maxDelay: 900)
        XCTAssertNil(policy.lockDuration(afterFailures: 0))
        XCTAssertNil(policy.lockDuration(afterFailures: 4))
    }

    func testLockDoublesAndCaps() {
        let policy = LockoutPolicy(freeAttempts: 5, baseDelay: 30, maxDelay: 900)
        XCTAssertEqual(policy.lockDuration(afterFailures: 5), 30)
        XCTAssertEqual(policy.lockDuration(afterFailures: 6), 60)
        XCTAssertEqual(policy.lockDuration(afterFailures: 7), 120)
        XCTAssertEqual(policy.lockDuration(afterFailures: 50), 900)
    }
}

@MainActor
final class PINManagerTests: XCTestCase {
    private var clock = Date(timeIntervalSince1970: 1_000_000)

    private func makeManager(store: SecretStore = InMemorySecretStore()) -> PINManager {
        PINManager(store: store, policy: LockoutPolicy(freeAttempts: 3, baseDelay: 10, maxDelay: 60), iterations: 5) { [self] in clock }
    }

    func testValidation() {
        XCTAssertTrue(PINManager.isValidPIN("1234"))
        XCTAssertTrue(PINManager.isValidPIN("123456"))
        XCTAssertFalse(PINManager.isValidPIN("123"))
        XCTAssertFalse(PINManager.isValidPIN("1234567"))
        XCTAssertFalse(PINManager.isValidPIN("12a4"))
        XCTAssertFalse(PINManager.isValidPIN("١٢٣٤"))
    }

    func testNotSetUntilAPINIsStored() throws {
        let manager = makeManager()
        XCTAssertFalse(manager.isPINSet)
        XCTAssertEqual(manager.verify("1234"), .notSet)
        try manager.setPIN("1234")
        XCTAssertTrue(manager.isPINSet)
        XCTAssertEqual(manager.verify("1234"), .success)
    }

    func testWrongAttemptsCountDownThenLock() throws {
        let manager = makeManager()
        try manager.setPIN("2468")
        XCTAssertEqual(manager.verify("0000"), .wrong(remainingBeforeLock: 2))
        XCTAssertEqual(manager.verify("0000"), .wrong(remainingBeforeLock: 1))
        XCTAssertEqual(manager.verify("0000"), .locked(until: clock.addingTimeInterval(10)))
        // Correct PIN is refused while locked.
        XCTAssertEqual(manager.verify("2468"), .locked(until: clock.addingTimeInterval(10)))

        clock = clock.addingTimeInterval(11)
        XCTAssertNil(manager.remainingLock())
        // Another failure after the lock expired doubles the delay.
        XCTAssertEqual(manager.verify("0000"), .locked(until: clock.addingTimeInterval(20)))

        clock = clock.addingTimeInterval(21)
        XCTAssertEqual(manager.verify("2468"), .success)
        XCTAssertEqual(manager.failedAttempts, 0)
        XCTAssertNil(manager.lockedUntil)
    }

    func testLockStateSurvivesRestart() throws {
        let store = InMemorySecretStore()
        let manager = makeManager(store: store)
        try manager.setPIN("1111")
        for _ in 0..<3 { _ = manager.verify("9999") }

        let restarted = makeManager(store: store)
        XCTAssertTrue(restarted.isPINSet)
        XCTAssertEqual(restarted.failedAttempts, 3)
        XCTAssertNotNil(restarted.remainingLock())
    }

    func testChangingPINResetsFailures() throws {
        let manager = makeManager()
        try manager.setPIN("1111")
        _ = manager.verify("0000")
        try manager.setPIN("2222")
        XCTAssertEqual(manager.failedAttempts, 0)
        XCTAssertEqual(manager.verify("2222"), .success)
        XCTAssertEqual(manager.verify("1111"), .wrong(remainingBeforeLock: 2))
    }
}
