import Foundation

/// Why a move did not happen. Skips are expected, non-fatal outcomes.
public enum MoveFailure: Error, Equatable, Codable, Sendable {
    case sourceMissing
    case identityChanged
    case sourceBusy
    case destinationUnavailable(String)
    case permissionDenied(String)
    case destinationInsideSource
    case underlying(String)

    /// Skips are items the robot decided to leave alone; everything else is an error.
    public var isSkip: Bool {
        switch self {
        case .sourceMissing, .identityChanged, .sourceBusy: return true
        default: return false
        }
    }

    public var message: String {
        switch self {
        case .sourceMissing: return "The file no longer exists."
        case .identityChanged: return "The file changed since it was scanned."
        case .sourceBusy: return "The file is still being written."
        case .destinationUnavailable(let detail): return "The destination is unavailable: \(detail)"
        case .permissionDenied(let detail): return "Permission denied: \(detail)"
        case .destinationInsideSource: return "The destination is inside the item being moved."
        case .underlying(let detail): return detail
        }
    }
}

/// Why an undo could not restore a file.
public enum RestoreFailure: Error, Equatable, Sendable {
    case movedFileMissing
    case originalOccupied
    case originalFolderMissing
    case permissionDenied(String)
    case underlying(String)

    public var message: String {
        switch self {
        case .movedFileMissing: return "The moved file is no longer at its destination."
        case .originalOccupied: return "Another file now occupies the original location."
        case .originalFolderMissing: return "The original folder no longer exists."
        case .permissionDenied(let detail): return "Permission denied: \(detail)"
        case .underlying(let detail): return detail
        }
    }
}

/// Moves files safely. Never deletes, never overwrites.
public struct FileOperationService: Sendable {
    public var fileManager: FileManager { FileManager.default }

    public init() {}

    /// Moves `item` into `directory`, creating it as needed. Returns the final URL.
    public func move(item: DesktopItem, toDirectory directory: URL) -> Result<URL, MoveFailure> {
        let source = item.url.standardizedFileURL
        let destinationDirectory = directory.standardizedFileURL

        guard fileManager.fileExists(atPath: source.path) || isSymbolicLink(source) else {
            return .failure(.sourceMissing)
        }
        guard let current = DesktopScanner.identity(of: source) else {
            return .failure(.sourceMissing)
        }
        guard current.matches(item.identity) else {
            return .failure(.identityChanged)
        }
        if item.isDirectory, CleaningPolicy.path(destinationDirectory.path, isInside: source.path) {
            return .failure(.destinationInsideSource)
        }

        do {
            try fileManager.createDirectory(at: destinationDirectory, withIntermediateDirectories: true)
        } catch {
            return .failure(classifyDirectoryError(error))
        }

        let destination = FileOperationService.uniqueURL(forName: source.lastPathComponent, in: destinationDirectory)
        if fileManager.fileExists(atPath: destination.path) {
            return .failure(.destinationUnavailable("Could not find a free file name."))
        }
        do {
            try fileManager.moveItem(at: source, to: destination)
        } catch {
            return .failure(classifyMoveError(error))
        }
        return .success(destination)
    }

    /// Moves `item` to the Trash (not a delete: it stays recoverable until the Trash
    /// is emptied) and returns where it landed, so undo can bring it back.
    public func trash(item: DesktopItem) -> Result<URL, MoveFailure> {
        let source = item.url.standardizedFileURL
        guard fileManager.fileExists(atPath: source.path) || isSymbolicLink(source) else {
            return .failure(.sourceMissing)
        }
        guard let current = DesktopScanner.identity(of: source) else {
            return .failure(.sourceMissing)
        }
        guard current.matches(item.identity) else {
            return .failure(.identityChanged)
        }
        #if os(macOS)
        var resulting: NSURL?
        do {
            try fileManager.trashItem(at: source, resultingItemURL: &resulting)
        } catch {
            return .failure(classifyMoveError(error))
        }
        if let landed = resulting.map({ $0 as URL }) {
            return .success(landed.standardizedFileURL)
        }
        return .failure(.underlying("The Trash did not report where the file went."))
        #else
        return .failure(.destinationUnavailable("Trash is only available on macOS."))
        #endif
    }

    /// Restores a moved file to its original location. Refuses to overwrite.
    public func restore(from destination: URL, to original: URL, renameIfOccupied: Bool) -> Result<URL, RestoreFailure> {
        let destination = destination.standardizedFileURL
        let original = original.standardizedFileURL
        guard fileManager.fileExists(atPath: destination.path) else { return .failure(.movedFileMissing) }
        let folder = original.deletingLastPathComponent()
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: folder.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            return .failure(.originalFolderMissing)
        }
        var target = original
        if fileManager.fileExists(atPath: original.path) {
            guard renameIfOccupied else { return .failure(.originalOccupied) }
            target = FileOperationService.uniqueURL(forName: original.lastPathComponent, in: folder)
        }
        do {
            try fileManager.moveItem(at: destination, to: target)
        } catch {
            if let cocoa = error as? CocoaError, cocoa.code == .fileWriteNoPermission || cocoa.code == .fileReadNoPermission {
                return .failure(.permissionDenied(error.localizedDescription))
            }
            return .failure(.underlying(error.localizedDescription))
        }
        return .success(target)
    }

    /// "Report.pdf" → "Report.pdf", "Report 2.pdf", "Report 3.pdf", … whichever is free.
    public static func uniqueURL(forName name: String, in directory: URL) -> URL {
        let fileManager = FileManager.default
        let candidate = directory.appendingPathComponent(name)
        if !fileManager.fileExists(atPath: candidate.path) { return candidate }

        let ext = (name as NSString).pathExtension
        let base = ext.isEmpty ? name : String(name.dropLast(ext.count + 1))
        var counter = 2
        while counter < 10_000 {
            let newName = ext.isEmpty ? "\(base) \(counter)" : "\(base) \(counter).\(ext)"
            let url = directory.appendingPathComponent(newName)
            if !fileManager.fileExists(atPath: url.path) { return url }
            counter += 1
        }
        return directory.appendingPathComponent("\(base) \(UUID().uuidString)" + (ext.isEmpty ? "" : ".\(ext)"))
    }

    private func isSymbolicLink(_ url: URL) -> Bool {
        (try? fileManager.destinationOfSymbolicLink(atPath: url.path)) != nil
    }

    private func classifyDirectoryError(_ error: Error) -> MoveFailure {
        if let cocoa = error as? CocoaError, cocoa.code == .fileWriteNoPermission {
            return .permissionDenied(error.localizedDescription)
        }
        return .destinationUnavailable(error.localizedDescription)
    }

    private func classifyMoveError(_ error: Error) -> MoveFailure {
        if let cocoa = error as? CocoaError {
            switch cocoa.code {
            case .fileNoSuchFile, .fileReadNoSuchFile: return .sourceMissing
            case .fileWriteNoPermission, .fileReadNoPermission: return .permissionDenied(error.localizedDescription)
            case .fileWriteVolumeReadOnly, .fileWriteOutOfSpace: return .destinationUnavailable(error.localizedDescription)
            case .fileWriteFileExists: return .destinationUnavailable("A file with the same name appeared at the destination.")
            default: break
            }
        }
        return .underlying(error.localizedDescription)
    }
}
