import Foundation

public struct MoveRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let fileName: String
    public let originalPath: String
    public var destinationPath: String
    public let category: FileCategory
    public let timestamp: Date
    public var undone: Bool

    public init(
        id: UUID = UUID(),
        fileName: String,
        originalPath: String,
        destinationPath: String,
        category: FileCategory,
        timestamp: Date = Date(),
        undone: Bool = false
    ) {
        self.id = id
        self.fileName = fileName
        self.originalPath = originalPath
        self.destinationPath = destinationPath
        self.category = category
        self.timestamp = timestamp
        self.undone = undone
    }
}

public struct SkippedRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let fileName: String
    public let path: String
    public let reason: String

    public init(id: UUID = UUID(), fileName: String, path: String, reason: String) {
        self.id = id
        self.fileName = fileName
        self.path = path
        self.reason = reason
    }
}

public enum SessionStatus: String, Codable, Sendable {
    case running
    case completed
    case cancelled
    case interrupted

    public var displayName: String {
        switch self {
        case .running: return "Running"
        case .completed: return "Completed"
        case .cancelled: return "Stopped"
        case .interrupted: return "Interrupted"
        }
    }
}

public struct CleaningSession: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let startedAt: Date
    public var endedAt: Date?
    public let mode: CleaningMode
    public var status: SessionStatus
    public var moves: [MoveRecord]
    public var skipped: [SkippedRecord]
    public var failed: [SkippedRecord]

    public init(
        id: UUID = UUID(),
        startedAt: Date = Date(),
        endedAt: Date? = nil,
        mode: CleaningMode,
        status: SessionStatus = .running,
        moves: [MoveRecord] = [],
        skipped: [SkippedRecord] = [],
        failed: [SkippedRecord] = []
    ) {
        self.id = id
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.mode = mode
        self.status = status
        self.moves = moves
        self.skipped = skipped
        self.failed = failed
    }

    public var restorableMoves: [MoveRecord] { moves.filter { !$0.undone } }
    public var canUndo: Bool { status != .running && !restorableMoves.isEmpty }
    public var duration: TimeInterval { (endedAt ?? Date()).timeIntervalSince(startedAt) }
}

/// Persists cleaning sessions as JSON so every move can be undone, even after
/// the app was quit mid-session. Thread-safe.
public final class CleaningHistoryStore: @unchecked Sendable {
    public let fileURL: URL
    private let lock = NSLock()
    private var storage: [CleaningSession]
    /// Keep the history file from growing without bound.
    public var maximumSessions = 200

    public init(fileURL: URL) {
        self.fileURL = fileURL
        self.storage = CleaningHistoryStore.load(from: fileURL)
    }

    /// A store that only lives in memory (used by tests and previews).
    public static func inMemory() -> CleaningHistoryStore {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("robovac-history-\(UUID().uuidString).json")
        return CleaningHistoryStore(fileURL: url)
    }

    /// `~/Library/Application Support/Desktop Robovac/history.json`
    public static func defaultFileURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent("Desktop Robovac", isDirectory: true).appendingPathComponent("history.json")
    }

    /// Newest first.
    public var sessions: [CleaningSession] {
        lock.lock(); defer { lock.unlock() }
        return storage.sorted { $0.startedAt > $1.startedAt }
    }

    public func session(id: UUID) -> CleaningSession? {
        lock.lock(); defer { lock.unlock() }
        return storage.first { $0.id == id }
    }

    /// The most recent session that still has files to put back.
    public var lastUndoableSession: CleaningSession? {
        sessions.first { $0.canUndo }
    }

    public func upsert(_ session: CleaningSession) {
        lock.lock(); defer { lock.unlock() }
        if let index = storage.firstIndex(where: { $0.id == session.id }) {
            storage[index] = session
        } else {
            storage.append(session)
        }
        trimLocked()
        persistLocked()
    }

    public func markUndone(sessionID: UUID, recordIDs: Set<UUID>) {
        lock.lock(); defer { lock.unlock() }
        guard let index = storage.firstIndex(where: { $0.id == sessionID }) else { return }
        for i in storage[index].moves.indices where recordIDs.contains(storage[index].moves[i].id) {
            storage[index].moves[i].undone = true
        }
        persistLocked()
    }

    /// Sessions still marked as running when the app launches were cut short.
    @discardableResult
    public func markRunningSessionsInterrupted() -> [CleaningSession] {
        lock.lock(); defer { lock.unlock() }
        var changed: [CleaningSession] = []
        for i in storage.indices where storage[i].status == .running {
            storage[i].status = .interrupted
            if storage[i].endedAt == nil { storage[i].endedAt = Date() }
            changed.append(storage[i])
        }
        if !changed.isEmpty { persistLocked() }
        return changed
    }

    public func clear() {
        lock.lock(); defer { lock.unlock() }
        storage.removeAll()
        persistLocked()
    }

    private func trimLocked() {
        guard storage.count > maximumSessions else { return }
        storage.sort { $0.startedAt > $1.startedAt }
        storage = Array(storage.prefix(maximumSessions))
    }

    private func persistLocked() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        do {
            let data = try encoder.encode(storage)
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true
            )
            try data.write(to: fileURL, options: [.atomic])
        } catch {
            // History is best effort; a failed write must never stop a cleaning run.
        }
    }

    private static func load(from url: URL) -> [CleaningSession] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return (try? decoder.decode([CleaningSession].self, from: data)) ?? []
    }
}
