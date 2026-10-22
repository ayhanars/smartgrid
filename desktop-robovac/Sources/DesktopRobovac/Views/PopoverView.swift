import SwiftUI
import RobovacCore

/// The menu bar popover, laid out after the Claude Design handoff: hero card,
/// stat tiles, progress, notices, result, mode tabs, route and trail pills,
/// destination card, main actions and a labelled footer.
struct PopoverView: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.openWindow) private var openWindow
    @State private var confirmTrash = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            hero
            stats
            if app.isCleaning { progressCard }
            notices
            if let summary = app.lastSummary, !app.isCleaning, !app.isRehearsing { resultCard(summary) }
            modeTabs
            routeSection
            trailSection
            destinationSection
            primaryActions
            footer
        }
        .padding(12)
        .frame(width: 340)
        .font(DS.body)
        .foregroundStyle(DS.text)
    }

    // MARK: Hero

    private var heroTint: DS.Tint {
        if app.isCleaning || app.isRehearsing { return .blue }
        if app.scanProblem != nil { return .orange }
        if let plan = app.plan, plan.targets.isEmpty { return .green }
        return .grey
    }

    private var heroStatus: String {
        if app.isRehearsing { return "Test drive: \(app.robotState.displayName.lowercased())" }
        if app.phase == .paused { return "Paused · \(app.progress.processed) of \(app.progress.total) collected" }
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

    private var hero: some View {
        HStack(spacing: 12) {
            RobotBadgeView(state: app.isCleaning || app.isRehearsing ? app.robotState : .idle, size: 48, skin: app.settings.appearance.robotSkin)
                .frame(width: 54, height: 54)
            VStack(alignment: .leading, spacing: 3) {
                Text("Desktop Robovac").font(DS.title).tracking(-0.15)
                Text(heroStatus)
                    .font(DS.body)
                    .foregroundStyle(heroTint.foreground)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(EdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14))
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(heroTint.background))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(DS.hairline, lineWidth: 0.5))
        .overlay(alignment: .topTrailing) {
            Text(BuildInfo.label)
                .font(DS.micro)
                .monospacedDigit()
                .foregroundStyle(DS.tertiary)
                .padding(.top, 8)
                .padding(.trailing, 11)
        }
    }

    // MARK: Stats

    private var stats: some View {
        HStack(spacing: 8) {
            statTile(value: app.plan.map { "\($0.targets.count)" } ?? "–", label: "To clean")
            statTile(value: app.isCleaning || app.lastSummary != nil ? "\(app.progress.moved)" : "0", label: "Cleaned")
            statTile(value: "\(app.sessions.count)", label: "Sessions")
        }
    }

    private func statTile(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(DS.stat).tracking(-0.4).monospacedDigit()
            Text(label).font(DS.caption).foregroundStyle(DS.secondary60)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(EdgeInsets(top: 9, leading: 12, bottom: 9, trailing: 12))
        .dsCard()
    }

    // MARK: Progress

    private var progressCard: some View {
        VStack(alignment: .leading, spacing: 7) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(DS.progressTrack)
                    Capsule().fill(DS.accent).frame(width: max(6, proxy.size.width * app.progress.fraction))
                }
            }
            .frame(height: 6)
            .animation(.easeOut(duration: 0.3), value: app.progress.fraction)
            HStack(spacing: 10) {
                Text(app.phase == .paused ? "Paused · \(app.currentFileName ?? "")" : "Collecting \(app.currentFileName ?? "…")")
                    .lineLimit(1).truncationMode(.middle)
                Spacer()
                Text("\(app.progress.processed)/\(app.progress.total)").monospacedDigit()
            }
            .font(DS.caption)
            .foregroundStyle(DS.secondary60)
        }
        .padding(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
        .dsCard()
    }

    // MARK: Notices

    @ViewBuilder private var notices: some View {
        if let problem = app.scanProblem {
            notice(.warn, title: "Can’t read the Desktop",
                   message: problem.isPermissionProblem ? "Robovac needs permission to see the files on your Desktop." : problem.message) {
                if problem.isPermissionProblem {
                    Button("Open Privacy Settings") { SystemLinks.openFilesAndFoldersPrivacy() }
                        .buttonStyle(DSSmallButtonStyle(kind: .primary))
                }
                Button("Try Again") { Task { await app.refreshPlan() } }
                    .buttonStyle(DSSmallButtonStyle())
            }
        }
        if let session = app.interruptedSession {
            notice(.neutral, title: "The last cleaning was interrupted",
                   message: "It stopped after moving \(session.moves.count) file\(session.moves.count == 1 ? "" : "s"). You can put them back.") {
                Button("Undo It") { Task { await app.undo(session: session) } }
                    .buttonStyle(DSSmallButtonStyle(kind: .primary))
                    .disabled(app.undoInProgress)
                Button("Dismiss") { app.interruptedSession = nil }
                    .buttonStyle(DSSmallButtonStyle())
            }
        }
        if let report = app.lastUndoReport, !report.isComplete {
            let occupied = report.conflicts.contains { $0.failure == .originalOccupied }
            notice(.warn, title: "\(report.restored.count) restored, \(report.conflicts.count) could not go back",
                   message: occupied ? "Files with the same name are already on the Desktop." : (report.conflicts.first?.failure.message ?? ""),
                   lines: report.conflicts.prefix(3).map { $0.record.fileName }) {
                if occupied {
                    Button("Restore With New Names") { Task { await app.undoLastCleaning(resolution: .restoreWithUniqueName) } }
                        .buttonStyle(DSSmallButtonStyle(kind: .primary))
                        .disabled(app.undoInProgress)
                }
                Button("Dismiss") { app.lastUndoReport = nil }
                    .buttonStyle(DSSmallButtonStyle())
            }
        }
        if let countdown = app.autoCleanCountdown {
            notice(.info, title: "New files spotted", message: "Auto-cleaning in \(countdown) s…") {
                Button("Clean Now") { app.cancelAutoClean(); app.startCleaning() }
                    .buttonStyle(DSSmallButtonStyle(kind: .primary))
                Button("Not Now") { app.cancelAutoClean() }
                    .buttonStyle(DSSmallButtonStyle())
            }
        }
    }

    private func notice<Actions: View>(_ kind: DS.NoticeKind, title: String, message: String, lines: [String] = [], @ViewBuilder actions: () -> Actions) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Circle().fill(kind.dot).frame(width: 8, height: 8).padding(.top, 5)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(DS.bodySemibold)
                    if !message.isEmpty {
                        Text(message).font(DS.small).foregroundStyle(DS.secondary70).fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(lines, id: \.self) { line in
                        Text(line).font(DS.caption).monospacedDigit().foregroundStyle(DS.secondary70).lineLimit(1).truncationMode(.middle)
                    }
                }
            }
            HStack(spacing: 6) { actions() }
                .padding(.leading, 16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
        .dsCard(fill: kind.background, ring: kind.ring)
    }

    // MARK: Result

    private func resultCard(_ summary: CleaningSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 7) {
                CheckGlyph().stroke(DS.success, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    .frame(width: 12, height: 10)
                Text(summaryText(summary)).font(DS.bodySemibold)
            }
            if let plan = app.plan, !plan.excluded.isEmpty {
                HStack(spacing: 8) {
                    Text("Left alone by your rules: \(leftAloneText(plan))")
                        .font(DS.small).foregroundStyle(DS.secondary70).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button("Why?") { showPreview() }
                        .buttonStyle(.plain)
                        .font(DS.smallMedium)
                        .foregroundStyle(DS.accent)
                }
                .padding(.leading, 19)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
        .dsCard()
    }

    private func summaryText(_ summary: CleaningSummary) -> String {
        var parts = ["\(summary.movedCount) moved"]
        if summary.skippedCount > 0 { parts.append("\(summary.skippedCount) skipped") }
        if summary.failedCount > 0 { parts.append("\(summary.failedCount) failed") }
        let prefix = summary.status == .completed ? "Done" : summary.status.displayName
        return "\(prefix): " + parts.joined(separator: ", ")
    }

    private func leftAloneText(_ plan: CleaningPlan) -> String {
        var counts: [String: Int] = [:]
        for decision in plan.excluded {
            counts[decision.exclusionReason?.shortLabel ?? "excluded", default: 0] += 1
        }
        return counts.sorted { $0.value > $1.value }.prefix(3).map { "\($0.value) \($0.key)" }.joined(separator: ", ")
    }

    // MARK: Mode, route, trail

    private var modeTabs: some View {
        VStack(alignment: .leading, spacing: 6) {
            TabStrip(items: CleaningMode.allCases, title: { modeTabName($0) }, selection: $app.settings.cleaning.mode, disabled: app.isCleaning)
            Text(modeDescription(app.settings.cleaning.mode))
                .font(DS.small)
                .foregroundStyle(DS.secondary60)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 2)
    }

    /// Short enough that all three fit side by side without scrolling.
    private func modeTabName(_ mode: CleaningMode) -> String {
        switch mode {
        case .smartClean: return "Smart"
        case .screenshotSweep: return "Screenshots"
        case .gentleClean: return "Gentle"
        }
    }

    private func modeDescription(_ mode: CleaningMode) -> String {
        switch mode {
        case .smartClean: return "Sorts every file by type into its own folder."
        case .screenshotSweep: return "Collects only screenshots and leaves the rest."
        case .gentleClean: return "Same files as Smart Clean, at a calmer pace with softer effects."
        }
    }

    private var routeSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            DSSectionHeader(title: "Route", value: app.settings.appearance.movementPattern.displayName)
            PillPicker(options: MovementPattern.allCases, selection: $app.settings.appearance.movementPattern, disabled: app.isCleaning) { pattern in
                RouteGlyph(pattern: pattern).help(pattern.summary)
            }
        }
    }

    private var trailLevel: TrailLevel { TrailLevel.closest(to: app.settings.appearance) }

    private var trailBinding: Binding<TrailLevel> {
        Binding(
            get: { trailLevel },
            set: { level in
                if level == .off {
                    app.settings.appearance.trailStyle = .none
                } else {
                    if app.settings.appearance.trailStyle == .none { app.settings.appearance.trailStyle = .damp }
                    app.settings.appearance.trailOpacity = level.opacity
                }
            }
        )
    }

    private var trailSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            DSSectionHeader(title: "Mop trail", value: trailLevel.displayName)
            PillPicker(options: TrailLevel.allCases, selection: trailBinding) { level in
                TrailGlyph(level: level).help(level.displayName)
            }
        }
    }

    // MARK: Destination

    private var destinationSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            DSSectionHeader(title: "Destination", value: app.settings.cleaning.sendToTrash ? "Trash" : app.settings.cleaning.destinations.defaultDestination.lastPathComponent)
            VStack(spacing: 0) {
                Toggle(isOn: $app.settings.cleaning.sendToTrash) { Text("Always send to Trash") }
                    .toggleStyle(DSSwitchStyle())
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                Rectangle().fill(DS.separator).frame(height: 1).padding(.leading, 12)
                if confirmTrash {
                    HStack(spacing: 8) {
                        Text("Move \(app.eligibleCount) item\(app.eligibleCount == 1 ? "" : "s") to the Trash?")
                            .font(DS.small).foregroundStyle(DS.secondary70)
                        Spacer()
                        Button("Cancel") { confirmTrash = false }.buttonStyle(DSSmallButtonStyle())
                        Button("Move to Trash") { confirmTrash = false; app.startCleaning(toTrash: true) }
                            .buttonStyle(DSSmallButtonStyle(kind: .destructive))
                    }
                    .padding(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 8))
                    .frame(minHeight: 36)
                } else {
                    Button {
                        confirmTrash = true
                    } label: {
                        HStack {
                            Text("Move All to Trash…").foregroundStyle(app.isBusy || app.eligibleCount == 0 ? DS.disabledText : DS.destructive)
                            Spacer()
                            Text("Asks first").font(DS.caption).foregroundStyle(DS.tertiary)
                        }
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(app.isBusy || app.eligibleCount == 0)
                }
            }
            .dsCard()
        }
    }

    // MARK: Actions

    private var primaryActions: some View {
        HStack(spacing: 8) {
            if app.isRehearsing {
                Button { app.stopTestDrive() } label: { Label("Stop Test Drive", systemImage: "stop.fill") }
                    .buttonStyle(DSPrimaryButtonStyle(kind: .primary))
            } else if app.isCleaning {
                Button { app.togglePause() } label: {
                    Label(app.phase == .paused ? "Resume" : "Pause", systemImage: app.phase == .paused ? "play.fill" : "pause.fill")
                }
                .buttonStyle(DSPrimaryButtonStyle(kind: .primary))
                .disabled(app.phase == .finishing)
                Button { app.stop() } label: { Label("Stop", systemImage: "stop.fill") }
                    .buttonStyle(DSPrimaryButtonStyle(kind: .destructive))
                    .frame(width: 128)
                    .disabled(app.phase == .finishing)
            } else {
                let disabled = app.isBusy || app.eligibleCount == 0
                Button {
                    if app.needsPreview { showPreview() } else { app.startCleaning() }
                } label: {
                    Label("Start Cleaning", systemImage: "play.fill")
                }
                .buttonStyle(DSPrimaryButtonStyle(kind: disabled ? .disabled : .primary))
                .keyboardShortcut(.defaultAction)
                .disabled(disabled)
                Button { showPreview() } label: { Text("Preview") }
                    .buttonStyle(DSPrimaryButtonStyle(kind: app.scanProblem != nil ? .disabled : .secondary))
                    .frame(width: 128)
                    .disabled(app.isBusy || app.scanProblem != nil)
            }
        }
        .padding(.top, 2)
    }

    private var footer: some View {
        VStack(spacing: 0) {
            Rectangle().fill(DS.cardRing).frame(height: 1)
            HStack(spacing: 2) {
                Button {
                    if let session = app.lastUndoableSession { Task { await app.undo(session: session) } }
                } label: {
                    Label("Undo", systemImage: "arrow.uturn.backward")
                }
                .buttonStyle(DSFooterButtonStyle())
                .disabled(app.lastUndoableSession == nil || app.isCleaning || app.undoInProgress)
                .help("Undo last cleaning")
                Button { app.runTestDrive() } label: { Label("Test Drive", systemImage: "scope") }
                    .buttonStyle(DSFooterButtonStyle())
                    .disabled(app.isBusy)
                    .help("Drive the robot around without moving files")
                Spacer()
                SettingsLink { Label("Settings", systemImage: "gearshape") }
                    .buttonStyle(DSFooterButtonStyle())
                    .simultaneousGesture(TapGesture().onEnded { NSApp.activate(ignoringOtherApps: true) })
                Button { NSApplication.shared.terminate(nil) } label: { Label("Quit", systemImage: "power") }
                    .buttonStyle(DSFooterButtonStyle())
                    .help("Quit Desktop Robovac")
            }
            .padding(.top, 4)
        }
        .padding(.top, 2)
    }

    private func showPreview() {
        openWindow(id: WindowID.preview)
        NSApp.activate(ignoringOtherApps: true)
    }
}
