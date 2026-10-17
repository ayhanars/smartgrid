import Foundation
import Observation

/// Parent-adjustable behaviour, persisted in UserDefaults. Nothing here is a
/// secret; the PIN lives in `PINManager`, watch time in `UsageTracker`.
@MainActor
@Observable
final class AppSettings {
    /// What happens when a video reaches its end. The default never starts
    /// anything by itself; the two automatic options are a deliberate parent
    /// choice and still respect the daily limit.
    enum EndOfVideoBehavior: String, CaseIterable, Identifiable {
        case completionScreen
        case returnToLibrary
        case loopSame
        case playNext

        var id: String { rawValue }

        var label: String {
            switch self {
            case .completionScreen: return "Show an “All done” screen"
            case .returnToLibrary: return "Go back to the library"
            case .loopSame: return "Play the same video again"
            case .playNext: return "Play the next video"
            }
        }

        var isAutomatic: Bool { self == .loopSame || self == .playNext }
    }

    private enum Key {
        static let showTitles = "settings.showTitlesInChildMode"
        static let endOfVideo = "settings.endOfVideoBehavior"
        static let longPressExit = "settings.allowLongPressExit"
        static let skipButton = "settings.showSkipButton"
        static let biometrics = "settings.biometricUnlockEnabled"
        static let onboarding = "settings.hasCompletedOnboarding"
    }

    private let defaults: UserDefaults

    var showTitlesInChildMode: Bool {
        didSet { defaults.set(showTitlesInChildMode, forKey: Key.showTitles) }
    }

    var endOfVideoBehavior: EndOfVideoBehavior {
        didSet { defaults.set(endOfVideoBehavior.rawValue, forKey: Key.endOfVideo) }
    }

    /// When on, holding one finger on the video for a while reveals a single
    /// "Back" button. When off, a video can only be left when it ends or via
    /// the parent gesture.
    var allowLongPressExit: Bool {
        didSet { defaults.set(allowLongPressExit, forKey: Key.longPressExit) }
    }

    /// Shows a small circle during playback that skips to the next video when
    /// held for a moment. A tap does nothing.
    var showSkipButton: Bool {
        didSet { defaults.set(showSkipButton, forKey: Key.skipButton) }
    }

    var biometricUnlockEnabled: Bool {
        didSet { defaults.set(biometricUnlockEnabled, forKey: Key.biometrics) }
    }

    var hasCompletedOnboarding: Bool {
        didSet { defaults.set(hasCompletedOnboarding, forKey: Key.onboarding) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        showTitlesInChildMode = defaults.object(forKey: Key.showTitles) as? Bool ?? true
        endOfVideoBehavior = EndOfVideoBehavior(rawValue: defaults.string(forKey: Key.endOfVideo) ?? "") ?? .completionScreen
        allowLongPressExit = defaults.object(forKey: Key.longPressExit) as? Bool ?? true
        showSkipButton = defaults.object(forKey: Key.skipButton) as? Bool ?? true
        biometricUnlockEnabled = defaults.bool(forKey: Key.biometrics)
        hasCompletedOnboarding = defaults.bool(forKey: Key.onboarding)
    }
}
