import SwiftUI
import RobovacCore

/// The menu bar popover: a hero status card, three stat tiles, the mode picker
/// and one big action.
struct PopoverView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            heroCard
            statTiles
            if app.isCleaning { progressSection }
            if let countdown = app.autoCleanCountdown {
                notice("New files spotted. Auto-cleaning in \(countdown)s…", symbol: "timer", tint: .blue) {
                    HStack {
                        Button("Clean Now") { app.cancelAutoClean(); app.startCleaning() }
                        Button("Not Now") { app.cancelAutoClean() }
                    }
                    .controlSize(.small)
                }
            }
            if let problem = app.scanProblem { notice(problem.message, symbol: "exclamationmark.triangle.fill", tint: .orange) { problemActions(problem) } }
            if let interrupted = app.interruptedSession { interruptedSection(interrupted) }
            if let report = app.lastUndoReport, !report.isComplete { undoConflictSection(report) }
            if let summary = app.lastSummary, !app.isCleaning {
                summaryLine(summary)
                if let plan = app.plan, !plan.excluded.isEmpty { leftAloneLine(plan) }
            }
            modePicker
            primaryActions
            footer
        }
        .padding(14)
        .frame(width: 330)
    }

    // MARK: Hero

    private var heroCard: some View {
        HStack(spacing: 14) {
            RobotBadgeView(state: app.isCleaning || app.isRehearsing ? app.robotState : .idle, size: 54)
                .padding(4)
                .background(Circle().fill(.white.opacity(0.14)))
            VStack(alignment: .leading, spacing: 3) {
                Text("Desktop Robovac")
                    .font(.headline)
                    .foregroundStyle(.white)
                Text(heroStatus)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.85))
                    .lineLimit(2)
                Text(BuildInfo.label)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.45))
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(LinearGradient(colors: heroColors, startPoint: .topLeading, endPoint: .bottomTrailing))
        )
    }

    private var heroColors: [Color] {
        if app.isCleaning || app.isRehearsing {
            return [Color(red: 0.12, green: 0.45, blue: 0.95), Color(red: 0.05, green: 0.68, blue: 0.82)]
        }
        if app.scanProblem != nil {
            return [Color(red: 0.55, green: 0.35, blue: 0.2), Color(red: 0.8, green: 0.5, blue: 0.2)]
        }
        if app.eligibleCount == 0, app.plan != nil {
            return [Color(red: 0.1, green: 0.55, blue: 0.4), Color(red: 0.2, green: 0.7, blue: 0.5)]
        }
        return [Color(red: 0.22, green: 0.24, blue: 0.32), Color(red: 0.4, green: 0.42, blue: 0.52)]
    }

    private var heroStatus: String {
        if app.isRehearsing { return "Test drive: \(app.robotState.displayName.lowercased())" }
        if app.isCleaning {
            if let name = app.currentFileName { return "\(app.robotState.displayName) · \(name)" }
            return app.robotState.displayName
        }
        if app.phase == .scanning, app.plan == nil { return "Scanning the Desktop…" }
        if app.scanProblem != nil { return "Can’t read the Desktop" }
        guard let plan = app.plan else { return "Ready" }
        let count = plan.targets.count
        if count == 0 { return "Spotless. Nothing to clean." }
        return "\(count) item\(count == 1 ? "" : "s") waiting · \(app.cleanlinessDescription.lowercased())"
    }

    // MARK: Stats

    private var statTiles: some View {
        HStack(spacing: 8) {
            statTile(value: app.plan.map { "\($0.targets.count)" } ?? "–", label: "To clean", symbol: "tray.full")
            statTile(value: app.isCleaning || app.lastSummary != nil ? "\(app.progress.moved)" : "–", label: "Cleaned", symbol: "checkmark.circle")
            statTile(value: "\(app.sessions.count)", label: "Sessions", symbol: "clock.arrow.circlepath")
        }
    }

    private func statTile(value: String, label: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Image(systemName: symbol).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold)).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.quaternary.opacity(0.6)))
    }

    // MARK: Progress and notices

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            ProgressView(value: app.progress.fraction)
            HStack {
                Text(app.currentFileName.map { "Collecting \($0)" } ?? "Working…")
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Text("\(app.progress.processed)/\(app.progress.total)")
                    .monospacedDigit()
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    private func notice<Actions: View>(_ message: String, symbol: String, tint: Color, @ViewBuilder actions: () -> Actions) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(message, systemImage: symbol)
                .font(.callout)
                .foregroundStyle(tint)
            actions()
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(tint.opacity(0.1)))
    }

    private func problemActions(_ problem: AppState.ScanProblem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if problem.isPermissionProblem {
                Text("Allow Desktop Robovac under System Settings › Privacy & Security › Files and Folders.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack {
                if problem.isPermissionProblem {
                    Button("Open Privacy Settings") { SystemLinks.openFilesAndFoldersPrivacy() }
                }
                Button("Try Again") { Task { await app.refreshPlan() } }
            }
            .controlSize(.small)
        }
    }

    private func interruptedSection(_ session: CleaningSession) -> some View {
        notice("The last cleaning was interrupted after moving \(session.moves.count) file\(session.moves.count == 1 ? "" : "s").", symbol: "bolt.slash.fill", tint: .orange) {
            HStack {
                Button("Undo It") { Task { await app.undo(session: session) } }
                    .disabled(app.undoInProgress)
                Button("Dismiss") { app.interruptedSession = nil }
            }
            .controlSize(.small)
        }
    }

    private func undoConflictSection(_ report: UndoReport) -> some View {
        notice("\(report.restored.count) restored, \(report.conflicts.count) could not go back.", symbol: "arrow.uturn.backward.circle.fill", tint: .blue) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(report.conflicts.prefix(3)) { conflict in
                    Text("\(conflict.record.fileName): \(conflict.failure.message)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if report.conflicts.contains(where: { $0.failure == .originalOccupied }) {
                    Button("Restore With New Names") {
                        Task { await app.undoLastCleaning(resolution: .restoreWithUniqueName) }
                    }
                    .controlSize(.small)
                    .disabled(app.undoInProgress)
                }
            }
        }
    }

    private func summaryLine(_ summary: CleaningSummary) -> some View {
        HStack(spacing: 6) {
            Image(systemName: summary.status == .completed ? "checkmark.seal.fill" : "stop.circle")
                .foregroundStyle(summary.status == .completed ? Color.green : Color.secondary)
            Text(summaryText(summary))
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
    }

    /// Files the rules keep on the Desktop, so a "missed" file is never a mystery.
    private func leftAloneLine(_ plan: CleaningPlan) -> some View {
        var counts: [String: Int] = [:]
        for decision in plan.excluded {
            counts[decision.exclusionReason?.shortLabel ?? "excluded", default: 0] += 1
        }
        let parts = counts.sorted { $0.value > $1.value }.prefix(3).map { "\($0.value) \($0.key)" }
        return HStack(spacing: 6) {
            Image(systemName: "hand.raised").foregroundStyle(.secondary)
            Text("Left alone by your rules: \(parts.joined(separator: ", "))")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer()
            Button("Why?") { showPreview() }
                .controlSize(.mini)
                .help("See every item and the rule that keeps it on the Desktop")
        }
    }

    private func summaryText(_ summary: CleaningSummary) -> String {
        var parts = ["\(summary.movedCount) moved"]
        if summary.skippedCount > 0 { parts.append("\(summary.skippedCount) skipped") }
        if summary.failedCount > 0 { parts.append("\(summary.failedCount) failed") }
        let prefix = summary.status == .completed ? "Done" : summary.status.displayName
        return "\(prefix): " + parts.joined(separator: ", ")
    }

    // MARK: Actions

    private var modePicker: some View {
        Picker("Mode", selection: $app.settings.cleaning.mode) {
            ForEach(CleaningMode.allCases) { mode in
                Text(mode.displayName).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .disabled(app.isCleaning)
        .help(app.settings.cleaning.mode.summary)
    }

    private var primaryActions: some View {
        HStack(spacing: 8) {
            if app.isRehearsing {
                Button {
                    app.stopTestDrive()
                } label: {
                    Label("Stop Test Drive", systemImage: "stop.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            } else if app.isCleaning {
                Button {
                    app.togglePause()
                } label: {
                    Label(app.phase == .paused ? "Resume" : "Pause", systemImage: app.phase == .paused ? "play.fill" : "pause.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(app.phase == .finishing)
                Button(role: .destructive) {
                    app.stop()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                }
                .controlSize(.large)
                .disabled(app.phase == .finishing)
            } else {
                Button {
                    if app.needsPreview { showPreview() } else { app.startCleaning() }
                } label: {
                    Label("Start Cleaning", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)
                .disabled(app.isBusy || app.eligibleCount == 0)

                Button {
                    showPreview()
                } label: {
                    Label("Preview", systemImage: "list.bullet.rectangle")
                }
                .controlSize(.large)
                .disabled(app.isBusy)
                .help("See what will move before starting")
            }
        }
    }

    private var footer: some View {
        HStack(spacing: 4) {
            if let session = app.lastUndoableSession, !app.isCleaning {
                Button {
                    Task { await app.undo(session: session) }
                } label: {
                    Label("Undo Last Cleaning", systemImage: "arrow.uturn.backward")
                }
                .disabled(app.undoInProgress)
                .help("Put the files from the last cleaning back")
            }
            Button {
                app.runTestDrive()
            } label: {
                Label("Test Drive", systemImage: "scope")
            }
            .disabled(app.isBusy)
            .help("Watch the robot without moving any files")
            Spacer()
            SettingsLink {
                Label("Settings", systemImage: "gearshape")
            }
            .simultaneousGesture(TapGesture().onEnded { NSApp.activate(ignoringOtherApps: true) })
            .help("Settings")
            Button {
                NSApplication.shared.terminate(nil)
            } label: {
                Label("Quit", systemImage: "power")
            }
            .help("Quit Desktop Robovac")
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .controlSize(.large)
        .foregroundStyle(.secondary)
    }

    private func showPreview() {
        openWindow(id: WindowID.preview)
        NSApp.activate(ignoringOtherApps: true)
    }
}
