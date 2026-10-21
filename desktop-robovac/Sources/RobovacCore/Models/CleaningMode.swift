import Foundation

/// The user-facing cleaning routines. All modes share the same file engine and
/// differ only in which categories they touch and how the robot animates.
public enum CleaningMode: String, Codable, CaseIterable, Sendable, Identifiable {
    case smartClean
    case screenshotSweep
    case gentleClean

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .smartClean: return "Smart Clean"
        case .screenshotSweep: return "Screenshot Sweep"
        case .gentleClean: return "Gentle Clean"
        }
    }

    public var summary: String {
        switch self {
        case .smartClean:
            return "Finds every eligible desktop item, classifies it and moves it to its destination."
        case .screenshotSweep:
            return "Collects only recognized screenshots."
        case .gentleClean:
            return "Same as Smart Clean, with slower movement, longer suction and subtle effects."
        }
    }

    /// Categories this mode is allowed to process. `nil` means all categories.
    public var allowedCategories: Set<FileCategory>? {
        switch self {
        case .screenshotSweep: return [.screenshot]
        case .smartClean, .gentleClean: return nil
        }
    }

    public var isGentle: Bool { self == .gentleClean }
}
