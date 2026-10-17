import Foundation
import Observation

/// Counts how long videos actually play each day and enforces an optional
/// daily limit. Time only accrues while a video is in the `.playing` state,
/// so browsing the library or a paused screen does not count.
///
/// The day rolls over at local midnight. Parents can grant extra minutes for
/// today or reset today's count from the parent area.
@MainActor
@Observable
final class UsageTracker {
    static let limitChoices: [Int] = [0, 15, 30, 45, 60, 90, 120, 180]
    static let bonusMinutes = 15

    private enum Key {
        static let limit = "usage.limitMinutes"
        static let day = "usage.day"
        static let seconds = "usage.seconds"
        static let bonus = "usage.bonusSeconds"
    }

    /// Daily allowance in minutes. 0 means no limit.
    var limitMinutes: Int {
        didSet { defaults.set(limitMinutes, forKey: Key.limit) }
    }
    private(set) var secondsToday: Int
    private(set) var bonusSecondsToday: Int
    private(set) var dayKey: String

    private let defaults: UserDefaults
    private let now: () -> Date
    private let calendar: Calendar
    @ObservationIgnored private var activePlayers = 0
    @ObservationIgnored private var ticker: Task<Void, Never>?

    init(defaults: UserDefaults = .standard, calendar: Calendar = .current, now: @escaping () -> Date = Date.init) {
        self.defaults = defaults
        self.calendar = calendar
        self.now = now
        limitMinutes = defaults.integer(forKey: Key.limit)
        dayKey = defaults.string(forKey: Key.day) ?? ""
        secondsToday = defaults.integer(forKey: Key.seconds)
        bonusSecondsToday = defaults.integer(forKey: Key.bonus)
        rolloverIfNeeded()
    }

    // MARK: State

    var isLimitEnabled: Bool { limitMinutes > 0 }

    var allowedSecondsToday: Int { limitMinutes * 60 + bonusSecondsToday }

    /// Seconds left today, or nil when no limit is set.
    var remainingSeconds: Int? {
        guard isLimitEnabled else { return nil }
        return max(0, allowedSecondsToday - secondsToday)
    }

    var isLimitReached: Bool {
        isLimitEnabled && secondsToday >= allowedSecondsToday
    }

    var minutesWatchedToday: Int { secondsToday / 60 }

    // MARK: Counting

    /// Call when a video starts playing; balanced by `endPlaying()`.
    func beginPlaying() {
        rolloverIfNeeded()
        activePlayers += 1
        startTickerIfNeeded()
    }

    func endPlaying() {
        activePlayers = max(0, activePlayers - 1)
        if activePlayers == 0 {
            ticker?.cancel()
            ticker = nil
            persist()
        }
    }

    /// One second of playback. Public so tests can drive it directly.
    func tick() {
        rolloverIfNeeded()
        secondsToday += 1
        if secondsToday % 10 == 0 { persist() }
    }

    /// Resets the counters when the calendar day has changed since the last
    /// activity. Safe to call often.
    func rolloverIfNeeded() {
        let today = Self.key(for: now(), calendar: calendar)
        guard today != dayKey else { return }
        dayKey = today
        secondsToday = 0
        bonusSecondsToday = 0
        persist()
    }

    // MARK: Parent actions

    func addBonus(minutes: Int = bonusMinutes) {
        rolloverIfNeeded()
        bonusSecondsToday += minutes * 60
        persist()
    }

    func resetToday() {
        rolloverIfNeeded()
        secondsToday = 0
        bonusSecondsToday = 0
        persist()
    }

    func persist() {
        defaults.set(dayKey, forKey: Key.day)
        defaults.set(secondsToday, forKey: Key.seconds)
        defaults.set(bonusSecondsToday, forKey: Key.bonus)
    }

    // MARK: Internals

    private func startTickerIfNeeded() {
        guard ticker == nil else { return }
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { break }
                self?.tick()
            }
        }
    }

    static func key(for date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    static func formatMinutes(_ minutes: Int) -> String {
        if minutes == 0 { return "Off" }
        if minutes % 60 == 0 { return minutes == 60 ? "1 hour" : "\(minutes / 60) hours" }
        if minutes > 60 { return "\(minutes / 60) h \(minutes % 60) min" }
        return "\(minutes) min"
    }
}
