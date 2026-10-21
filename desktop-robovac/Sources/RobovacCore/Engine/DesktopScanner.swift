import Foundation
#if canImport(Darwin)
import Darwin
#endif
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif

/// Discovers items on the Desktop. Scans are shallow: the robot never descends
/// into folders, so nothing outside the top level of the Desktop is ever touched.
public struct DesktopScanner: Sendable {
    /// Housekeeping entries Finder keeps on the Desktop that are never cleaning targets.
    public var ignoredNames: Set<String>

    public init(ignoredNames: Set<String> = [".DS_Store", ".localized", "Icon\r"]) {
        self.ignoredNames = ignoredNames
    }

    /// The current user's Desktop folder.
    public static var defaultDesktopURL: URL {
        if let url = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask).first {
            return url.standardizedFileURL
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Desktop", isDirectory: true)
            .standardizedFileURL
    }

    /// Lists the top-level items of `directory`, skipping hidden files.
    public func scan(directory: URL) throws -> [DesktopItem] {
        let fileManager = FileManager.default
        let urls = try fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        var items: [DesktopItem] = []
        items.reserveCapacity(urls.count)
        for url in urls {
            let name = url.lastPathComponent
            if ignoredNames.contains(name) || name.hasPrefix(".") { continue }
            if let item = inspect(url: url) { items.append(item) }
        }
        return items.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    /// Builds a `DesktopItem` for a single URL. Returns nil when the item no longer exists.
    public func inspect(url: URL) -> DesktopItem? {
        DesktopScanner.inspect(url: url)
    }

    /// Takes a fresh fingerprint of the file at `url`, without following symlinks.
    public static func identity(of url: URL) -> FileIdentity? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path) else { return nil }
        return identity(from: attributes)
    }

    static func identity(from attributes: [FileAttributeKey: Any]) -> FileIdentity {
        var inode: UInt64?
        if let value = attributes[.systemFileNumber] as? NSNumber {
            inode = value.uint64Value
        } else if let value = attributes[.systemFileNumber] as? UInt64 {
            inode = value
        } else if let value = attributes[.systemFileNumber] as? Int {
            inode = UInt64(value)
        }
        var device: Int?
        if let value = attributes[.systemNumber] as? NSNumber {
            device = value.intValue
        } else if let value = attributes[.systemNumber] as? Int {
            device = value
        }
        let size = (attributes[.size] as? NSNumber)?.int64Value ?? Int64((attributes[.size] as? Int) ?? 0)
        let modified = attributes[.modificationDate] as? Date
        return FileIdentity(inode: inode, device: device, size: size, modificationDate: modified)
    }

    static func inspect(url: URL) -> DesktopItem? {
        let fileManager = FileManager.default
        let path = url.path
        guard let attributes = try? fileManager.attributesOfItem(atPath: path) else { return nil }

        let type = attributes[.type] as? FileAttributeType
        let isSymbolicLink = type == .typeSymbolicLink
        var isDirectory = type == .typeDirectory
        var isPackage = false
        var isAlias = false
        var addedDate: Date?
        var contentType: String?

        #if canImport(Darwin)
        let keys: Set<URLResourceKey> = [
            .isDirectoryKey, .isPackageKey, .isAliasFileKey, .addedToDirectoryDateKey, .contentTypeKey,
        ]
        if let values = try? url.resourceValues(forKeys: keys) {
            if let directory = values.isDirectory, !isSymbolicLink { isDirectory = directory }
            isPackage = values.isPackage ?? false
            isAlias = values.isAliasFile ?? false
            addedDate = values.addedToDirectoryDate
            contentType = values.contentType?.identifier
        }
        // Finder aliases are regular files whose `isAliasFile` is true; symlinks also report true.
        if isSymbolicLink { isAlias = false }
        #endif

        let identity = DesktopScanner.identity(from: attributes)
        let creation = attributes[.creationDate] as? Date
        let modification = attributes[.modificationDate] as? Date
        let hasScreenshotMetadata = DesktopScanner.hasScreenshotExtendedAttribute(path: path)

        return DesktopItem(
            url: url,
            isDirectory: isDirectory,
            isPackage: isPackage,
            isSymbolicLink: isSymbolicLink,
            isAlias: isAlias,
            fileSize: identity.size,
            creationDate: creation,
            modificationDate: modification,
            addedDate: addedDate ?? creation,
            contentTypeIdentifier: contentType,
            hasScreenshotMetadata: hasScreenshotMetadata,
            identity: identity
        )
    }

    /// macOS tags screenshots with the `kMDItemIsScreenCapture` extended attribute.
    public static func hasScreenshotExtendedAttribute(path: String) -> Bool {
        #if canImport(Darwin)
        let name = "com.apple.metadata:kMDItemIsScreenCapture"
        let size = getxattr(path, name, nil, 0, 0, XATTR_NOFOLLOW)
        return size > 0
        #else
        return false
        #endif
    }
}
