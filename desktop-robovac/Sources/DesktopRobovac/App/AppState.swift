import AppKit
import Combine
import Foundation
import RobovacCore

/// Central observable state for the menu bar popover, preview and settings.
/// Owns the engine pieces and wires the robot overlay to a running session.
@MainActor
final class AppState: ObservableObject {
    enum Phase: Equatable {
        case idle
        case scanning
        case cleaning
        case paused
        case finishing

        var displayName: String {
            switch self {
            case .idle: return "Ready"
            case .scanning: return "Scanning…"
            case .cleaning: return "Cleaning"
            case .paused: return "Paused"
            case .finishing: return "Finishing up"
            }
        }
    }

    struct ScanProblem: Equatable {
        var message: String
        var isPermissionProblem: Bool
    }

    @Published var settings: RobovacSettings {
        didSet {
            guard settings != oldValue else { return }
            settingsStore.save(settings)
            sound.settingsDidChange(settings.sound)
            if settings.cleaning != oldValue.cleaning || settings.general.desktopURL != oldValue.general.desktopURL {
                scheduleRefresh()
            }
        }
    }
    @Published private(set) var plan: CleaningPlan?
    @Published private(set) var scanProblem: ScanProblem?
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var progress = CleaningProgress()
    @Published private(set) var currentFileName: String?
    @Published private(set) var lastSummary: CleaningSummary?
    @Published private(set) var sessions: [CleaningSession] = []
    @Published var interruptedSession: CleaningSession?
    @Published var lastUndoReport: UndoReport?
    @Published var undoInProgress = false
    @Published var robotState: RobotState = .idle

    let settingsStore: SettingsStore
    let bookmarks: BookmarkStore
    let history: CleaningHistoryStore
    let sound: SoundManager
    let overlay: RobotOverlayController

    private var coordinator: CleaningCoordinator?
    private var director: RobotSessionDirector?
    private var runTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?
    private var robotStateCancellable: AnyCancellable?

