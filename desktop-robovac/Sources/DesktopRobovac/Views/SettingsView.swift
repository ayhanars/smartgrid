import SwiftUI
import RobovacCore

enum SettingsTab: String, CaseIterable, Identifiable {
    case general, cleaning, appearance, sound, history

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "General"
        case .cleaning: return "Cleaning"
        case .appearance: return "Appearance"
        case .sound: return "Sound"
        case .history: return "History"
        }
    }

    var symbol: String {
        switch self {
        case .general: return "gearshape.fill"
        case .cleaning: return "wand.and.stars"
        case .appearance: return "paintpalette.fill"
        case .sound: return "speaker.wave.2.fill"
        case .history: return "clock.arrow.circlepath"
        }
    }

    var tint: Color {
        switch self {
        case .general: return DS.dynamic(DS.hex(0x8E8E93), DS.hex(0x98989D))
        case .cleaning: return DS.accent
        case .appearance: return Color(nsColor: DS.hex(0xBF5AF2))
        case .sound: return Color(nsColor: DS.hex(0xFF9F0A))
        case .history: return DS.dynamic(DS.hex(0x34C759), DS.hex(0x30D158))
        }
    }
}

/// Settings window: System Settings–style tab bar with coloured icons, then a
/// scrolling column of card sections.
struct SettingsView: View {
    @EnvironmentObject private var app: AppState
    @State private var tab: SettingsTab = .general

    var body: some View {
        VStack(spacing: 0) {
            tabBar
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    switch tab {
                    case .general: GeneralSettingsTab()
                    case .cleaning: CleaningSettingsTab()
                    case .appearance: AppearanceSettingsTab()
                    case .sound: SoundSettingsTab()
                    case .history: HistorySettingsTab()
                    }
                }
                .padding(EdgeInsets(top: 16, leading: 20, bottom: 20, trailing: 20))
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(DS.dynamic(DS.hex(0xECECEE), DS.hex(0x2B2B2E)))
        }
        .frame(width: 560, height: 520)
        .font(DS.body)
        .foregroundStyle(DS.text)
        .navigationTitle(tab.title)
        .onAppear { NSApp.activate(ignoringOtherApps: true) }
    }

    private var tabBar: some View {
        HStack(spacing: 4) {
            ForEach(SettingsTab.allCases) { item in
                let selected = item == tab
                Button {
                    tab = item
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: item.symbol)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 26, height: 26)
                            .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(item.tint))
                        Text(item.title).font(DS.caption).foregroundStyle(selected ? DS.text : DS.secondary70)
                    }
                    .frame(width: 72)
                    .padding(EdgeInsets(top: 5, leading: 0, bottom: 4, trailing: 0))
                    .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(selected ? DS.dynamic(DS.rgba(0, 0, 0, 0.08), DS.rgba(255, 255, 255, 0.1)) : .clear))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(EdgeInsets(top: 4, leading: 0, bottom: 8, trailing: 0))
        .background(DS.dynamic(DS.hex(0xE6E6E8), DS.hex(0x333336)))
        .overlay(alignment: .bottom) { Rectangle().fill(DS.dynamic(DS.rgba(0, 0, 0, 0.1), DS.rgba(0, 0, 0, 0.4))).frame(height: 1) }
    }
}

// MARK: - Helpers

/// Maps a setting range onto a 0–100 percent slider.
private func percentBinding(_ binding: Binding<Double>, range: ClosedRange<Double>) -> Binding<Double> {
    Binding(
        get: { (binding.wrappedValue - range.lowerBound) / (range.upperBound - range.lowerBound) * 100 },
        set: { binding.wrappedValue = range.lowerBound + (range.upperBound - range.lowerBound) * $0 / 100 }
    )
}

private func percentText(_ binding: Binding<Double>, range: ClosedRange<Double>) -> String {
    "\(Int(((binding.wrappedValue - range.lowerBound) / (range.upperBound - range.lowerBound) * 100).rounded()))%"
}

