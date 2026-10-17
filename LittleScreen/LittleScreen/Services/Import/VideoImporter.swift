import AVFoundation
import Foundation
import UniformTypeIdentifiers

/// Brings a video picked from the Files app into the library (FR-06).
///
/// Order of operations matters: validate first (cheap, read-only), check free
/// space, copy into app storage, then make a thumbnail from *our* copy so the
/// result never depends on the picked file staying reachable.
struct VideoImporter: Sendable {
    let paths: AppPaths
    let media: MediaStore

    /// What the document picker offers. `.movie` covers MP4 and MOV.
    static let pickerTypes: [UTType] = [.movie]

    /// Video codecs every supported iPhone decodes in hardware. Anything else
    /// (VP9, AV1 on older devices, ProRes, MPEG-4 Part 2…) is rejected with a
    /// message that tells the parent how to re-export.
    static let supportedVideoCodecs: [CMFormatDescription.MediaSubType] = [.h264, .hevc]

    /// Space that must remain free after an import so iOS and other apps are
    /// not starved (FR-10 "insufficient device storage").
    static let storageHeadroom: Int64 = 200 * 1024 * 1024

    static let maxTitleLength = 80

    func importVideo(from pickedURL: URL) async throws -> VideoItem {
        let scoped = pickedURL.startAccessingSecurityScopedResource()
        defer { if scoped { pickedURL.stopAccessingSecurityScopedResource() } }

        try Self.checkFileType(of: pickedURL)
        try await Self.materialize(pickedURL)
        try checkStorage(for: pickedURL)

        let inspection = try await Self.inspect(pickedURL)
        try Task.checkCancellation()

        let id = UUID()
        let ext = pickedURL.pathExtension.isEmpty ? "mp4" : pickedURL.pathExtension.lowercased()
        let mediaFileName = "\(id.uuidString).\(ext)"
        let destination = paths.mediaDirectory.appendingPathComponent(mediaFileName)

        try paths.ensureDirectories()
        do {
            try await Self.copyFile(from: pickedURL, to: destination)
        } catch is CancellationError {
            try? media.deleteFile(at: destination)
            throw ImportError.cancelled
        } catch {
            try? media.deleteFile(at: destination)
            throw ImportError.copyFailed(error.localizedDescription)
        }

        if Task.isCancelled {
            try? media.deleteFile(at: destination)
            throw ImportError.cancelled
        }

        // A missing thumbnail is not fatal: the library shows a placeholder and
        // the parent can pick a frame later.
        var thumbnailFileName: String?
        if let data = try? await ThumbnailGenerator.jpegData(
            for: destination,
            at: Self.thumbnailTime(for: inspection.duration)
        ) {
            let name = "\(id.uuidString)-\(UUID().uuidString).jpg"
            if (try? data.write(to: paths.thumbnailDirectory.appendingPathComponent(name), options: .atomic)) != nil {
                thumbnailFileName = name
            }
        }

        return VideoItem(
            id: id,
            title: Self.defaultTitle(for: pickedURL),
            mediaFileName: mediaFileName,
            thumbnailFileName: thumbnailFileName,
            durationSeconds: inspection.duration.isFinite ? inspection.duration : nil,
            fileSizeBytes: try? media.fileSize(at: destination),
            pixelWidth: inspection.pixelWidth,
            pixelHeight: inspection.pixelHeight
        )
    }

    // MARK: Steps

    struct Inspection: Sendable {
        var duration: Double
        var pixelWidth: Int?
        var pixelHeight: Int?
    }

    static func checkFileType(of url: URL) throws {
        let ext = url.pathExtension.lowercased()
        guard let type = UTType(filenameExtension: ext) else {
            throw ImportError.unsupportedType(ext)
        }
        guard type.conforms(to: .movie) || type.conforms(to: .video) else {
            throw ImportError.unsupportedType(ext)
        }
    }

    /// Files picked from iCloud Drive may not be on the device yet. A
    /// coordinated read blocks until the file is downloaded (or fails).
    static func materialize(_ url: URL) async throws {
        try await Task.detached(priority: .userInitiated) {
            var coordinatorError: NSError?
            var readable = false
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinatorError) { readURL in
                readable = FileManager.default.isReadableFile(atPath: readURL.path)
            }
            if coordinatorError != nil { throw ImportError.unreadable }
            if !readable { throw ImportError.accessDenied }
        }.value
    }

    func checkStorage(for url: URL) throws {
        guard let size = try? media.fileSize(at: url),
              let free = media.availableCapacity() else { return }
        if free < size + Self.storageHeadroom {
            throw ImportError.insufficientStorage(required: size + Self.storageHeadroom, available: free)
        }
    }

    /// Reads the container and checks that iPhone can play it. Read-only.
    static func inspect(_ url: URL) async throws -> Inspection {
        let asset = AVURLAsset(url: url)
        let loaded: (Bool, CMTime, [AVAssetTrack])
        do {
            loaded = try await asset.load(.isPlayable, .duration, .tracks)
        } catch {
            throw ImportError.unreadable
        }
        let (isPlayable, duration, tracks) = loaded

        guard let videoTrack = tracks.first(where: { $0.mediaType == .video }) else {
            throw ImportError.noVideoTrack
        }

        let descriptions: [CMFormatDescription]
        do {
            descriptions = try await videoTrack.load(.formatDescriptions)
        } catch {
            throw ImportError.unreadable
        }
        let codecs = descriptions.map(\.mediaSubType)
        guard codecs.contains(where: { supportedVideoCodecs.contains($0) }) else {
            let name = codecs.first.map { fourCC($0.rawValue) } ?? "unknown"
            throw ImportError.unsupportedCodec(name)
        }
        guard isPlayable else { throw ImportError.notPlayable }

        var width: Int?
        var height: Int?
        if let geometry = try? await videoTrack.load(.naturalSize, .preferredTransform) {
            let (naturalSize, transform) = geometry
            let displayed = naturalSize.applying(transform)
            width = Int(abs(displayed.width).rounded())
            height = Int(abs(displayed.height).rounded())
        }

        return Inspection(duration: duration.seconds, pixelWidth: width, pixelHeight: height)
    }

    /// `FileManager.copyItem` streams through the kernel (and clones on APFS),
    /// so even multi-gigabyte files never enter the app's memory.
    static func copyFile(from source: URL, to destination: URL) async throws {
        try await Task.detached(priority: .utility) {
            try Task.checkCancellation()
            try FileManager.default.copyItem(at: source, to: destination)
        }.value
    }

    static func thumbnailTime(for duration: Double) -> CMTime {
        guard duration.isFinite, duration > 0 else { return .zero }
        // 10% in, clamped to 0.5–5 s: skips black lead-ins without landing on credits.
        let seconds = min(max(duration * 0.1, 0.5), min(5.0, duration))
        return CMTime(seconds: seconds, preferredTimescale: 600)
    }

    static func defaultTitle(for url: URL) -> String {
        let raw = url.deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let title = raw.isEmpty ? "Untitled video" : raw
        return String(title.prefix(maxTitleLength))
    }

    static func fourCC(_ code: FourCharCode) -> String {
        let bytes: [UInt8] = [
            UInt8((code >> 24) & 0xFF),
            UInt8((code >> 16) & 0xFF),
            UInt8((code >> 8) & 0xFF),
            UInt8(code & 0xFF),
        ]
        let text = String(decoding: bytes, as: UTF8.self).trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? "unknown" : text
    }
}
