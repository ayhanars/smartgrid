import Foundation

public enum UndoConflictResolution: Sendable {
    /// Leave the file at its destination and report the conflict.
    case skip
    /// Put the file back next to the occupying file under a new name.
    case restoreWithUniqueName
}

public struct UndoConflict: Equatable, Sendable, Identifiable {
    public let record: MoveRecord
    public let failure: RestoreFailure
    public var id: UUID { record.id }
}

public struct UndoReport: Equatable, Sendable {
    public var restored: [MoveRecord] = []
    public var conflicts: [UndoConflict] = []

    public var isComplete: Bool { conflicts.isEmpty }
}

/// Puts the files of a session back where they came from.
public struct UndoService: Sendable {
    public var fileOperations: FileOperationService
    public var history: CleaningHistoryStore

    public init(fileOperations: FileOperationService = FileOperationService(), history: CleaningHistoryStore) {
        self.fileOperations = fileOperations
        self.history = history
    }

    @discardableResult
    public func undo(session: CleaningSession, onConflict resolution: UndoConflictResolution = .skip) -> UndoReport {
        var report = UndoReport()
        var restoredIDs = Set<UUID>()
        for record in session.restorableMoves {
            let result = fileOperations.restore(
                from: URL(fileURLWithPath: record.destinationPath),
                to: URL(fileURLWithPath: record.originalPath),
                renameIfOccupied: resolution == .restoreWithUniqueName
            )
            switch result {
            case .success:
                report.restored.append(record)
                restoredIDs.insert(record.id)
            case .failure(let failure):
                report.conflicts.append(UndoConflict(record: record, failure: failure))
            }
        }
        if !restoredIDs.isEmpty {
            history.markUndone(sessionID: session.id, recordIDs: restoredIDs)
        }
        return report
    }
}
