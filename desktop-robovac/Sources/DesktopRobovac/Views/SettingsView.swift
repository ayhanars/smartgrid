import SwiftUI
import RobovacCore

struct SettingsView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        TabView {
            GeneralSettingsTab()
                .tabItem { Label("General", systemImage: "gearshape") }
            CleaningSettingsTab()
                .tabItem { Label("Cleaning", systemImage: "sparkles") }
            AppearanceSettingsTab()
                .tabItem { Label("Appearance", systemImage: "paintbrush") }
            SoundSettingsTab()
                .tabItem { Label("Sound", systemImage: "speaker.wave.2") }
            HistorySettingsTab()
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
        }
        .frame(width: 560, height: 520)
        .onAppear { NSApp.activate(ignoringOtherApps: true) }
    }
}

// MARK: - General

struct GeneralSettingsTab: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.openWindow) private var openWindow
    @State private var launchError: String?

    var body: some View {
        Form {
            Section {
                Toggle("Launch at login", isOn: Binding(
                    get: { app.settings.general.launchAtLogin },
                    set: { enabled in
                        if let error = LaunchAtLogin.setEnabled(enabled) {
                            launchError = error.localizedDescription
                        } else {
                            launchError = nil
                            app.settings.general.launchAtLogin = enabled
                        }
                    }
                ))
                .disabled(!LaunchAtLogin.isAvailable)
                if !LaunchAtLogin.isAvailable {
                    Text("Available when Desktop Robovac runs as a bundled app (see Scripts/make-app.sh).")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let launchError {
                    Text(launchError).font(.caption).foregroundStyle(.red)
                }
                Toggle("Show the robot on the desktop while cleaning", isOn: $app.settings.general.showDesktopRobot)
            }

            Section("Desktop folder") {
                LabeledContent("Scanning") {
                    Text(app.desktopURL.path).lineLimit(1).truncationMode(.middle)
                }
                HStack {
                    Button("Choose Desktop Folder…") {
                        if let url = FolderPicker.chooseFolder(message: "Choose the Desktop folder the robot should clean.", initial: app.desktopURL) {
                            app.setDesktopOverride(url)
                        }
                    }
                    if app.settings.general.desktopURL != nil {
                        Button("Use Default") { app.setDesktopOverride(nil) }
                    }
                }
                Text("Only the top level of this folder is ever scanned. In a sandboxed build, choosing the folder here grants the app access to it.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Default cleaning destination") {
                LabeledContent("Folder") {
                    Text(app.settings.cleaning.destinations.defaultDestination.path).lineLimit(1).truncationMode(.middle)
                }
                HStack {
                    Button("Choose…") {
                        if let url = FolderPicker.chooseFolder(message: "Choose where cleaned files go.", initial: app.settings.cleaning.destinations.defaultDestination) {
                            app.setDefaultDestination(url)
                        }
                    }
                    Button("Show in Finder") { SystemLinks.reveal(app.settings.cleaning.destinations.defaultDestination) }
                    Button("Add to Dock…") {
                        openWindow(id: WindowID.dockGuide)
                        NSApp.activate(ignoringOtherApps: true)
                    }
                }
                Toggle("Put each run in a dated session folder", isOn: $app.settings.cleaning.destinations.useDatedSessionFolders)
            }

            Section("Confirmation") {
                Toggle("Show a preview before every cleaning", isOn: $app.settings.general.previewBeforeEveryRun)
                Text("Off by default: Start Cleaning sends the robot out straight away. The Preview button in the menu is always available.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Permissions & privacy") {
                Text("Desktop Robovac reads only your Desktop folder and the destinations you choose. Nothing about your files leaves this Mac. Files are moved, never deleted.")
                    .font(.caption).foregroundStyle(.secondary)
                Button("Open Files and Folders Privacy Settings") { SystemLinks.openFilesAndFoldersPrivacy() }
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - Cleaning

struct CleaningSettingsTab: View {
    @EnvironmentObject private var app: AppState
    @State private var newExtension = ""
    @State private var newPattern = ""

    var body: some View {
        Form {
            Section("Strategy") {
                Picker("Cleaning mode", selection: $app.settings.cleaning.mode) {
                    ForEach(CleaningMode.allCases) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
                Text(app.settings.cleaning.mode.summary).font(.caption).foregroundStyle(.secondary)
            }

            Section("Destination") {
                Toggle("Send collected files to the Trash instead of a folder", isOn: $app.settings.cleaning.sendToTrash)
                Text("Files in the Trash can still be undone from the menu until you empty the Trash. The menu also has a one-off “Move All to Trash” button.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Automatic cleaning") {
                Toggle("Clean automatically when new files land on the Desktop", isOn: $app.settings.cleaning.autoCleanNewFiles)
                Slider(value: $app.settings.cleaning.autoCleanDelay, in: 3...60, step: 1) {
                    Text("Wait \(Int(app.settings.cleaning.autoCleanDelay)) s before starting")
                }
                .disabled(!app.settings.cleaning.autoCleanNewFiles)
                Text("The Desktop is watched live either way, so the count in the menu is always current. With this on, a new screenshot sends the robot out by itself after the delay; the menu shows a countdown you can cancel.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("File categories") {
                ForEach(FileCategory.allCases) { category in
                    categoryRow(category)
                }
            }

            Section("Excluded folders") {
                ForEach(app.settings.cleaning.rules.excludedFolders, id: \.path) { url in
                    HStack {
                        Image(systemName: "folder.badge.minus")
                        Text(url.path).lineLimit(1).truncationMode(.middle)
                        Spacer()
                        Button("Remove") { app.removeExcludedFolder(url) }.controlSize(.small)
                    }
                }
                Button("Add Folder…") {
                    if let url = FolderPicker.chooseFolder(message: "Choose a folder on the Desktop the robot must never touch.", initial: app.desktopURL) {
                        app.addExcludedFolder(url)
                    }
                }
                Text("Folders outside the Desktop are never processed, excluded or not.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Excluded files") {
                ForEach(app.settings.cleaning.rules.excludedFiles, id: \.path) { url in
                    HStack {
                        Image(systemName: "doc.badge.minus")
                        Text(url.lastPathComponent).lineLimit(1).truncationMode(.middle)
                        Spacer()
                        Button("Remove") { app.removeExcludedFile(url) }.controlSize(.small)
                    }
                }
                Button("Add File…") {
                    if let url = FolderPicker.chooseFile(message: "Choose a file the robot must never move.", initial: app.desktopURL) {
                        app.addExcludedFile(url)
                    }
                }
            }

            Section("Excluded extensions") {
                if !app.settings.cleaning.rules.excludedExtensions.isEmpty {
                    tagRow(app.settings.cleaning.rules.excludedExtensions.map { ".\($0)" }) { index in
                        app.settings.cleaning.rules.excludedExtensions.remove(at: index)
                    }
                }
                HStack {
                    TextField("webloc", text: $newExtension)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit(addExtension)
                    Button("Add", action: addExtension)
                        .disabled(ExclusionRules.normalizeExtension(newExtension).isEmpty)
                }
            }

            Section("Excluded name patterns") {
                if !app.settings.cleaning.rules.excludedNamePatterns.isEmpty {
                    tagRow(app.settings.cleaning.rules.excludedNamePatterns) { index in
                        app.settings.cleaning.rules.excludedNamePatterns.remove(at: index)
                    }
                }
                HStack {
                    TextField("Work_*", text: $newPattern)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit(addPattern)
                    Button("Add", action: addPattern)
                        .disabled(newPattern.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                Text("Use * for any run of characters and ? for a single character.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Folders and packages") {
                Toggle("Also move folders on the Desktop", isOn: $app.settings.cleaning.rules.includeDirectories)
                Toggle("Also move packages (.app, .pages, .key, …)", isOn: $app.settings.cleaning.rules.includePackages)
                Text("Folders are moved as a whole; the robot never looks inside them.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private func categoryRow(_ category: FileCategory) -> some View {
        let enabled = Binding(
            get: { !app.settings.cleaning.rules.excludedCategories.contains(category) },
            set: { on in
                if on {
                    app.settings.cleaning.rules.excludedCategories.remove(category)
                } else {
                    app.settings.cleaning.rules.excludedCategories.insert(category)
                }
            }
        )
        let destination = app.settings.cleaning.destinations.categoryDestinations[category]
        return VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: enabled) {
                Label(category.displayName, systemImage: category.symbolName)
            }
            HStack(spacing: 8) {
                Text(destination?.path ?? "Default destination")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Button(destination == nil ? "Choose Folder…" : "Change…") {
                    if let url = FolderPicker.chooseFolder(message: "Choose where \(category.displayName.lowercased()) go.", initial: destination) {
                        app.setCategoryDestination(url, for: category)
                    }
                }
                .controlSize(.small)
                if destination != nil {
                    Button("Use Default") { app.setCategoryDestination(nil, for: category) }
                        .controlSize(.small)
                }
            }
        }
    }

    private func tagRow(_ values: [String], remove: @escaping (Int) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                HStack {
                    Text(value).font(.callout.monospaced())
                    Spacer()
                    Button("Remove") { remove(index) }.controlSize(.small)
                }
            }
        }
    }

    private func addExtension() {
        let ext = ExclusionRules.normalizeExtension(newExtension)
        guard !ext.isEmpty, !app.settings.cleaning.rules.excludedExtensions.contains(ext) else { return }
        app.settings.cleaning.rules.excludedExtensions.append(ext)
        newExtension = ""
    }

    private func addPattern() {
        let pattern = newPattern.trimmingCharacters(in: .whitespaces)
        guard !pattern.isEmpty, !app.settings.cleaning.rules.excludedNamePatterns.contains(pattern) else { return }
        app.settings.cleaning.rules.excludedNamePatterns.append(pattern)
        newPattern = ""
    }
}

// MARK: - Appearance

struct AppearanceSettingsTab: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        Form {
            Section("Robot") {
                HStack {
                    RobotBadgeView(state: .driving, size: CGFloat(min(80, app.settings.appearance.robotSize)), skin: app.settings.appearance.robotSkin)
                    Spacer()
                    VStack(alignment: .trailing, spacing: 4) {
                        if app.isRehearsing {
                            Button("Stop Test Drive") { app.stopTestDrive() }
                        } else {
                            Button("Test Drive") { app.runTestDrive() }
                                .disabled(app.isBusy)
                        }
                        Text("Drives the robot around without moving any files.")
                            .font(.caption).foregroundStyle(.secondary)
                        Button("Copy Diagnostics") { app.copyDiagnosticsToClipboard() }
                            .controlSize(.small)
                        Text("Build \(BuildInfo.label)")
                            .font(.caption2).foregroundStyle(.tertiary)
                    }
                }
                Picker("Colour", selection: $app.settings.appearance.robotSkin) {
                    ForEach(RobotSkin.allCases) { skin in
                        Text(skin.displayName).tag(skin)
                    }
                }
                .pickerStyle(.segmented)
                Slider(value: $app.settings.appearance.robotSize, in: 36...120, step: 4) {
                    Text("Robot size")
                }
                Slider(value: $app.settings.appearance.movementSpeed, in: 80...600, step: 10) {
                    Text("Movement speed")
                }
            }

            Section("Movement") {
                Picker("Route", selection: $app.settings.appearance.movementPattern) {
                    ForEach(MovementPattern.allCases) { pattern in
                        Text(pattern.displayName).tag(pattern)
                    }
                }
                .pickerStyle(.radioGroup)
                Text(app.settings.appearance.movementPattern.summary)
                    .font(.caption).foregroundStyle(.secondary)
                Slider(value: $app.settings.appearance.wanderSeconds, in: 0...15, step: 1) {
                    Text(app.settings.appearance.wanderSeconds == 0 ? "No exploring" : "Explore up to \(Int(app.settings.appearance.wanderSeconds)) s per file")
                }
                .disabled(app.settings.appearance.movementPattern != .bounce)
                Picker("Robot layer", selection: $app.settings.appearance.robotLayer) {
                    ForEach(RobotLayer.allCases) { layer in
                        Text(layer.displayName).tag(layer)
                    }
                }
                Text("The robot never blocks clicks. Behind-windows mode sits just above the desktop icons, so open windows hide it.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Trail") {
                Picker("Style", selection: $app.settings.appearance.trailStyle) {
                    ForEach(TrailStyle.allCases) { style in
                        Text(style.displayName).tag(style)
                    }
                }
                Slider(value: $app.settings.appearance.trailOpacity, in: 0...1) { Text("Opacity") }
                    .disabled(app.settings.appearance.trailStyle == .none)
                Slider(value: $app.settings.appearance.trailFadeDuration, in: 0.5...8, step: 0.5) { Text("Fade duration") }
                    .disabled(app.settings.appearance.trailStyle == .none)
                Text("Trails are drawn on a transparent overlay and fade away. They never touch your wallpaper.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Effects") {
                Toggle("Suction and dust particles", isOn: $app.settings.appearance.particleEffects)
                Slider(value: $app.settings.appearance.animationIntensity, in: 0.2...1.5, step: 0.1) { Text("Animation intensity") }
                Toggle("Reduced motion", isOn: $app.settings.appearance.reducedMotion)
                Text("Reduced motion skips pivots, trails and particles and shortens the suction animation.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Finding the icons") {
                Toggle("Ask Finder for exact icon positions", isOn: $app.settings.appearance.useFinderIconPositions)
                Text("Recommended. macOS asks once whether Desktop Robovac may control Finder; the app only reads where the icons are. If you decline, the grid below is used instead.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Desktop icon grid (fallback)") {
                Picker("Finder sorts the Desktop by", selection: $app.settings.appearance.iconArrangement) {
                    ForEach(IconArrangement.allCases) { arrangement in
                        Text(arrangement.displayName).tag(arrangement)
                    }
                }
                Slider(value: $app.settings.appearance.iconGridColumnWidth, in: 64...160, step: 4) { Text("Column width") }
                Slider(value: $app.settings.appearance.iconGridRowHeight, in: 64...160, step: 4) { Text("Row height") }
                Text("Used when Finder cannot be asked. Match these to Finder › View Options for the best guess. The file moves themselves are always exact.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - Sound

struct SoundSettingsTab: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        Form {
            Section {
                Toggle("Enable sound", isOn: $app.settings.sound.enabled)
                Slider(value: $app.settings.sound.volume, in: 0...1) { Text("Volume") }
                    .disabled(!app.settings.sound.enabled)
            }
            Section("Character") {
                Toggle("Continuous motor hum while driving", isOn: $app.settings.sound.continuousMotorSound)
                Slider(value: $app.settings.sound.movementSoundFrequency, in: 0...1) { Text("Occasional wheel noise") }
                Slider(value: $app.settings.sound.suctionIntensity, in: 0...1) { Text("Suction intensity") }
                Toggle("Play a sound when cleaning completes", isOn: $app.settings.sound.completionSound)
            }
            .disabled(!app.settings.sound.enabled)
            Section("Sound events") {
                ForEach(SoundEvent.allCases) { event in
                    HStack {
                        Toggle(event.displayName, isOn: Binding(
                            get: { app.settings.sound.enabledEvents.contains(event) },
                            set: { on in
                                if on { app.settings.sound.enabledEvents.insert(event) } else { app.settings.sound.enabledEvents.remove(event) }
                            }
                        ))
                        Spacer()
                        Button("Play") { app.sound.play(event) }
                            .controlSize(.small)
                            .disabled(!app.settings.sound.isEnabled(event))
                    }
                }
            }
            .disabled(!app.settings.sound.enabled)
            Section {
                Text("All sounds are short, synthesized on the fly, and never play on launch.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - History

struct HistorySettingsTab: View {
    @EnvironmentObject private var app: AppState
    @State private var confirmClear = false

    var body: some View {
        VStack(spacing: 0) {
            if app.sessions.isEmpty {
                ContentUnavailableView("No cleanings yet", systemImage: "clock.arrow.circlepath", description: Text("Each run is recorded here with every file it moved."))
            } else {
                List {
                    ForEach(app.sessions) { session in
                        SessionRow(session: session)
                    }
                }
            }
            Divider()
            HStack {
                Text("\(app.sessions.count) session\(app.sessions.count == 1 ? "" : "s")")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Clear History…") { confirmClear = true }
                    .disabled(app.sessions.isEmpty || app.isCleaning)
            }
            .padding(10)
        }
        .onAppear { app.reloadHistory() }
        .confirmationDialog("Clear the cleaning history?", isPresented: $confirmClear) {
            Button("Clear History", role: .destructive) { app.clearHistory() }
        } message: {
            Text("Files stay where they are, but earlier cleanings can no longer be undone from here.")
        }
    }
}

private struct SessionRow: View {
    @EnvironmentObject private var app: AppState
    let session: CleaningSession

    var body: some View {
        DisclosureGroup {
            if !session.moves.isEmpty {
                Text("Moved").font(.caption.bold()).foregroundStyle(.secondary)
                ForEach(session.moves) { record in
                    VStack(alignment: .leading, spacing: 1) {
                        HStack {
                            Text(record.fileName).lineLimit(1).truncationMode(.middle)
                            if record.undone {
                                Text("restored").font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        Text("\(record.originalPath) → \(record.destinationPath)")
                            .font(.caption2).foregroundStyle(.secondary)
                            .lineLimit(1).truncationMode(.middle)
                    }
                }
            }
            if !session.skipped.isEmpty {
                Text("Skipped").font(.caption.bold()).foregroundStyle(.secondary)
                ForEach(session.skipped) { record in
                    Text("\(record.fileName): \(record.reason)").font(.caption).lineLimit(1)
                }
            }
            if !session.failed.isEmpty {
                Text("Failed").font(.caption.bold()).foregroundStyle(.red)
                ForEach(session.failed) { record in
                    Text("\(record.fileName): \(record.reason)").font(.caption).lineLimit(1)
                }
            }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.startedAt.formatted(date: .abbreviated, time: .shortened))
                    Text("\(session.mode.displayName) · \(session.status.displayName) · \(session.moves.count) moved, \(session.skipped.count) skipped, \(session.failed.count) failed")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if session.canUndo {
                    Button("Undo") { Task { await app.undo(session: session) } }
                        .controlSize(.small)
                        .disabled(app.isCleaning || app.undoInProgress)
                } else if !session.moves.isEmpty {
                    Text("Restored").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}
