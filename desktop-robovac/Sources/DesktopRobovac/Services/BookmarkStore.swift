import Foundation

/// Keeps security-scoped bookmarks for folders the user picked (destinations,
/// excluded folders, a custom Desktop). In a sandboxed build these are what
/// let the app touch those folders again after relaunch; outside the sandbox
/// they are harmless.
@MainActor
final class BookmarkStore {
    private let defaults: UserDefaults
    private let key = "robovac.bookmarks"
    private var accessedURLs: [URL] = []

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    private var stored: [String: Data] {
        get { defaults.dictionary(forKey: key) as? [String: Data] ?? [:] }
        set { defaults.set(newValue, forKey: key) }
    }

    /// Records a bookmark for `url` and starts accessing it.
    func remember(_ url: URL) {
        let standardized = url.standardizedFileURL
        var data = try? standardized.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
        if data == nil {
            data = try? standardized.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        }
        guard let data else { return }
        var all = stored
        all[standardized.path] = data
        stored = all
        startAccess(standardized)
    }

    func forget(_ url: URL) {
        var all = stored
        all.removeValue(forKey: url.standardizedFileURL.path)
        stored = all
    }

    /// Resolves every stored bookmark and starts accessing it for the app's lifetime.
    func restoreAll() {
        for (_, data) in stored {
            var stale = false
            guard let url = try? URL(
                resolvingBookmarkData: data,
                options: [.withSecurityScope],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            ) else { continue }
            startAccess(url)
            if stale { remember(url) }
        }
    }

    private func startAccess(_ url: URL) {
        if url.startAccessingSecurityScopedResource() {
            accessedURLs.append(url)
        }
    }

    func releaseAll() {
        for url in accessedURLs { url.stopAccessingSecurityScopedResource() }
        accessedURLs.removeAll()
    }
}
