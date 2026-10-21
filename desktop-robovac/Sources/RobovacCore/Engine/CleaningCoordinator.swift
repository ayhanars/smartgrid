import Foundation

/// Progress of the active run.
public struct CleaningProgress: Equatable, Sendable {
    public var total: Int
    public var processed: Int
    public var moved: Int
    public var failed: Int
    public var skipped: Int
    public var currentFileName: String?

    public init(total: Int = 0, processed: Int = 0, moved: Int = 0, failed: Int = 0, skipped: Int = 0, currentFileName: String? = nil) {
        self.total = total
        self.processed = processed
        self.moved = moved
        self.failed = failed
        self.skipped = skipped
        self.currentFileName = currentFileName
    }

    public var fraction: Double { total == 0 ? 1 : Double(processed) / Double(total) }
}

/// What happened over a whole run.
public struct CleaningSummary: Equatable, Sendable {
    public let session: CleaningSession
    public var status: SessionStatus { session.status }
    public var movedCount: Int { session.moves.count }
    public var failedCount: Int { session.failed.count }
    public var skippedCount: Int { session.skipped.count }
    public var duration: TimeInterval { session.duration }

    public init(session: CleaningSession) { self.session = session }
}

/// Hooks the animation layer implements. Every method is awaited, so the robot
/// can take as long as it likes to drive to a file; the file operation only
/// happens once `sessionWillCollect` returns. A `nil` observer runs headless.
public protocol CleaningSessionObserver: AnyObject {
    func sessionDidStart(_ plan: CleaningPlan) async
    /// Pick which of the remaining targets to collect next. Lets the robot wander
    /// and grab whichever file it bumps into. Return nil to use the plan's order.
    func sessionChooseNextTarget(from remaining: [CleaningTarget]) async -> CleaningTarget?
    /// Drive to the file and play the suction animation. Return when the file may be moved.
    func sessionWillCollect(_ target: CleaningTarget, index: Int, total: Int) async
    func sessionDidCollect(_ target: CleaningTarget, result: Result<URL, MoveFailure>) async
    func sessionDidChangeState(_ state: CleaningCoordinator.State) async
    func sessionDidFinish(_ summary: CleaningSummary) async
}

public extension CleaningSessionObserver {
    func sessionChooseNextTarget(from remaining: [CleaningTarget]) async -> CleaningTarget? { nil }
}

public enum CleaningError: Error, Equatable {
    case alreadyRunning
}

/// Drives one cleaning session from start to finish: pause, resume, cancel,
/// progress, history. The file engine stays correct even when no observer is
/// attached or an animation is interrupted.
public actor CleaningCoordinator {
    public enum State: Equatable, Sendable {
        case idle
        case running
        case paused
        case cancelling
        case finished
    }

    public private(set) var state: State = .idle
    public private(set) var progress = CleaningProgress()

    private let fileOperations: FileOperationService
    private let history: CleaningHistoryStore
    private weak var observer: (any CleaningSessionObserver)?
    private var cancelRequested = false
    private var resumeWaiters: [CheckedContinuation<Void, Never>] = []

    public init(
        fileOperations: FileOperationService = FileOperationService(),
        history: CleaningHistoryStore,
        observer: (any CleaningSessionObserver)? = nil
    ) {
        self.fileOperations = fileOperations
        self.history = history
        self.observer = observer
    }

    public func setObserver(_ observer: (any CleaningSessionObserver)?) {
        self.observer = observer
    }

    // MARK: Control

    public func pause() async {
        guard state == .running else { return }
        state = .paused
        await observer?.sessionDidChangeState(state)
    }

    public func resume() async {
        guard state == .paused else { return }
        state = .running
        releaseWaiters()
        await observer?.sessionDidChangeState(state)
    }

    public func cancel() async {
        guard state == .running || state == .paused else { return }
        cancelRequested = true
        state = .cancelling
        releaseWaiters()
        await observer?.sessionDidChangeState(state)
    }

    private func releaseWaiters() {
        let waiters = resumeWaiters
        resumeWaiters.removeAll()
        for waiter in waiters { waiter.resume() }
    }

    private func waitWhilePaused() async {
        while state == .paused {
            await withCheckedContinuation { continuation in
                resumeWaiters.append(continuation)
            }
        }
    }

    // MARK: Run

    /// Processes every target in `plan`, in order. Returns when the run is complete or cancelled.
    public func run(plan: CleaningPlan) async throws -> CleaningSummary {
        guard state == .idle || state == .finished else { throw CleaningError.alreadyRunning }
        state = .running
        cancelRequested = false
        progress = CleaningProgress(total: plan.targets.count)

        var session = CleaningSession(mode: plan.configuration.mode)
        history.upsert(session)
        await observer?.sessionDidStart(plan)
        await observer?.sessionDidChangeState(state)

        let total = plan.targets.count
        var remaining = plan.targets
        var index = 0
        while !remaining.isEmpty {
            await waitWhilePaused()
            if cancelRequested { break }

            // The observer may wander first; it can take as long as it likes.
            var target = remaining[0]
            if let chosen = await observer?.sessionChooseNextTarget(from: remaining),
               let position = remaining.firstIndex(where: { $0.id == chosen.id }) {
                target = remaining[position]
                remaining.remove(at: position)
            } else {
                remaining.removeFirst()
            }
            await waitWhilePaused()
            if cancelRequested { break }
            defer { index += 1 }

            progress.currentFileName = target.item.name
            await observer?.sessionWillCollect(target, index: index, total: total)

            // The user may have paused or stopped while the robot was driving.
            await waitWhilePaused()
            if cancelRequested { break }

            let result = fileOperations.move(item: target.item, toDirectory: target.destinationDirectory)
            switch result {
            case .success(let destination):
                session.moves.append(MoveRecord(
                    fileName: target.item.name,
                    originalPath: target.item.url.standardizedFileURL.path,
                    destinationPath: destination.path,
                    category: target.category
                ))
                progress.moved += 1
            case .failure(let failure):
                let record = SkippedRecord(
                    fileName: target.item.name,
                    path: target.item.url.standardizedFileURL.path,
                    reason: failure.message
                )
                if failure.isSkip {
                    session.skipped.append(record)
                    progress.skipped += 1
                } else {
                    session.failed.append(record)
                    progress.failed += 1
                }
            }
            progress.processed += 1
            history.upsert(session)
            await observer?.sessionDidCollect(target, result: result)
        }

        session.status = cancelRequested ? .cancelled : .completed
        session.endedAt = Date()
        history.upsert(session)
        progress.currentFileName = nil
        state = .finished

        let summary = CleaningSummary(session: session)
        await observer?.sessionDidChangeState(state)
        await observer?.sessionDidFinish(summary)
        return summary
    }
}
