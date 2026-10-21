import Foundation

/// A fingerprint of a file taken at scan time. Before a move the engine takes a
/// fresh fingerprint and refuses to touch the file if it no longer matches.
public struct FileIdentity: Hashable, Codable, Sendable {
    public var inode: UInt64?
    public var device: Int?
    public var size: Int64
    public var modificationDate: Date?

    public init(inode: UInt64? = nil, device: Int? = nil, size: Int64, modificationDate: Date? = nil) {
        self.inode = inode
        self.device = device
        self.size = size
        self.modificationDate = modificationDate
    }

    /// True when both fingerprints point at the same filesystem object with the
    /// same content size and modification time.
    public func matches(_ other: FileIdentity) -> Bool {
        if let a = inode, let b = other.inode, a != b { return false }
        if let a = device, let b = other.device, a != b { return false }
        if size != other.size { return false }
        if let a = modificationDate, let b = other.modificationDate,
           abs(a.timeIntervalSince(b)) > 0.001 {
            return false
        }
        return true
    }
}

/// One entry found on the Desktop. Values are captured at scan time.
public struct DesktopItem: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public let url: URL
    public let name: String
    /// Lowercased extension without the leading dot ("" when there is none).
    public let fileExtension: String
    public let isDirectory: Bool
    public let isPackage: Bool
    public let isSymbolicLink: Bool
    public let isAlias: Bool
    public let fileSize: Int64
    public let creationDate: Date?
    public let modificationDate: Date?
    /// Date the item was added to the Desktop folder (macOS only; falls back to creation date).
    public let addedDate: Date?
    /// Uniform type identifier, when the platform can resolve one.
    public let contentTypeIdentifier: String?
    /// True when the file carries macOS screenshot metadata (`kMDItemIsScreenCapture`).
    public let hasScreenshotMetadata: Bool
    public let identity: FileIdentity

    public init(
        id: UUID = UUID(),
        url: URL,
        name: String? = nil,
        fileExtension: String? = nil,
        isDirectory: Bool = false,
        isPackage: Bool = false,
        isSymbolicLink: Bool = false,
        isAlias: Bool = false,
        fileSize: Int64 = 0,
        creationDate: Date? = nil,
        modificationDate: Date? = nil,
        addedDate: Date? = nil,
        contentTypeIdentifier: String? = nil,
        hasScreenshotMetadata: Bool = false,
        identity: FileIdentity? = nil
    ) {
        self.id = id
        self.url = url
        self.name = name ?? url.lastPathComponent
        self.fileExtension = (fileExtension ?? url.pathExtension).lowercased()
        self.isDirectory = isDirectory
        self.isPackage = isPackage
        self.isSymbolicLink = isSymbolicLink
        self.isAlias = isAlias
        self.fileSize = fileSize
        self.creationDate = creationDate
        self.modificationDate = modificationDate
        self.addedDate = addedDate ?? creationDate
        self.contentTypeIdentifier = contentTypeIdentifier
        self.hasScreenshotMetadata = hasScreenshotMetadata
        self.identity = identity ?? FileIdentity(size: fileSize, modificationDate: modificationDate)
    }

    /// Name without its extension.
    public var baseName: String {
        let ext = url.pathExtension
        if ext.isEmpty { return name }
        return String(name.dropLast(ext.count + 1))
    }
}
