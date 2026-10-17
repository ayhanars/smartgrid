import SwiftUI
import UIKit

/// Decoded thumbnails kept in memory so the grid scrolls without re-reading
/// JPEGs from disk (5.4 "thumbnails should be cached").
final class ThumbnailCache: @unchecked Sendable {
    static let shared = ThumbnailCache()

    private let cache = NSCache<NSString, UIImage>()

    init() {
        cache.countLimit = 300
    }

    func image(for url: URL, key: String) async -> UIImage? {
        if let hit = cache.object(forKey: key as NSString) { return hit }
        let loaded = await Task.detached(priority: .userInitiated) { () -> UIImage? in
            guard let data = try? Data(contentsOf: url), let image = UIImage(data: data) else { return nil }
            return image.preparingForDisplay() ?? image
        }.value
        if let loaded {
            cache.setObject(loaded, forKey: key as NSString)
        }
        return loaded
    }
}

/// A video's thumbnail, or a neutral placeholder when there is none.
struct ThumbnailImage: View {
    let item: VideoItem
    @Environment(AppModel.self) private var app
    @State private var image: UIImage?

    var body: some View {
        Rectangle()
            .fill(Color(.tertiarySystemFill))
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: "film")
                        .font(.system(size: 36))
                        .foregroundStyle(.secondary)
                }
            }
            .clipped()
            .task(id: item.thumbnailFileName) {
                guard let key = item.thumbnailFileName,
                      let url = app.library.paths.thumbnailURL(for: item) else {
                    image = nil
                    return
                }
                image = await ThumbnailCache.shared.image(for: url, key: key)
            }
    }
}