private func homeRelative(_ url: URL) -> String {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let path = url.path
    return path.hasPrefix(home) ? "~" + path.dropFirst(home.count) : path
}

// MARK: - General

struct GeneralSettingsTab: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.openWindow) private var openWindow
    @State private var launchError: String?

    var body: some View {
        SettingsSection(title: "Startup") {
            ToggleRow(label: "Launch at login", sub: LaunchAtLogin.isAvailable ? nil : "Available when running as a bundled app", isOn: Binding(
                get: { app.settings.general.launchAtLogin },
                set: { enabled in
                    if let error = LaunchAtLogin.setEnabled(enabled) {
                        launchError = error.localizedDescription
                    } else {
                        launchError = nil
                        app.settings.general.launchAtLogin = enabled
                    }
                }
            ), first: true)
            .disabled(!LaunchAtLogin.isAvailable)
            if let launchError {
                Text(launchError).font(DS.caption).foregroundStyle(DS.destructive).padding(.horizontal, 12).padding(.bottom, 6)
            }
            ToggleRow(label: "Show the robot on the desktop", isOn: $app.settings.general.showDesktopRobot)
        }

        SettingsSection(title: "Folders") {
            PathRow(label: "Desktop folder", path: homeRelative(app.desktopURL), actions: [
                RowAction(title: "Choose…") {
                    if let url = FolderPicker.chooseFolder(message: "Choose the Desktop folder the robot should clean.", initial: app.desktopURL) {
                        app.setDesktopOverride(url)
                    }
                },
                RowAction(title: "Use Default") { app.setDesktopOverride(nil) },
            ], first: true)
            PathRow(label: "Default cleaning destination", path: homeRelative(app.settings.cleaning.destinations.defaultDestination), actions: [
                RowAction(title: "Choose…") {
                    if let url = FolderPicker.chooseFolder(message: "Choose where cleaned files go.", initial: app.settings.cleaning.destinations.defaultDestination) {
                        app.setDefaultDestination(url)
                    }
                },
                RowAction(title: "Show in Finder") { SystemLinks.reveal(app.settings.cleaning.destinations.defaultDestination) },
                RowAction(title: "Add to Dock…") {
                    openWindow(id: WindowID.dockGuide)
                    NSApp.activate(ignoringOtherApps: true)
                },
            ])
            ToggleRow(label: "Put each run in a dated session folder",
                      sub: "\(app.settings.cleaning.destinations.defaultDestination.lastPathComponent) ▸ \(DestinationRouter(rules: app.settings.cleaning.destinations).sessionFolderName)",
                      isOn: $app.settings.cleaning.destinations.useDatedSessionFolders)
        }

        SettingsSection(title: "Before cleaning") {
            ToggleRow(label: "Show a preview before every cleaning", isOn: $app.settings.general.previewBeforeEveryRun, first: true)
        }

        SettingsSection(title: "Permissions") {
            NoteRow(text: "Robovac needs access to your Desktop to see and move files. Grant it under Files and Folders.", button: "Open Files and Folders Privacy Settings", action: { SystemLinks.openFilesAndFoldersPrivacy() }, first: true)
        }
    }
}

// MARK: - Cleaning

