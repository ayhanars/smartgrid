import Foundation

/// Errors raised while bringing a video into the library. Every case has a
/// parent-facing description that says what to do next (FR-06, FR-10).
enum ImportError: LocalizedError, Equatable {
    case accessDenied
    case unsupportedType(String)
    case unreadable
    case noVideoTrack
    case unsupportedCodec(String)
    case notPlayable
    case insufficientStorage(required: Int64, available: Int64)
    case copyFailed(String)
    case thumbnailFailed
    case cancelled

    var errorDescription: String? {
        switch self {
        case .accessDenied:
            return "LittleScreen wasn't allowed to read that file."
        case .unsupportedType(let ext):
            let shown = ext.isEmpty ? "That kind of file" : "“.\(ext)” files aren't supported and"
            return "\(shown) can't be imported. Choose an MP4 or MOV video."
        case .unreadable:
            return "That file couldn't be read. It may be damaged, still downloading from iCloud, or not a video."
        case .noVideoTrack:
            return "That file has no video in it."
        case .unsupportedCodec(let codec):
            return "This video uses the “\(codec)” codec, which iPhone can't play. Export it as an H.264 or HEVC MP4 and try again."
        case .notPlayable:
            return "iPhone can't play this video. Export it as an H.264 MP4 with AAC audio and try again."
        case .insufficientStorage(let required, let available):
            let need = ByteCountFormatter.string(fromByteCount: required, countStyle: .file)
            let have = ByteCountFormatter.string(fromByteCount: available, countStyle: .file)
            return "Not enough free space. This video needs \(need) but only \(have) is free on this iPhone."
        case .copyFailed(let reason):
            return "The video couldn't be copied into LittleScreen. (\(reason))"
        case .thumbnailFailed:
            return "A thumbnail couldn't be made for this video."
        case .cancelled:
            return "Import cancelled."
        }
    }
}

enum LibraryError: LocalizedError, Equatable {
    case loadFailed(String)
    case saveFailed(String)
    case notFound
    case fileOperationFailed(String)

    var errorDescription: String? {
        switch self {
        case .loadFailed(let reason):
            return "The library couldn't be loaded. (\(reason))"
        case .saveFailed(let reason):
            return "The library couldn't be saved. Check free space on this iPhone. (\(reason))"
        case .notFound:
            return "That video is no longer in the library."
        case .fileOperationFailed(let reason):
            return "A video file couldn't be changed. (\(reason))"
        }
    }
}
