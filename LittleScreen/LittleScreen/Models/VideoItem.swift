import Foundation

/// A parent-approved video in the library.
///
/// The record is deliberately separate from the media file on disk (FR-07):
/// `mediaFileName` names a file inside the app's media directory, and the
/// `MediaAvailability` tracked by `LibraryStore` says whether that file is
/// actually present and readable right now.
struct VideoItem: Codable, Identifiable, Hashable {
    /// Stable internal identifier. Never changes, even if the media is replaced.
    let id: UUID
    var title: String
    /// File name inside `AppPaths.mediaDirectory`.
    var mediaFileName: String
    /// File name inside `AppPaths.thumbnailDirectory`, or nil when no
    /// thumbnail could be generated (a placeholder is shown instead).
    var thumbnailFileName: String?
    var durationSeconds: Double?
    var fileSizeBytes: Int64?
    var pixelWidth: Int?
    var pixelHeight: Int?
    var createdAt: Date
    /// Position in the library grid; lower comes first.
    var sortOrder: Int

    init(
        id: UUID = UUID(),
        title: String,
        mediaFileName: String,
        thumbnailFileName: String? = nil,
        durationSeconds: Double? = nil,
        fileSizeBytes: Int64? = nil,
        pixelWidth: Int? = nil,
        pixelHeight: Int? = nil,
        createdAt: Date = Date(),
        sortOrder: Int = 0
    ) {
        self.id = id
        self.title = title
        self.mediaFileName = mediaFileName
        self.thumbnailFileName = thumbnailFileName
        self.durationSeconds = durationSeconds
        self.fileSizeBytes = fileSizeBytes
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.createdAt = createdAt
        self.sortOrder = sortOrder
    }
}

/// Whether the media file behind a `VideoItem` can be played right now.
enum MediaAvailability: Equatable {
    case available
    /// The record exists but its file is gone (deleted, or the import never finished).
    case missing
    /// The file exists but is empty or not readable.
    case unreadable

    var isPlayable: Bool { self == .available }

    var parentLabel: String {
        switch self {
        case .available: return "Available offline"
        case .missing: return "Video file missing"
        case .unreadable: return "Video file damaged"
        }
    }
}

extension VideoItem {
    var formattedDuration: String? {
        guard let durationSeconds, durationSeconds.isFinite, durationSeconds > 0 else { return nil }
        let total = Int(durationSeconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%d:%02d", minutes, seconds)
    }

    var formattedFileSize: String? {
        guard let fileSizeBytes else { return nil }
        return ByteCountFormatter.string(fromByteCount: fileSizeBytes, countStyle: .file)
    }

    var formattedDimensions: String? {
        guard let pixelWidth, let pixelHeight, pixelWidth > 0, pixelHeight > 0 else { return nil }
        return "\(pixelWidth) × \(pixelHeight)"
    }
}
