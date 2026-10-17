import Foundation

/// File-system operations on media and thumbnail files. Metadata lives in
/// `LibraryStore`; this type never touches `library.json`.
struct MediaStore: Sendable {
    let paths: AppPaths

    func availability(for item: VideoItem) -> MediaAvailability {
        let url = paths.mediaURL(for: item)
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path) else { return .missing }
        guard fm.isReadableFile(atPath: url.path) else { return .unreadable }
        if let size = try? fileSize(at: url), size == 0 { return .unreadable }
        return .available
    }

    func fileSize(at url: URL) throws -> Int64 {
        let values = try url.resourceValues(forKeys: [.fileSizeKey])
        return Int64(values.fileSize ?? 0)
    }

    /// Free space the system is willing to give an app for data the user cares
    /// about. Nil when the volume cannot be queried.
    func availableCapacity() -> Int64? {
        let values = try? paths.root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage
    }

    /// Total bytes used by media files (thumbnails are negligible by comparison).
    func totalMediaBytes() -> Int64 {
        let fm = FileManager.default
        guard let enumerator = fm.enumerator(
            at: paths.mediaDirectory,
            includingPropertiesForKeys: [.fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else { return 0 }
        var total: Int64 = 0
        for case let url as URL in enumerator {
            total += (try? fileSize(at: url)) ?? 0
        }
        return total
    }

    /// Deletes a file if it exists. Missing files are not an error.
    func deleteFile(at url: URL) throws {
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path) else { return }
        do {
            try fm.removeItem(at: url)
        } catch {
            throw LibraryError.fileOperationFailed(error.localizedDescription)
        }
    }
}