struct CleaningSettingsTab: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        SettingsSection(title: "Mode") {
            PickerRow(label: "Cleaning mode", options: CleaningMode.allCases, title: { $0.displayName }, selection: $app.settings.cleaning.mode, sub: app.settings.cleaning.mode.summary, first: true)
        }

        SettingsSection(title: "Destination") {
            ToggleRow(label: "Send collected files to the Trash instead of a folder", sub: "Undo still works until the Trash is emptied", isOn: $app.settings.cleaning.sendToTrash, first: true)
        }

        SettingsSection(title: "Automatic cleaning") {
            ToggleRow(label: "Clean automatically when new files appear", isOn: $app.settings.cleaning.autoCleanNewFiles, first: true)
            SliderRow(label: "Wait before starting", valueText: "\(Int(app.settings.cleaning.autoCleanDelay)) s", value: $app.settings.cleaning.autoCleanDelay, range: 3...60, step: 1)
                .disabled(!app.settings.cleaning.autoCleanNewFiles)
        }

        SettingsSection(title: "File categories", aside: "Switch a category off to leave those files alone") {
            ForEach(Array(FileCategory.allCases.enumerated()), id: \.element) { index, category in
                CategoryRow(
                    category: category,
                    isOn: Binding(
                        get: { !app.settings.cleaning.rules.excludedCategories.contains(category) },
                        set: { on in
                            if on { app.settings.cleaning.rules.excludedCategories.remove(category) } else { app.settings.cleaning.rules.excludedCategories.insert(category) }
                        }
                    ),
                    folder: app.settings.cleaning.destinations.categoryDestinations[category].map(homeRelative),
                    onChoose: {
                        if let url = FolderPicker.chooseFolder(message: "Choose where \(category.displayName.lowercased()) go.", initial: app.settings.cleaning.destinations.categoryDestinations[category]) {
                            app.setCategoryDestination(url, for: category)
                        }
                    },
                    onUseDefault: { app.setCategoryDestination(nil, for: category) },
                    first: index == 0
                )
            }
        }

        SettingsSection(title: "Exclusions") {
            ListRow(label: "Excluded folders", items: app.settings.cleaning.rules.excludedFolders.map(homeRelative), emptyText: "No folders excluded", onAdd: {
                if let url = FolderPicker.chooseFolder(message: "Choose a folder on the Desktop the robot must never touch.", initial: app.desktopURL) {
                    app.addExcludedFolder(url)
                }
            }, addTitle: "Add Folder…", onRemove: { shown in
                if let url = app.settings.cleaning.rules.excludedFolders.first(where: { homeRelative($0) == shown }) { app.removeExcludedFolder(url) }
            }, first: true)
            ListRow(label: "Excluded files", items: app.settings.cleaning.rules.excludedFiles.map(homeRelative), emptyText: "No files excluded", onAdd: {
                if let url = FolderPicker.chooseFile(message: "Choose a file the robot must never move.", initial: app.desktopURL) {
                    app.addExcludedFile(url)
                }
            }, addTitle: "Add File…", onRemove: { shown in
                if let url = app.settings.cleaning.rules.excludedFiles.first(where: { homeRelative($0) == shown }) { app.removeExcludedFile(url) }
            })
            ChipsRow(label: "Excluded extensions", chips: app.settings.cleaning.rules.excludedExtensions.map { ".\($0)" }, placeholder: "e.g. .sketch", onAdd: { raw in
                let ext = ExclusionRules.normalizeExtension(raw)
                if !ext.isEmpty, !app.settings.cleaning.rules.excludedExtensions.contains(ext) { app.settings.cleaning.rules.excludedExtensions.append(ext) }
            }, onRemove: { index in app.settings.cleaning.rules.excludedExtensions.remove(at: index) })
            ChipsRow(label: "Excluded name patterns", chips: app.settings.cleaning.rules.excludedNamePatterns, placeholder: "e.g. *final*", onAdd: { pattern in
                if !app.settings.cleaning.rules.excludedNamePatterns.contains(pattern) { app.settings.cleaning.rules.excludedNamePatterns.append(pattern) }
            }, onRemove: { index in app.settings.cleaning.rules.excludedNamePatterns.remove(at: index) })
        }

        SettingsSection(title: "Folders and packages") {
            ToggleRow(label: "Also move folders", isOn: $app.settings.cleaning.rules.includeDirectories, first: true)
            ToggleRow(label: "Also move packages", sub: "Apps and other bundles that look like files", isOn: $app.settings.cleaning.rules.includePackages)
        }
    }
}

// MARK: - Appearance

struct AppearanceSettingsTab: View {
    @EnvironmentObject private var app: AppState

    private let speedRange: ClosedRange<Double> = 80...600
    private let intensityRange: ClosedRange<Double> = 0.2...1.5

