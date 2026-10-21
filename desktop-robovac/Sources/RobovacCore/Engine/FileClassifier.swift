import Foundation
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif

/// Assigns a `FileCategory` to a desktop item. Classification is deterministic
/// and based on the extension first, with platform type metadata as a fallback.
public struct FileClassifier: Sendable {
    public init() {}

    public static let imageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "heic", "heif", "tiff", "tif", "bmp", "webp", "svg",
        "psd", "ai", "raw", "cr2", "cr3", "nef", "arw", "dng", "avif", "ico", "jp2",
    ]
    public static let pdfExtensions: Set<String> = ["pdf"]
    public static let documentExtensions: Set<String> = [
        "doc", "docx", "pages", "txt", "rtf", "md", "markdown", "odt", "xls", "xlsx", "numbers",
        "csv", "tsv", "ppt", "pptx", "key", "epub", "ods", "odp", "tex", "rtfd",
    ]
    public static let videoExtensions: Set<String> = [
        "mov", "mp4", "m4v", "avi", "mkv", "webm", "mpg", "mpeg", "wmv", "flv", "3gp",
    ]
    public static let audioExtensions: Set<String> = [
        "mp3", "m4a", "wav", "aiff", "aif", "flac", "aac", "ogg", "opus", "caf", "wma",
    ]
    public static let archiveExtensions: Set<String> = [
        "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "dmg", "iso",
    ]

    /// Filename conventions used by macOS screenshots in common locales, plus a
    /// few popular screenshot tools. Matched case-insensitively at the start of the name.
    public static let screenshotNamePatterns: [String] = [
        #"^screen ?shot\b"#,
        #"^screenshot[ _-]"#,
        #"^bildschirmfoto\b"#,
        #"^capture d['’]écran\b"#,
        #"^captura de pantalla\b"#,
        #"^captura de tela\b"#,
        #"^schermafbeelding\b"#,
        #"^schermata\b"#,
        #"^skärmavbild\b"#,
        #"^skjermbilde\b"#,
        #"^skærmbillede\b"#,
        #"^zrzut ekranu\b"#,
        #"^snímek obrazovky\b"#,
        #"^ekran resmi\b"#,
        #"^снимок экрана\b"#,
        #"^スクリーンショット"#,
        #"^截屏"#,
        #"^屏幕快照"#,
        #"^螢幕快照"#,
        #"^스크린샷"#,
        #"^cleanshot\b"#,
        #"^scr-\d{8}"#,
    ]

    private static let compiledScreenshotPatterns: [NSRegularExpression] = {
        screenshotNamePatterns.compactMap { pattern in
            try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
        }
    }()

    /// Categories ordered the way the preview and settings UI list them.
    public func classify(_ item: DesktopItem) -> FileCategory {
        let base = baseCategory(for: item)
        if base == .image, isScreenshot(item) { return .screenshot }
        return base
    }

    /// True when the item is an image that looks like a screenshot, judged by
    /// macOS screenshot metadata or by a known screenshot naming convention.
    public func isScreenshot(_ item: DesktopItem) -> Bool {
        guard baseCategory(for: item) == .image else { return false }
        if item.hasScreenshotMetadata { return true }
        return FileClassifier.nameLooksLikeScreenshot(item.name)
    }

    public static func nameLooksLikeScreenshot(_ name: String) -> Bool {
        let range = NSRange(name.startIndex..<name.endIndex, in: name)
        for regex in compiledScreenshotPatterns where regex.firstMatch(in: name, options: [], range: range) != nil {
            return true
        }
        return false
    }

    /// Category ignoring the screenshot refinement.
    public func baseCategory(for item: DesktopItem) -> FileCategory {
        if item.isDirectory && !item.isPackage { return .other }
        let ext = item.fileExtension
        if !ext.isEmpty {
            if FileClassifier.imageExtensions.contains(ext) { return .image }
            if FileClassifier.pdfExtensions.contains(ext) { return .pdf }
            if FileClassifier.documentExtensions.contains(ext) { return .document }
            if FileClassifier.videoExtensions.contains(ext) { return .video }
            if FileClassifier.audioExtensions.contains(ext) { return .audio }
            if FileClassifier.archiveExtensions.contains(ext) { return .archive }
        }
        if let category = FileClassifier.categoryFromContentType(item.contentTypeIdentifier, fileExtension: ext) {
            return category
        }
        return .other
    }

    static func categoryFromContentType(_ identifier: String?, fileExtension: String) -> FileCategory? {
        #if canImport(UniformTypeIdentifiers)
        var type: UTType?
        if let identifier { type = UTType(identifier) }
        if type == nil, !fileExtension.isEmpty { type = UTType(filenameExtension: fileExtension) }
        guard let type else { return nil }
        if type.conforms(to: .pdf) { return .pdf }
        if type.conforms(to: .image) { return .image }
        if type.conforms(to: .movie) || type.conforms(to: .video) { return .video }
        if type.conforms(to: .audio) { return .audio }
        if type.conforms(to: .archive) { return .archive }
        if type.conforms(to: .text) || type.conforms(to: .presentation) || type.conforms(to: .spreadsheet)
            || type.conforms(to: .compositeContent) {
            return .document
        }
        return nil
        #else
        return nil
        #endif
    }
}