    init(
        settingsStore: SettingsStore = SettingsStore(),
        history: CleaningHistoryStore = CleaningHistoryStore(fileURL: CleaningHistoryStore.defaultFileURL())
    ) {
        self.settingsStore = settingsStore
        self.history = history
        let loaded = settingsStore.load()
        self.settings = loaded
        self.bookmarks = BookmarkStore()
        self.sound = SoundManager(settings: loaded.sound)
        self.overlay = RobotOverlayController()
        self.sessions = history.sessions

        robotStateCancellable = overlay.scene.$pose
            .map { $0.state }
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in self?.robotState = state }
    }

    // MARK: Lifecycle

    func start() {
        bookmarks.restoreAll()
        let interrupted = history.markRunningSessionsInterrupted()
        if let last = interrupted.sorted(by: { $0.startedAt > $1.startedAt }).first, !last.moves.isEmpty {
            interruptedSession = last
        }
        reloadHistory()
        scheduleRefresh()
    }

    func shutdown() {
        runTask?.cancel()
        director?.tearDown()
        overlay.hide()
        sound.stopAll()
        // A session that is still running when the app quits is recorded as interrupted,
        // so its moves stay undoable next launch.
        history.markRunningSessionsInterrupted()
        bookmarks.releaseAll()
    }

    // MARK: Derived state

    var desktopURL: URL { settings.general.desktopURL ?? DesktopScanner.defaultDesktopURL }
    var eligibleCount: Int { plan?.targets.count ?? 0 }
    var isCleaning: Bool { phase == .cleaning || phase == .paused || phase == .finishing }
    var isBusy: Bool { isCleaning || phase == .scanning }
    var needsPreview: Bool { settings.general.previewBeforeEveryRun || !settings.general.hasCompletedFirstPreview }
    var lastUndoableSession: CleaningSession? { history.lastUndoableSession }

    var cleanlinessDescription: String {
        guard let plan else { return scanProblem == nil ? "Scanning…" : "Desktop unavailable" }
        switch plan.targets.count {
        case 0: return "Spotless"
        case 1...5: return "Nearly tidy"
        case 6...20: return "A little dusty"
        default: return "Needs a clean"
        }
    }

    // MARK: Scanning

    func scheduleRefresh() {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled else { return }
            await self?.refreshPlan()
        }
    }

    func refreshPlan() async {
        guard !isCleaning else { return }
        let configuration = CleaningConfiguration(settings: settings)
        let planner = CleaningPlanner(configuration: configuration)
        if phase == .idle { phase = .scanning }
        let result: Result<CleaningPlan, Error> = await Task.detached(priority: .userInitiated) {
            Result { try planner.makePlan() }
        }.value
        guard !isCleaning else { return }
        switch result {
        case .success(let plan):
            self.plan = plan
            scanProblem = nil
        case .failure(let error):
            plan = nil
            scanProblem = AppState.describe(error)
        }
        if phase == .scanning { phase = .idle }
    }

    private static func describe(_ error: Error) -> ScanProblem {
        let nsError = error as NSError
        let permissionCodes: Set<Int> = [
            CocoaError.fileReadNoPermission.rawValue, CocoaError.fileWriteNoPermission.rawValue,
        ]
        if nsError.domain == NSCocoaErrorDomain, permissionCodes.contains(nsError.code) {
            return ScanProblem(
                message: "Desktop Robovac needs permission to read your Desktop folder.",
                isPermissionProblem: true
            )
        }
        if nsError.domain == NSPOSIXErrorDomain, nsError.code == Int(EACCES) || nsError.code == Int(EPERM) {
            return ScanProblem(
                message: "Desktop Robovac needs permission to read your Desktop folder.",
                isPermissionProblem: true
            )
        }
        return ScanProblem(message: error.localizedDescription, isPermissionProblem: false)
    }

    // MARK: Cleaning

    /// Starts a run with a fresh scan. The preview decision is made by the caller.
    func startCleaning() {
        guard !isBusy else { return }
        phase = .scanning
        lastSummary = nil
        lastUndoReport = nil
        runTask = Task { [weak self] in
            guard let self else { return }
            await self.performRun()
        }
    }

    private func performRun() async {
        let configuration = CleaningConfiguration(settings: settings)
        let planner = CleaningPlanner(configuration: configuration)
        let result: Result<CleaningPlan, Error> = await Task.detached(priority: .userInitiated) {
            Result { try planner.makePlan() }
        }.value

        let freshPlan: CleaningPlan
        switch result {
        case .success(let plan):
            freshPlan = plan
            scanProblem = nil
        case .failure(let error):
            scanProblem = AppState.describe(error)
            phase = .idle
            return
        }
        self.plan = freshPlan
        guard !freshPlan.targets.isEmpty else {
            phase = .idle
            return
        }

        let coordinator = CleaningCoordinator(history: history)
        let director = RobotSessionDirector(appState: self, overlay: overlay, sound: sound, settings: settings)
        await coordinator.setObserver(director)
        self.coordinator = coordinator
        self.director = director

        let orderedPlan = director.prepare(plan: freshPlan)
        progress = CleaningProgress(total: orderedPlan.targets.count)
        phase = .cleaning

        do {
            let summary = try await coordinator.run(plan: orderedPlan)
            lastSummary = summary
        } catch {
            // Only thrown when a run is already active, which the UI prevents.
        }

        progress = await coordinator.progress
        currentFileName = nil
        self.coordinator = nil
        self.director = nil
        phase = .idle
        reloadHistory()
        await refreshPlan()
    }

    func pause() {
        guard phase == .cleaning, let coordinator else { return }
        phase = .paused
        Task { await coordinator.pause() }
    }

    func resume() {
        guard phase == .paused, let coordinator else { return }
        phase = .cleaning
        Task { await coordinator.resume() }
    }

    func stop() {
        guard isCleaning, let coordinator else { return }
        phase = .finishing
        Task { await coordinator.cancel() }
    }

    func togglePause() {
        if phase == .paused { resume() } else { pause() }
    }

    /// Called by the director as the robot works through the plan.
    func progressDidChange(currentFile: String?) {
        currentFileName = currentFile
    }

    func refreshProgressFromCoordinator() async {
        guard let coordinator else { return }
        progress = await coordinator.progress
    }

    func coordinatorStateDidChange(_ state: CleaningCoordinator.State) {
        switch state {
        case .paused: if isCleaning { phase = .paused }
        case .running: if isCleaning { phase = .cleaning }
        case .cancelling: if isCleaning { phase = .finishing }
        case .idle, .finished: break
        }
    }

    func markPreviewSeen() {
        if !settings.general.hasCompletedFirstPreview {
            settings.general.hasCompletedFirstPreview = true
        }
    }

    // MARK: History and undo

    func reloadHistory() {
        sessions = history.sessions
    }

    func undoLastCleaning(resolution: UndoConflictResolution = .skip) async {
        guard let session = history.lastUndoableSession else { return }
        await undo(session: session, resolution: resolution)
    }

    func undo(session: CleaningSession, resolution: UndoConflictResolution = .skip) async {
        guard !isCleaning, !undoInProgress else { return }
        undoInProgress = true
        let service = UndoService(history: history)
        let report = await Task.detached(priority: .userInitiated) {
            service.undo(session: session, onConflict: resolution)
        }.value
        lastUndoReport = report
        undoInProgress = false
        if interruptedSession?.id == session.id { interruptedSession = nil }
        reloadHistory()
        await refreshPlan()
    }

    func clearHistory() {
        history.clear()
        reloadHistory()
    }

    // MARK: Folder helpers

    func setDefaultDestination(_ url: URL) {
        bookmarks.remember(url)
        settings.cleaning.destinations.defaultDestination = url
    }

    func setCategoryDestination(_ url: URL?, for category: FileCategory) {
        if let url {
            bookmarks.remember(url)
            settings.cleaning.destinations.categoryDestinations[category] = url
        } else {
            settings.cleaning.destinations.categoryDestinations.removeValue(forKey: category)
        }
    }

    func addExcludedFolder(_ url: URL) {
        let standardized = url.standardizedFileURL
        guard !settings.cleaning.rules.excludedFolders.contains(where: { $0.standardizedFileURL.path == standardized.path }) else { return }
        bookmarks.remember(standardized)
        settings.cleaning.rules.excludedFolders.append(standardized)
    }

    func removeExcludedFolder(_ url: URL) {
        settings.cleaning.rules.excludedFolders.removeAll { $0.standardizedFileURL.path == url.standardizedFileURL.path }
        bookmarks.forget(url)
    }

    func addExcludedFile(_ url: URL) {
        let standardized = url.standardizedFileURL
        guard !settings.cleaning.rules.excludedFiles.contains(where: { $0.standardizedFileURL.path == standardized.path }) else { return }
        settings.cleaning.rules.excludedFiles.append(standardized)
    }

    func removeExcludedFile(_ url: URL) {
        settings.cleaning.rules.excludedFiles.removeAll { $0.standardizedFileURL.path == url.standardizedFileURL.path }
    }

    func setDesktopOverride(_ url: URL?) {
        if let url {
            bookmarks.remember(url)
            settings.general.desktopURL = url.standardizedFileURL
        } else {
            settings.general.desktopURL = nil
        }
    }
}
