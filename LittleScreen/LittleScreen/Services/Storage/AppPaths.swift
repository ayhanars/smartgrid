import Foundation

/// Where LittleScreen keeps its data. Everything lives under one root in
/// Application Support so it is private to the app, survives restarts, and is
/// easy to reason about when deleting.
struct AppPaths: Sendable, Equatable {
    let root: URL

    var libraryFile: URL { root.appendingPathComponent("library.json") }
    var mediaDirectory: URL { root.appendingPathComponent("Media", isDirectory: true) }
    var thumbnailDirectory: URL { root.appendingPathComponent("Thumbnails", isDirectory: true) }

    static func `default`() throws -> AppPaths {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return AppPaths(root: support.appendingPathComponent("LittleScreen", isDirectory: true))
    }

    /// A throwaway location used in tests and as a last-resort fallback.
    static func temporary() -> AppPaths {
        AppPaths(root: FileManager.default.temporaryDirectory
            .appendingPathComponent("LittleScreen-\(UUID().uuidString)", isDirectory: true))
    }

    func ensureDirectories() throws {
        let fm = FileManager.default
        for directory in [root, mediaDirectory, thumbnailDirectory] {
            try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        // Media can always be re-imported, so keep the (large) files out of the
        // parent's iCloud / computer backups. The metadata file is small and
        // stays backed up.
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var media = mediaDirectory
        try? media.setResourceValues(values)
    }

    func mediaURL(for item: VideoItem) -> URL {
        mediaDirectory.appendingPathComponent(item.mediaFileName)
    }

    func thumbnailURL(for item: VideoItem) -> URL? {
        guard let name = item.thumbnailFileName else { return nil }
        return thumbnailDirectory.appendingPathComponent(name)
    }
}
