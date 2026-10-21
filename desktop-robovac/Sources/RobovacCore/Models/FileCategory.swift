import Foundation

/// The kinds of files the robot knows how to sort.
public enum FileCategory: String, Codable, CaseIterable, Hashable, Sendable, Identifiable {
    case screenshot
    case image
    case pdf
    case document
    case video
    case audio
    case archive
    case other

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .screenshot: return "Screenshots"
        case .image: return "Images"
        case .pdf: return "PDFs"
        case .document: return "Documents"
        case .video: return "Videos"
        case .audio: return "Audio"
        case .archive: return "Archives"
        case .other: return "Other files"
        }
    }

    /// SF Symbol name used by the app UI.
    public var symbolName: String {
        switch self {
        case .screenshot: return "camera.viewfinder"
        case .image: return "photo"
        case .pdf: return "doc.richtext"
        case .document: return "doc.text"
        case .video: return "film"
        case .audio: return "waveform"
        case .archive: return "archivebox"
        case .other: return "doc"
        }
    }
}
