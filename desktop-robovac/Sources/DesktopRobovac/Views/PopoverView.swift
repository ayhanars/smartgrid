import SwiftUI
import RobovacCore

/// The menu bar popover: status, counts, mode, and the main controls.
struct PopoverView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            Divider()
            statusGrid
            if app.isCleaning { progressSection }
            if let problem = app.scanProblem { problemSection(problem) }
            if let interrupted = app.interruptedSession { interruptedSection(interrupted) }
            if let report = app.lastUndoReport, !report.isComplete { undoConflictSection(report) }
            if let summary = app.lastSummary, !app.isCleaning { summarySection(summary) }
            modePicker
            primaryActions
            Divider()
            footer
        }
        .padding(14)
        .frame(width: 320)
    }

    // MARK: Sections

    private var header: some View {
        HStack(spacing: 10) {
            RobotBadgeView(state: app.isCleaning || app.isRehearsing ? app.robotState : .idle, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("Desktop Robovac").font(.headline)
                    Text(BuildInfo.label).font(.caption2).foregroundStyle(.tertiary)
                }
                Text(app.isCleaning || app.isRehearsing ? app.robotState.displayName : app.phase.displayName)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private var statusGrid: some View {
        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
            GridRow {
                Text("Desktop").foregroundStyle(.secondary)
                Text(desktopStatusText)
            }
            GridRow {
                Text("Cleaned this run").foregroundStyle(.secondary)
                Text(app.isCleaning || app.lastSummary != nil ? "\(app.progress.moved)" : "–")
            }
            GridRow {
                Text("Mode").foregroundStyle(.secondary)
                Text(app.settings.cleaning.mode.displayName)
            }
        }
        .font(.callout)
    }

    private var desktopStatusText: String {
        if app.phase == .scanning, app.plan == nil { return "Scanning…" }
        guard let plan = app.plan else { return app.cleanlinessDescription }
        let count = plan.targets.count
        if count == 0 { return "Spotless · nothing to clean" }
        return "\(count) item\(count == 1 ? "" : "s") to clean · \(app.cleanlinessDescription)"
    }

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

    private func problemSection(_ problem: AppState.ScanProblem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(problem.message, systemImage: "exclamationmark.triangle")
                .font(.callout)
            if problem.isPermissionProblem {
                Text("Open System Settings › Privacy & Security › Files and Folders and allow Desktop Robovac to access the Desktop folder. Sandboxed builds can also pick the Desktop folder in Settings › General.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Open Privacy Settings") { SystemLinks.openFilesAndFoldersPrivacy() }
                    Button("Try Again") { Task { await app.refreshPlan() } }
                }
                .controlSize(.small)
            } else {
                Button("Try Again") { Task { await app.refreshPlan() } }
                    .controlSize(.small)
            }
        }
        .padding(8)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
    }

    private func interruptedSection(_ session: CleaningSession) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("The last cleaning was interrupted after moving \(session.moves.count) file\(session.moves.count == 1 ? "" : "s").", systemImage: "bolt.slash")
                .font(.callout)
            HStack {
                Button("Undo It") { Task { await app.undo(session: session) } }
                    .disabled(app.undoInProgress)
                Button("Dismiss") { app.interruptedSession = nil }
            }
            .controlSize(.small)
        }
        .padding(8)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
    }

    private func undoConflictSection(_ report: UndoReport) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("\(report.restored.count) restored, \(report.conflicts.count) could not go back.", systemImage: "arrow.uturn.backward.circle")
                .font(.callout)
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
        .padding(8)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
    }

    private func summarySection(_ summary: CleaningSummary) -> some View {
        HStack(spacing: 6) {
            Image(systemName: summary.status == .completed ? "checkmark.circle.fill" : "stop.circle")
                .foregroundStyle(summary.status == .completed ? Color.green : Color.secondary)
            Text(summaryText(summary))
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
    }

    private func summaryText(_ summary: CleaningSummary) -> String {
        var parts = ["\(summary.movedCount) moved"]
        if summary.skippedCount > 0 { parts.append("\(summary.skippedCount) skipped") }
        if summary.failedCount > 0 { parts.append("\(summary.failedCount) failed") }
        let prefix = summary.status == .completed ? "Done" : summary.status.displayName
        return "\(prefix): " + parts.joined(separator: ", ")
    }

    private var modePicker: some View {
        Picker("Mode", selection: $app.settings.cleaning.mode) {
            ForEach(CleaningMode.allCases) { mode in
                Text(mode.displayName).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .disabled(app.isCleaning)
    }

    private var primaryActions: some View {
        HStack(spacing: 8) {
            if app.isRehearsing {
                Text("Test drive in progress…").foregroundStyle(.secondary)
                Spacer()
                Button("Stop") { app.stopTestDrive() }
            } else if app.isCleaning {
                Button(app.phase == .paused ? "Resume" : "Pause") { app.togglePause() }
                    .disabled(app.phase == .finishing)
                Button("Stop", role: .destructive) { app.stop() }
                    .disabled(app.phase == .finishing)
                Spacer()
            } else {
                Button {
                    if app.needsPreview {
                        showPreview()
                    } else {
                        app.startCleaning()
                    }
                } label: {
                    Label("Start Cleaning", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(app.isBusy || app.eligibleCount == 0)

                Button("Preview") { showPreview() }
                    .disabled(app.isBusy)
            }
        }
    }

    private var footer: some View {
        HStack {
            if let session = app.lastUndoableSession, !app.isCleaning {
                Button {
                    Task { await app.undo(session: session) }
                } label: {
                    Label("Undo Last Cleaning", systemImage: "arrow.uturn.backward")
                }
                .disabled(app.undoInProgress)
            }
            Spacer()
            SettingsLink {
                Label("Settings", systemImage: "gearshape")
            }
            .simultaneousGesture(TapGesture().onEnded { NSApp.activate(ignoringOtherApps: true) })
            Button {
                NSApplication.shared.terminate(nil)
            } label: {
                Label("Quit", systemImage: "power")
            }
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .controlSize(.large)
        .help("Undo the last cleaning, open Settings, or quit")
    }

    private func showPreview() {
        openWindow(id: WindowID.preview)
        NSApp.activate(ignoringOtherApps: true)
    }
}
