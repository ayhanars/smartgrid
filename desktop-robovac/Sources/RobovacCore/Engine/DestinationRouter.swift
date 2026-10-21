import Foundation

/// Maps a category to the folder its files land in for one cleaning session.
public struct DestinationRouter: Sendable {
    public var rules: DestinationRules
    public let sessionDate: Date

    public init(rules: DestinationRules, sessionDate: Date = Date()) {
        self.rules = rules
        self.sessionDate = sessionDate
    }

    /// Folder name for dated session folders, e.g. "2026-10-21 14.05".
    public var sessionFolderName: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH.mm"
        return formatter.string(from: sessionDate)
    }

    /// The directory files of `category` are moved into. Category-specific
    /// destinations are used as-is; the default destination gets a dated
    /// session subfolder when enabled.
    public func destinationDirectory(for category: FileCategory) -> URL {
        if let specific = rules.categoryDestinations[category] {
            return specific.standardizedFileURL
        }
        return defaultSessionDirectory
    }

    public var defaultSessionDirectory: URL {
        let base = rules.defaultDestination.standardizedFileURL
        if rules.useDatedSessionFolders {
            return base.appendingPathComponent(sessionFolderName, isDirectory: true)
        }
        return base
    }
}
