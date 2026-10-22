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
        case rehearsing

        var displayName: String {
            switch self {
            case .idle: return "Ready"
            case .scanning: return "Scanning…"
            case .cleaning: return "Cleaning"
            case .paused: return "Paused"
            case .finishing: return "Finishing up"
            case .rehearsing: return "Test drive"
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
            if settings.general.desktopURL != oldValue.general.desktopURL {
                startWatchingDesktop()
            }
            if !settings.cleaning.autoCleanNewFiles { cancelAutoClean() }
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
    private var autoCleanTask: Task<Void, Never>?
    private var robotStateCancellable: AnyCancellable?
    private var watcher: DesktopWatcher?
    @Published private(set) var autoCleanCountdown: Int?

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
        startWatchingDesktop()
    }

    /// Keeps the counts live: any change on the Desktop triggers a rescan, and
    /// optionally an automatic run.
    func startWatchingDesktop() {
        let watcher = DesktopWatcher { [weak self] in
            guard let self else { return }
            self.desktopDidChange()
        }
        watcher.start(watching: desktopURL)
        self.watcher = watcher
    }

    private func desktopDidChange() {
        guard !isCleaning else { return }
        scheduleRefresh()
        scheduleAutoCleanIfNeeded()
    }

    private func scheduleAutoCleanIfNeeded() {
        autoCleanTask?.cancel()
        autoCleanCountdown = nil
        guard settings.cleaning.autoCleanNewFiles else { return }
        let delay = max(2, Int(settings.cleaning.autoCleanDelay.rounded()))
        autoCleanTask = Task { [weak self] in
            // Let the rescan land first, then count down so the user can cancel.
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard let self, !Task.isCancelled, self.eligibleCount > 0, !self.isBusy else {
                await MainActor.run { self?.autoCleanCountdown = nil }
                return
            }
            for remaining in stride(from: delay, to: 0, by: -1) {
                self.autoCleanCountdown = remaining
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled || self.isBusy || self.eligibleCount == 0 {
                    self.autoCleanCountdown = nil
                    return
                }
            }
            self.autoCleanCountdown = nil
            self.startCleaning()
        }
    }

    func cancelAutoClean() {
        autoCleanTask?.cancel()
        autoCleanTask = nil
        autoCleanCountdown = nil
    }

    func shutdown() {
        watcher?.stop()
        autoCleanTask?.cancel()
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
    var isRehearsing: Bool { phase == .rehearsing }
    var isBusy: Bool { isCleaning || isRehearsing || phase == .scanning }
    var needsPreview: Bool { settings.general.previewBeforeEveryRun }
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
    /// `toTrash` forces this run to send files to the Trash regardless of the setting.
    func startCleaning(toTrash: Bool? = nil) {
        guard !isBusy else { return }
        phase = .scanning
        lastSummary = nil
        lastUndoReport = nil
        runTask = Task { [weak self] in
            guard let self else { return }
            // Files that land while the robot is out are picked up by another pass,
            // so a run ends with a clear desktop rather than a stale list.
            var passes = 0
            var movedTotal = 0
            var combined: CleaningSummary?
            repeat {
                passes += 1
                guard let summary = await self.performRun(toTrash: toTrash, firstPass: passes == 1) else { break }
                movedTotal += summary.movedCount
                combined = summary
                if summary.status != .completed || passes >= 3 { break }
                await self.refreshPlan()
            } while self.eligibleCount > 0
            if let combined, passes > 1 {
                self.lastSummary = combined
                self.progress.moved = movedTotal
            }
        }
    }

    @discardableResult
    private func performRun(toTrash: Bool?, firstPass: Bool) async -> CleaningSummary? {
        let configuration = CleaningConfiguration(settings: settings, sendToTrash: toTrash)
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
            return nil
        }
        self.plan = freshPlan
        guard !freshPlan.targets.isEmpty else {
            phase = .idle
            return nil
        }

        let coordinator = CleaningCoordinator(history: history)
        let director = RobotSessionDirector(appState: self, overlay: overlay, sound: sound, settings: settings)
        await coordinator.setObserver(director)
        self.coordinator = coordinator
        self.director = director

        let orderedPlan = director.prepare(plan: freshPlan)
        progress = CleaningProgress(total: orderedPlan.targets.count)
        phase = .cleaning

        var result: CleaningSummary?
        do {
            let summary = try await coordinator.run(plan: orderedPlan)
            lastSummary = summary
            result = summary
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
        return result
    }

    /// Shows the robot and lets it drive around without moving any files.
    func runTestDrive() {
        guard !isBusy else { return }
        phase = .rehearsing
        let director = RobotSessionDirector(appState: self, overlay: overlay, sound: sound, settings: settings)
        self.director = director
        runTask = Task { [weak self] in
            await director.rehearse()
            guard let self else { return }
            if self.director === director { self.director = nil }
            if self.phase == .rehearsing { self.phase = .idle }
        }
    }

    /// Headless check used by CI: deploys the robot, prints what the window server
    /// knows about the overlay, then quits. Never touches files.
    func runSmokeTest() {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            for _ in 0..<40 where self.isBusy {
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            print("ROBOVAC-DIAG starting test drive, phase=\(self.phase)")
            self.runTestDrive()
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            print(self.overlayDiagnostics())
            fflush(stdout)
            try? await Task.sleep(nanoseconds: 12_000_000_000)
            print(self.overlayDiagnostics())
            fflush(stdout)
            NSApplication.shared.terminate(nil)
        }
    }

    func overlayDiagnostics() -> String {
        var lines: [String] = ["ROBOVAC-DIAG begin"]
        lines.append("build=\(BuildInfo.label) macOS=\(ProcessInfo.processInfo.operatingSystemVersionString) bundle=\(Bundle.main.bundleURL.lastPathComponent)")
        lines.append("settings showRobot=\(settings.general.showDesktopRobot) layer=\(settings.appearance.robotLayer) pattern=\(settings.appearance.movementPattern) size=\(settings.appearance.robotSize) reducedMotion=\(settings.appearance.reducedMotion) sound=\(settings.sound.enabled) motor=\(settings.sound.continuousMotorSound)")
        lines.append("mouse=\(NSEvent.mouseLocation) screens=\(NSScreen.screens.map { $0.frame })")
        lines.append("iconPositions=\(director?.iconPositionSource ?? "n/a") useFinder=\(settings.appearance.useFinderIconPositions)")
        lines.append("phase=\(phase) robotState=\(robotState)")
        let pose = overlay.scene.pose
        lines.append("pose position=\(pose.position) heading=\(pose.heading) state=\(pose.state) visible=\(pose.isVisible)")
        if let screen = overlay.targetScreen {
            lines.append("screen frame=\(screen.frame) visible=\(screen.visibleFrame) region=\(overlay.desktopRegion(on: screen)) anchor=\(overlay.menuBarAnchor(on: screen))")
        }
        for window in NSApp.windows {
            lines.append("window \(type(of: window)) frame=\(window.frame) level=\(window.level.rawValue) visible=\(window.isVisible) alpha=\(window.alphaValue) occlusionVisible=\(window.occlusionState.contains(.visible)) onActiveSpace=\(window.isOnActiveSpace)")
        }
        let pid = ProcessInfo.processInfo.processIdentifier
        if let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] {
            for info in list where (info[kCGWindowOwnerPID as String] as? Int32) == pid {
                let onscreen = info[kCGWindowIsOnscreen as String] as? Bool ?? false
                let layer = info[kCGWindowLayer as String] as? Int ?? -1
                let bounds = info[kCGWindowBounds as String] as? [String: Any] ?? [:]
                let alpha = info[kCGWindowAlpha as String] as? Double ?? -1
                lines.append("cgwindow id=\(info[kCGWindowNumber as String] ?? 0) onscreen=\(onscreen) layer=\(layer) alpha=\(alpha) bounds=\(bounds)")
            }
        }
        lines.append("ROBOVAC-DIAG end")
        return lines.joined(separator: "\n")
    }

    func copyDiagnosticsToClipboard() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(overlayDiagnostics(), forType: .string)
    }

    func stopTestDrive() {
        guard isRehearsing else { return }
        director?.tearDown()
        director = nil
        phase = .idle
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
