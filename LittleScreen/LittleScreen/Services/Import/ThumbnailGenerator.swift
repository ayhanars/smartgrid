import AVFoundation
import UIKit

enum ThumbnailGenerator {
    /// Long edge of stored thumbnails. Plenty for a two-column iPhone grid at 3×.
    static let defaultMaxDimension: CGFloat = 720
    static let jpegQuality: CGFloat = 0.85

    /// Grabs one frame of a local video as JPEG data.
    static func jpegData(for url: URL, at time: CMTime, maxDimension: CGFloat = defaultMaxDimension) async throws -> Data {
        let asset = AVURLAsset(url: url)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: maxDimension, height: maxDimension)
        let tolerance = CMTime(seconds: 0.5, preferredTimescale: 600)
        generator.requestedTimeToleranceBefore = tolerance
        generator.requestedTimeToleranceAfter = tolerance
        let (cgImage, _) = try await generator.image(at: time)
        guard let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: jpegQuality) else {
            throw ImportError.thumbnailFailed
        }
        return data
    }

    /// Scales a parent-chosen photo down to thumbnail size.
    static func jpegData(from image: UIImage) -> Data? {
        let size = image.size
        let longest = max(size.width, size.height)
        guard longest > 0 else { return nil }
        let scale = min(1, defaultMaxDimension / longest)
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let rendered = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        return rendered.jpegData(compressionQuality: jpegQuality)
    }
}
