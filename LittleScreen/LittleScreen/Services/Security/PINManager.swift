import CryptoKit
import Foundation
import Observation

/// Salted, iterated SHA-256 record of the parent PIN. The PIN itself is never
/// stored (5.3 "do not store authentication secrets in plain text").
struct PINRecord: Codable, Equatable {
    var salt: Data
    var hash: Data
    var iterations: Int
}

enum PINHasher {
    /// Iterations of SHA-256. A few tens of milliseconds on an iPhone: invisible
    /// to the parent, expensive enough to make offline guessing of a stolen
    /// record unattractive.
    static let defaultIterations = 50_000

    static func makeRecord(pin: String, iterations: Int = defaultIterations) -> PINRecord {
        let salt = Data((0..<16).map { _ in UInt8.random(in: .min ... .max) })
        return PINRecord(salt: salt, hash: hash(pin: pin, salt: salt, iterations: iterations), iterations: iterations)
    }

    static func hash(pin: String, salt: Data, iterations: Int) -> Data {
        var digest = Data(SHA256.hash(data: salt + Data(pin.utf8)))
        if iterations > 1 {
            for _ in 1..<iterations {
                digest = Data(SHA256.hash(data: salt + digest))
            }
        }
        return digest
    }

    static func verify(pin: String, against record: PINRecord) -> Bool {
        let candidate = hash(pin: pin, salt: record.salt, iterations: record.iterations)
        return constantTimeEquals(candidate, record.hash)
    }

    static func constantTimeEquals(_ lhs: Data, _ rhs: Data) -> Bool {
        guard lhs.count == rhs.count else { return false }
        var difference: UInt8 = 0
        for (a, b) in zip(lhs, rhs) {
            difference |= a ^ b
        }
        return difference == 0
    }
}

/// How wrong attempts are throttled. After `freeAttempts` failures the pad
/// locks for `baseDelay`, doubling with every further failure up to `maxDelay`.
struct LockoutPolicy: Equatable {
    var freeAttempts = 5
    var baseDelay: TimeInterval = 30
    var maxDelay: TimeInterval = 15 * 60

    func lockDuration(afterFailures failures: Int) -> TimeInterval? {
        guard failures >= freeAttempts else { return nil }
        let extra = failures - freeAttempts
        let delay = baseDelay * pow(2, Double(min(extra, 20)))
        return min(delay, maxDelay)
    }
}

/// Sets and verifies the parent PIN (FR-04, FR-05).
@MainActor
@Observable
final class PINManager {
    private struct LockState: Codable {
        var failedAttempts = 0
        var lockedUntil: Date?
    }

    private enum Key {
        static let record = "pin.record"
        static let lockState = "pin.lockState"
    }

    enum VerifyResult: Equatable {
        case success
        case wrong(remainingBeforeLock: Int)
        case locked(until: Date)
        case notSet
    }

    static let minLength = 4
    static let maxLength = 6

    private(set) var isPINSet = false
    private(set) var failedAttempts = 0
    private(set) var lockedUntil: Date?

    private let store: SecretStore
    private let policy: LockoutPolicy
    private let now: () -> Date
    private let iterations: Int

    init(
        store: SecretStore = KeychainStore(),
        policy: LockoutPolicy = LockoutPolicy(),
        iterations: Int = PINHasher.defaultIterations,
        now: @escaping () -> Date = Date.init
    ) {
        self.store = store
        self.policy = policy
        self.iterations = iterations
        self.now = now
        reload()
    }

    static func isValidPIN(_ pin: String) -> Bool {
        (minLength...maxLength).contains(pin.count) && pin.allSatisfy { $0.isASCII && $0.isNumber }
    }

    func setPIN(_ pin: String) throws {
        precondition(Self.isValidPIN(pin), "PIN must be \(Self.minLength)–\(Self.maxLength) digits")
        let record = PINHasher.makeRecord(pin: pin, iterations: iterations)
        try store.set(try JSONEncoder().encode(record), for: Key.record)
        isPINSet = true
        failedAttempts = 0
        lockedUntil = nil
        try? store.remove(Key.lockState)
    }

    func clearPIN() throws {
        try store.remove(Key.record)
        try? store.remove(Key.lockState)
        isPINSet = false
        failedAttempts = 0
        lockedUntil = nil
    }

    func verify(_ pin: String) -> VerifyResult {
        guard let record = loadRecord() else { return .notSet }
        let current = now()
        if let lockedUntil, lockedUntil > current {
            return .locked(until: lockedUntil)
        }
        if PINHasher.verify(pin: pin, against: record) {
            failedAttempts = 0
            lockedUntil = nil
            persistLockState()
            return .success
        }
        failedAttempts += 1
        if let duration = policy.lockDuration(afterFailures: failedAttempts) {
            let until = current.addingTimeInterval(duration)
            lockedUntil = until
            persistLockState()
            return .locked(until: until)
        }
        persistLockState()
        return .wrong(remainingBeforeLock: policy.freeAttempts - failedAttempts)
    }

    /// Seconds left on the current lock, or nil when the pad is usable.
    func remainingLock(at date: Date? = nil) -> TimeInterval? {
        guard let lockedUntil else { return nil }
        let remaining = lockedUntil.timeIntervalSince(date ?? now())
        return remaining > 0 ? remaining : nil
    }

    // MARK: Persistence

    private func reload() {
        isPINSet = loadRecord() != nil
        if let data = try? store.data(for: Key.lockState),
           let state = try? JSONDecoder().decode(LockState.self, from: data) {
            failedAttempts = state.failedAttempts
            lockedUntil = state.lockedUntil
        }
    }

    private func loadRecord() -> PINRecord? {
        guard let data = try? store.data(for: Key.record) else { return nil }
        return try? JSONDecoder().decode(PINRecord.self, from: data)
    }

    private func persistLockState() {
        let state = LockState(failedAttempts: failedAttempts, lockedUntil: lockedUntil)
        if let data = try? JSONEncoder().encode(state) {
            try? store.set(data, for: Key.lockState)
        }
    }
}
