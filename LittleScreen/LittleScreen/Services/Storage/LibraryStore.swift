import Foundation
import Observation

/// The persisted video library (FR-01, FR-09).
///
/// Metadata is kept in a small JSON document written atomically; media and
/// thumbnails are plain files managed by `MediaStore`. A JSON file is enough
/// for the "at least 100 entries" target and keeps the data trivially
/// inspectable and recoverable.
@MainActor
@Observable
final class LibraryStore {
    private(set) var items: [VideoItem] = []
    private(set) var availability: [UUID: MediaAvailability] = [:]
    /// The most recent persistence problem, surfaced in the parent area.
    private(set) var lastError: LibraryError?

    let paths: AppPaths
    let media: MediaStore

    init(paths: AppPaths) {
        self.paths = paths
        self.media = MediaStore(paths: paths)
    }

    /// What the child may see: only videos whose file is present (FR-03, FR-07).
    var childVisibleItems: [VideoItem] {
        items.filter { availability[$0.id]?.isPlayable ?? false }
    }

    func item(with id: UUID) -> VideoItem? {
        items.first { $0.id == id }
    }

    // MARK: Loading and saving

    func load() {
        do {
            try paths.ensureDirectories()
        } catch {
            lastError = .loadFailed(error.localizedDescription)
        }
        let url = paths.libraryFile
        if FileManager.default.fileExists(atPath: url.path) {
            do {
                let data = try Data(contentsOf: url)
                let document = try LibraryDocument.decoder.decode(LibraryDocument.self, from: data)
                items = document.items.sorted { $0.sortOrder < $1.sortOrder }
                lastError = nil
            } catch {
                // Keep the damaged file for inspection instead of silently
                // overwriting it on the next save, then start with an empty library.
                let stamp = Int(Date().timeIntervalSince1970)
                let aside = url.deletingLastPathComponent()
                    .appendingPathComponent("library.corrupt-\(stamp).json")
                try? FileManager.default.moveItem(at: url, to: aside)
                items = []
                lastError = .loadFailed(error.localizedDescription)
            }
        } else {
            items = []
        }
        refreshAvailability()
    }

    func save() throws {
        do {
            let document = LibraryDocument(version: LibraryDocument.currentVersion, items: items)
            let data = try LibraryDocument.encoder.encode(document)
            try data.write(to: paths.libraryFile, options: .atomic)
            lastError = nil
        } catch {
            let wrapped = LibraryError.saveFailed(error.localizedDescription)
            lastError = wrapped
            throw wrapped
        }
    }

    /// Re-checks every media file. Cheap (a stat per item); called whenever the
    /// app returns to the foreground or switches modes.
    func refreshAvailability() {
        var result: [UUID: MediaAvailability] = [:]
        for item in items {
            result[item.id] = media.availability(for: item)
        }
        availability = result
    }

    // MARK: Mutations

    func add(_ item: VideoItem) throws {
        var new = item
        new.sortOrder = (items.map(\.sortOrder).max() ?? -1) + 1
        items.append(new)
        availability[new.id] = media.availability(for: new)
        try save()
    }

    func rename(_ id: UUID, to title: String) throws {
        guard let index = items.firstIndex(where: { $0.id == id }) else { throw LibraryError.notFound }
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let newTitle = trimmed.isEmpty ? items[index].title : trimmed
        guard items[index].title != newTitle else { return }
        items[index].title = newTitle
        try save()
    }

    /// Stores a new thumbnail and points the record at it. The file name is
    /// unique every time (never reused, even within the same millisecond) so
    /// image caches refresh naturally and the old file can be removed safely.
    func setThumbnail(for id: UUID, jpegData: Data) throws {
        guard let index = items.firstIndex(where: { $0.id == id }) else { throw LibraryError.notFound }
        let name = "\(id.uuidString)-\(UUID().uuidString).jpg"
        do {
            try jpegData.write(to: paths.thumbnailDirectory.appendingPathComponent(name), options: .atomic)
        } catch {
            throw LibraryError.fileOperationFailed(error.localizedDescription)
        }
        let previous = items[index].thumbnailFileName
        items[index].thumbnailFileName = name
        try save()
        if let previous {
            try? media.deleteFile(at: paths.thumbnailDirectory.appendingPathComponent(previous))
        }
    }

    /// Removes the record and, when asked, its media and thumbnail files.
    func remove(_ id: UUID, deleteFiles: Bool) throws {
        guard let index = items.firstIndex(where: { $0.id == id }) else { throw LibraryError.notFound }
        let item = items[index]
        if deleteFiles {
            try media.deleteFile(at: paths.mediaURL(for: item))
            if let thumbnail = paths.thumbnailURL(for: item) {
                try? media.deleteFile(at: thumbnail)
            }
        }
        items.remove(at: index)
        availability[id] = nil
        try save()
    }

    /// Deletes only the media file and keeps the record, so the entry can be
    /// re-attached later (FR-05 "delete a downloaded file").
    func deleteMediaFile(for id: UUID) throws {
        guard let item = item(with: id) else { throw LibraryError.notFound }
        try media.deleteFile(at: paths.mediaURL(for: item))
        availability[id] = media.availability(for: item)
    }

    /// Moves the media (and metadata) of a freshly imported item onto an
    /// existing record, keeping the record's identity, title and thumbnail.
    func attachMedia(from imported: VideoItem, to id: UUID) throws {
        guard let index = items.firstIndex(where: { $0.id == id }) else { throw LibraryError.notFound }
        var item = items[index]
        if item.mediaFileName != imported.mediaFileName {
            try? media.deleteFile(at: paths.mediaURL(for: item))
        }
        item.mediaFileName = imported.mediaFileName
        item.durationSeconds = imported.durationSeconds
        item.fileSizeBytes = imported.fileSizeBytes
        item.pixelWidth = imported.pixelWidth
        item.pixelHeight = imported.pixelHeight
        if item.thumbnailFileName == nil {
            item.thumbnailFileName = imported.thumbnailFileName
        } else if let unused = imported.thumbnailFileName {
            try? media.deleteFile(at: paths.thumbnailDirectory.appendingPathComponent(unused))
        }
        items[index] = item
        availability[id] = media.availability(for: item)
        try save()
    }

    func move(fromOffsets source: IndexSet, toOffset destination: Int) throws {
        items.move(fromOffsets: source, toOffset: destination)
        for index in items.indices {
            items[index].sortOrder = index
        }
        try save()
    }
}

/// On-disk shape of `library.json`.
struct LibraryDocument: Codable {
    static let currentVersion = 1

    var version: Int
    var items: [VideoItem]

    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }

    static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