    var body: some View {
        SettingsSection {
            HStack(spacing: 16) {
                RobotBadgeView(state: .driving, size: 64, skin: app.settings.appearance.robotSkin).frame(width: 72, height: 72)
                VStack(alignment: .leading, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Live preview").font(DS.bodySemibold)
                        Text("Changes below apply to the robot as you make them.").font(DS.caption).foregroundStyle(DS.secondary60)
                    }
                    HStack(spacing: 6) {
                        if app.isRehearsing {
                            Button("Stop Test Drive") { app.stopTestDrive() }.buttonStyle(DSSmallButtonStyle())
                        } else {
                            Button("Test Drive") { app.runTestDrive() }.buttonStyle(DSSmallButtonStyle()).disabled(app.isBusy)
                        }
                        Button("Copy Diagnostics") { app.copyDiagnosticsToClipboard() }.buttonStyle(DSSmallButtonStyle())
                        Spacer()
                        Text(BuildInfo.label).font(DS.micro).monospacedDigit().foregroundStyle(DS.tertiary)
                    }
                }
            }
            .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(DS.Tint.grey.background)
        }

        SettingsSection(title: "Robot") {
            SegmentedRow(label: "Colour", options: RobotSkin.allCases, title: { $0.displayName }, selection: $app.settings.appearance.robotSkin, first: true)
            SliderRow(label: "Robot size", valueText: "\(Int(app.settings.appearance.robotSize)) pt", value: $app.settings.appearance.robotSize, range: 36...120, step: 2)
            SliderRow(label: "Movement speed", valueText: percentText($app.settings.appearance.movementSpeed, range: speedRange), value: percentBinding($app.settings.appearance.movementSpeed, range: speedRange), range: 0...100, step: 1)
        }

        SettingsSection(title: "Movement") {
            PickerRow(label: "Route", options: MovementPattern.allCases, title: { $0.displayName }, selection: $app.settings.appearance.movementPattern, sub: app.settings.appearance.movementPattern.summary, first: true)
            SliderRow(label: "Explore up to", valueText: app.settings.appearance.wanderSeconds == 0 ? "no exploring" : "\(Int(app.settings.appearance.wanderSeconds)) s per file", value: $app.settings.appearance.wanderSeconds, range: 0...30, step: 1)
                .disabled(app.settings.appearance.movementPattern != .bounce)
        }

        SettingsSection(title: "Robot layer") {
            PickerRow(label: "Draw the robot", options: RobotLayer.allCases, title: { $0.displayName }, selection: $app.settings.appearance.robotLayer, first: true)
        }

        SettingsSection(title: "Trail") {
            PickerRow(label: "Style", options: TrailStyle.allCases, title: { $0.displayName }, selection: $app.settings.appearance.trailStyle, first: true)
            SliderRow(label: "Opacity", valueText: "\(Int((app.settings.appearance.trailOpacity * 100).rounded()))%", value: percentBinding($app.settings.appearance.trailOpacity, range: 0...1), range: 0...100, step: 1)
                .disabled(app.settings.appearance.trailStyle == .none)
            SliderRow(label: "Fade duration", valueText: String(format: "%.1f s", app.settings.appearance.trailFadeDuration), value: $app.settings.appearance.trailFadeDuration, range: 0.5...20, step: 0.5)
                .disabled(app.settings.appearance.trailStyle == .none)
        }

        SettingsSection(title: "Effects") {
            ToggleRow(label: "Dust particles", isOn: $app.settings.appearance.particleEffects, first: true)
            SliderRow(label: "Animation intensity", valueText: percentText($app.settings.appearance.animationIntensity, range: intensityRange), value: percentBinding($app.settings.appearance.animationIntensity, range: intensityRange), range: 0...100, step: 1)
            ToggleRow(label: "Reduce motion", sub: "Skips pivots, trail and particles; shorter suction", isOn: $app.settings.appearance.reducedMotion)
        }

        SettingsSection(title: "Finding the icons") {
            ToggleRow(label: "Ask Finder for exact icon positions", sub: "Most accurate. Needs Automation permission for Finder.", isOn: $app.settings.appearance.useFinderIconPositions, first: true)
        }

