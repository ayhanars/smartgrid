import Foundation
import Observation

/// Runs a batch of imports one after another and exposes progress for the
/// parent UI. Sequential on purpose: copying several large files at once only
/// thrashes the disk, and one bad file must not take the others down.
@MainActor
@Observable
final class ImportSession: Identifiable {
    struct Entry: Identifiable {
        let id = UUID()
        let fileName: String
        var status: Status = .waiting
    }

    enum Status: Equatable {
        case waiting
        case importing
        case done
        case failed(String)
    }

    let id = UUID()
    private(set) var entries: [Entry] = []
    private(set) var isRunning = false
    @ObservationIgnored private var task: Task<Void, Never>?

    var completedCount: Int { entries.filter { $0.status == .done }.count }
    var failedCount: Int {
        entries.filter {
            if case .failed = $0.status { return true }
            return false
        }.count
    }

    /// Imports each URL and adds it to the library. When `replacing` is set the
    /// single import is attached to that existing record instead.
    func start(urls: [URL], importer: VideoImporter, library: LibraryStore, replacing targetID: UUID? = nil) {
        entries = urls.map { Entry(fileName: $0.lastPathComponent) }
        isRunning = true
        task = Task { [weak self] in
            for (index, url) in urls.enumerated() {
                guard let self, !Task.isCancelled else { break }
                self.entries[index].status = .importing
                do {
                    let item = try await importer.importVideo(from: url)
                    do {
                        if let targetID, index == 0 {
                            try library.attachMedia(from: item, to: targetID)
                        } else {
                            try library.add(item)
                        }
                        self.entries[index].status = .done
                    } catch {
                        // Metadata could not be saved: do not leave an orphaned file behind.
                        try? library.media.deleteFile(at: library.paths.mediaURL(for: item))
                        if let thumb = library.paths.thumbnailURL(for: item) {
                            try? library.media.deleteFile(at: thumb)
                        }
                        self.entries[index].status = .failed(error.localizedDescription)
                    }
                } catch {
                    self.entries[index].status = .failed(error.localizedDescription)
                }
            }
            self?.isRunning = false
        }
    }

    func cancel() {
        task?.cancel()
        for index in entries.indices where entries[index].status == .waiting {
            entries[index].status = .failed(ImportError.cancelled.localizedDescription)
        }
    }
}
