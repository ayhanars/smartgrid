import Foundation

/// Why an item is left on the Desktop.
public enum ExclusionReason: Equatable, Codable, Sendable {
    case outsideDesktop
    case excludedFile
    case symbolicLink
    case alias
    case directory
    case package
    case insideExcludedFolder(String)
    case excludedExtension(String)
    case excludedCategory(FileCategory)
    case namePattern(String)
    case notInMode(CleaningMode)
    case downloadInProgress
    case recentlyModified
    case unreadable

    /// Short plural noun for counts, e.g. "3 folders".
    public var shortLabel: String {
        switch self {
        case .outsideDesktop: return "outside the Desktop"
        case .excludedFile: return "excluded files"
        case .symbolicLink: return "symlinks"
        case .alias: return "aliases"
        case .directory: return "folders"
        case .package: return "packages"
        case .insideExcludedFolder: return "in excluded folders"
        case .excludedExtension: return "excluded extensions"
        case .excludedCategory: return "disabled categories"
        case .namePattern: return "name patterns"
        case .notInMode: return "outside this mode"
        case .downloadInProgress: return "downloading"
        case .recentlyModified: return "still being written"
        case .unreadable: return "unreadable"
        }
    }

    public var description: String {
        switch self {
        case .outsideDesktop: return "Not on the Desktop"
        case .excludedFile: return "Excluded file"
        case .symbolicLink: return "Symbolic link"
        case .alias: return "Alias"
        case .directory: return "Folder (folders are left alone)"
        case .package: return "Package"
        case .insideExcludedFolder(let path): return "Inside excluded folder “\(URL(fileURLWithPath: path).lastPathComponent)”"
        case .excludedExtension(let ext): return "Excluded extension .\(ext)"
        case .excludedCategory(let category): return "Category disabled: \(category.displayName)"
        case .namePattern(let pattern): return "Matches pattern “\(pattern)”"
        case .notInMode(let mode): return "Not part of \(mode.displayName)"
        case .downloadInProgress: return "Download in progress"
        case .recentlyModified: return "Still being written"
        case .unreadable: return "Cannot be read"
        }
    }
}

/// The outcome of running the policy on one item.
public struct PolicyDecision: Equatable, Sendable, Identifiable {
    public let item: DesktopItem
    public let category: FileCategory
    public let exclusionReason: ExclusionReason?

    public var id: UUID { item.id }
    public var isEligible: Bool { exclusionReason == nil }

    public init(item: DesktopItem, category: FileCategory, exclusionReason: ExclusionReason?) {
        self.item = item
        self.category = category
        self.exclusionReason = exclusionReason
    }
}

/// Decides which scanned items the robot may move.
public struct CleaningPolicy: Sendable {
    public var rules: ExclusionRules
    public var mode: CleaningMode
    public var desktopURL: URL
    public var classifier: FileClassifier
    /// Files modified more recently than this are assumed to still be written.
    public var recentModificationGrace: TimeInterval
    public var now: @Sendable () -> Date

    public static let inProgressDownloadExtensions: Set<String> = [
        "download", "crdownload", "part", "partial", "tmp", "opdownload", "aria2",
    ]

    public init(
        rules: ExclusionRules,
        mode: CleaningMode,
        desktopURL: URL,
        classifier: FileClassifier = FileClassifier(),
        recentModificationGrace: TimeInterval = 1,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.rules = rules
        self.mode = mode
        self.desktopURL = desktopURL.standardizedFileURL
        self.classifier = classifier
        self.recentModificationGrace = recentModificationGrace
        self.now = now
    }

    public func evaluate(_ items: [DesktopItem]) -> [PolicyDecision] {
        items.map(evaluate)
    }

    public func evaluate(_ item: DesktopItem) -> PolicyDecision {
        let category = classifier.classify(item)
        return PolicyDecision(item: item, category: category, exclusionReason: exclusionReason(for: item, category: category))
    }

    private func exclusionReason(for item: DesktopItem, category: FileCategory) -> ExclusionReason? {
        let itemPath = item.url.standardizedFileURL.path
        let parentPath = item.url.standardizedFileURL.deletingLastPathComponent().path
        if parentPath != desktopURL.path { return .outsideDesktop }

        if rules.excludedFiles.contains(where: { $0.standardizedFileURL.path == itemPath }) {
            return .excludedFile
        }
        if item.isSymbolicLink { return .symbolicLink }
        if item.isAlias { return .alias }

        for folder in rules.excludedFolders {
            let folderPath = folder.standardizedFileURL.path
            if itemPath == folderPath || CleaningPolicy.path(itemPath, isInside: folderPath) {
                return .insideExcludedFolder(folderPath)
            }
        }

        if item.isDirectory {
            if item.isPackage {
                if !rules.includePackages { return .package }
            } else if !rules.includeDirectories {
                return .directory
            }
        }

        if !item.fileExtension.isEmpty, rules.excludedExtensions.contains(item.fileExtension) {
            return .excludedExtension(item.fileExtension)
        }
        if rules.excludedCategories.contains(category) {
            return .excludedCategory(category)
        }
        for pattern in rules.excludedNamePatterns where GlobPattern(pattern).matches(item.name) {
            return .namePattern(pattern)
        }
        if let allowed = mode.allowedCategories, !allowed.contains(category) {
            return .notInMode(mode)
        }
        if CleaningPolicy.inProgressDownloadExtensions.contains(item.fileExtension) {
            return .downloadInProgress
        }
        if let modified = item.modificationDate, now().timeIntervalSince(modified) < recentModificationGrace {
            return .recentlyModified
        }
        return nil
    }

    static func path(_ path: String, isInside folder: String) -> Bool {
        let prefix = folder.hasSuffix("/") ? folder : folder + "/"
        return path.hasPrefix(prefix)
    }
}