        SettingsSection(title: "Desktop icon grid (fallback)", footnote: "Used only when Finder can’t be asked.") {
            PickerRow(label: "Sort order", options: IconArrangement.allCases, title: { $0.displayName }, selection: $app.settings.appearance.iconArrangement, first: true)
            SliderRow(label: "Column width", valueText: "\(Int(app.settings.appearance.iconGridColumnWidth)) pt", value: $app.settings.appearance.iconGridColumnWidth, range: 48...160, step: 2)
            SliderRow(label: "Row height", valueText: "\(Int(app.settings.appearance.iconGridRowHeight)) pt", value: $app.settings.appearance.iconGridRowHeight, range: 48...200, step: 2)
        }
    }
}

// MARK: - Sound

struct SoundSettingsTab: View {
    @EnvironmentObject private var app: AppState

    private func eventBinding(_ event: SoundEvent) -> Binding<Bool> {
        Binding(
            get: { app.settings.sound.enabledEvents.contains(event) },
            set: { on in
                if on { app.settings.sound.enabledEvents.insert(event) } else { app.settings.sound.enabledEvents.remove(event) }
                if event == .complete { app.settings.sound.completionSound = on }
            }
        )
    }

    private func eventLabel(_ event: SoundEvent) -> String {
        switch event {
        case .start: return "Cleaning started"
        case .movement: return "Motor and wheels"
        case .suction: return "Vacuum suction"
        case .collect: return "File collected"
        case .turn: return "Turning"
        case .avoid: return "Bumped into an edge"
        case .complete: return "Cleaning finished"
        case .error: return "Something went wrong"
        }
    }

    var body: some View {
        SettingsSection(title: "Output") {
            ToggleRow(label: "Enable sound", isOn: $app.settings.sound.enabled, first: true)
            SliderRow(label: "Volume", valueText: "\(Int((app.settings.sound.volume * 100).rounded()))%", value: percentBinding($app.settings.sound.volume, range: 0...1), range: 0...100, step: 1)
                .disabled(!app.settings.sound.enabled)
        }

        SettingsSection(title: "Motor") {
            ToggleRow(label: "Continuous motor hum", isOn: $app.settings.sound.continuousMotorSound, first: true)
            SliderRow(label: "Occasional wheel noise", valueText: app.settings.sound.movementSoundFrequency < 0.03 ? "off" : "\(Int((app.settings.sound.movementSoundFrequency * 100).rounded()))%", value: percentBinding($app.settings.sound.movementSoundFrequency, range: 0...1), range: 0...100, step: 1)
            SliderRow(label: "Suction intensity", valueText: "\(Int((app.settings.sound.suctionIntensity * 100).rounded()))%", value: percentBinding($app.settings.sound.suctionIntensity, range: 0...1), range: 0...100, step: 1)
        }
        .disabled(!app.settings.sound.enabled)

        SettingsSection(title: "Events") {
            ForEach(Array(SoundEvent.allCases.enumerated()), id: \.element) { index, event in
                SoundRow(label: eventLabel(event), isOn: eventBinding(event), onPlay: { app.sound.play(event) }, first: index == 0)
            }
        }
        .disabled(!app.settings.sound.enabled)
    }
}

// MARK: - History

