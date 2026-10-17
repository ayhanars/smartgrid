import Foundation
import Observation

/// Parent-adjustable behaviour, persisted in UserDefaults. Nothing here is a
/// secret; the PIN lives in `PINManager`.
@MainActor
@Observable
final class AppSettings {
    enum EndOfVideoBehavior: String, CaseIterable, Identifiable {
        case completionScreen
        case returnToLibrary

        var id: String { rawValue }

        var label: String {
            switch self {
            case .completionScreen: return "Show an “All done” screen"
            case .returnToLibrary: return "Go back to the library"
            }
        }
    }

    private enum Key {
        static let showTitles = "settings.showTitlesInChildMode"
        static let endOfVideo = "settings.endOfVideoBehavior"
        static let longPressExit = "settings.allowLongPressExit"
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

    var biometricUnlockEnabled: Bool {
        didSet { defaults.set(biometricUnlockEnabled, forKey: Key.biometrics) }
    }

    var hasCompletedOnboarding: Bool {
        didSet { defaults.set(hasCompletedOnboarding, forKey: Key.onboarding) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        showTitlesInChildMode = defaults.object(forKey: Key.showTitles) as? Bool ?? false
        endOfVideoBehavior = EndOfVideoBehavior(rawValue: defaults.string(forKey: Key.endOfVideo) ?? "") ?? .completionScreen
        allowLongPressExit = defaults.object(forKey: Key.longPressExit) as? Bool ?? true
        biometricUnlockEnabled = defaults.bool(forKey: Key.biometrics)
        hasCompletedOnboarding = defaults.bool(forKey: Key.onboarding)
    }
}