struct HistorySettingsTab: View {
    @EnvironmentObject private var app: AppState
    @State private var open: Set<UUID> = []
    @State private var confirmClear = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            DSSectionHeader(title: "Sessions", value: "\(app.sessions.count) session\(app.sessions.count == 1 ? "" : "s") · \(app.sessions.reduce(0) { $0 + $1.moves.count }) files", uppercase: true)
            VStack(spacing: 0) {
                if app.sessions.isEmpty {
                    Text("No cleanings yet. Each run is recorded here with every file it moved.")
                        .font(DS.small).foregroundStyle(DS.tertiary)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(Array(app.sessions.enumerated()), id: \.element.id) { index, session in
                    sessionRow(session, first: index == 0)
                }
            }
            .dsCard(ring: DS.dynamic(DS.rgba(0, 0, 0, 0.1), DS.rgba(255, 255, 255, 0.08)))
            HStack {
                Spacer()
                Button("Clear History…") { confirmClear = true }
                    .buttonStyle(DSSmallButtonStyle(kind: .destructiveText))
                    .disabled(app.sessions.isEmpty || app.isCleaning)
            }
            .padding(.top, 6)
        }
        .onAppear { app.reloadHistory() }
        .confirmationDialog("Clear the cleaning history?", isPresented: $confirmClear) {
            Button("Clear History", role: .destructive) { app.clearHistory() }
        } message: {
            Text("Files stay where they are, but earlier cleanings can no longer be undone from here.")
        }
    }

    private func sessionRow(_ session: CleaningSession, first: Bool) -> some View {
        let isOpen = open.contains(session.id)
        let status = statusLabel(session)
        return VStack(spacing: 0) {
            if !first { RowDivider() }
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    if isOpen { open.remove(session.id) } else { open.insert(session.id) }
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DS.secondary60)
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 8) {
                            Text(dateLabel(session.startedAt)).font(DS.bodySemibold)
                            Text(session.mode.displayName).font(DS.caption).foregroundStyle(DS.secondary60)
                            Text(status.text)
                                .font(.system(size: 10, weight: .semibold))
                                .padding(.horizontal, 6).padding(.vertical, 1)
                                .background(Capsule().fill(status.tint.background))
                                .foregroundStyle(status.tint.foreground)
                        }
                        Text("\(session.moves.count) moved · \(session.skipped.count) skipped · \(session.failed.count) failed")
                            .font(DS.caption).monospacedDigit().foregroundStyle(DS.secondary60)
                    }
                    Spacer()
                    if session.canUndo {
                        Button("Undo") { Task { await app.undo(session: session) } }
                            .buttonStyle(DSSmallButtonStyle())
                            .disabled(app.isCleaning || app.undoInProgress)
                    }
                }
                .padding(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if isOpen {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(session.moves) { record in
                        HStack(spacing: 8) {
                            Text(record.fileName).lineLimit(1).truncationMode(.middle).frame(maxWidth: 220, alignment: .leading)
                            Text("→").foregroundStyle(DS.tertiary)
                            Text(homeRelative(URL(fileURLWithPath: record.destinationPath).deletingLastPathComponent()) + (record.undone ? "  (restored)" : ""))
                                .foregroundStyle(DS.secondary60).lineLimit(1).truncationMode(.middle)
                        }
                        .font(DS.caption).monospacedDigit()
                    }
                    ForEach(session.skipped + session.failed) { record in
                        HStack(spacing: 8) {
                            Text(record.fileName).lineLimit(1).truncationMode(.middle).frame(maxWidth: 220, alignment: .leading)
                            Text("·").foregroundStyle(DS.tertiary)
                            Text(record.reason).foregroundStyle(DS.secondary60).lineLimit(1)
                        }
                        .font(DS.caption)
                    }
                }
                .padding(EdgeInsets(top: 0, leading: 30, bottom: 10, trailing: 12))
            }
        }
    }

    private func statusLabel(_ session: CleaningSession) -> (text: String, tint: DS.Tint) {
        if !session.moves.isEmpty, session.restorableMoves.isEmpty { return ("Undone", .grey) }
        switch session.status {
        case .completed: return ("Done", .green)
        case .interrupted: return ("Interrupted", .orange)
        case .cancelled: return ("Stopped", .grey)
        case .running: return ("Running", .blue)
        }
    }

    private func dateLabel(_ date: Date) -> String {
        let calendar = Calendar.current
        let time = date.formatted(date: .omitted, time: .shortened)
        if calendar.isDateInToday(date) { return "Today, \(time)" }
        if calendar.isDateInYesterday(date) { return "Yesterday, \(time)" }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return "\(formatter.string(from: date)), \(time)"
    }
}
