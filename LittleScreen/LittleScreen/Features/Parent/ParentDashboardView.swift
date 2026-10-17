import SwiftUI

/// Parent area (FR-05): the library list, import, settings, back to child mode.
struct ParentDashboardView: View {
    @Environment(AppModel.self) private var app
    @State private var showingFilePicker = false
    @State private var importSession: ImportSession?
    @State private var pendingDeletion: VideoItem?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let libraryError = app.library.lastError {
                    Section {
                        Label(libraryError.localizedDescription, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    StorageCard()
                        .listRowInsets(EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16))
                    if app.usage.isLimitEnabled {
                        UsageRow()
                            .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
                    }
                }

                Section {
                    if app.library.items.isEmpty {
                        ContentUnavailableView {
                            Label("No videos yet", systemImage: "film.stack")
                        } description: {
                            Text("Tap Add to import MP4 or MOV files from the Files app. They are copied into LittleScreen and play offline.")
                        } actions: {
                            Button {
                                showingFilePicker = true
                            } label: {
                                Label("Add a video", systemImage: "plus")
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(ParentTheme.accent)
                        }
                    } else {
                        ForEach(app.library.items) { item in
                            NavigationLink(value: item.id) {
                                VideoRow(item: item, availability: app.library.availability[item.id] ?? .missing)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    pendingDeletion = item
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                        .onMove { source, destination in
                            do { try app.library.move(fromOffsets: source, toOffset: destination) }
                            catch { errorMessage = error.localizedDescription }
                        }
                    }
                } header: {
                    Text("Videos")
                        .font(AppFont.parent(13, .bold, relativeTo: .footnote))
                } footer: {
                    Text("Only these videos appear in child mode. Entries whose file is missing are hidden from the child until the video is imported again.")
                        .font(AppFont.parent(12, .regular, relativeTo: .caption))
                }
            }
            .font(AppFont.parent(17))
            .scrollContentBackground(.hidden)
            .background(ParentTheme.ground)
            .navigationTitle("Parent Area")
            .navigationDestination(for: UUID.self) { id in
                VideoDetailView(videoID: id)
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    app.returnToChildMode()
                } label: {
                    Label("Back to Child Mode", systemImage: "figure.and.child.holdinghands")
                }
                .buttonStyle(ParentPrimaryButtonStyle())
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(ParentTheme.ground.opacity(0.96))
                .overlay(alignment: .top) { ParentTheme.hairline.frame(height: 1) }
            }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if !app.library.items.isEmpty {
                        EditButton()
                            .font(AppFont.parent(16, .bold))
                            .tint(ParentTheme.accent)
                    }
                    Button {
                        showingFilePicker = true
                    } label: {
                        ToolbarCircleLabel(systemImage: "plus")
                    }
                    .accessibilityLabel("Add video")
                    NavigationLink {
                        SettingsView()
                    } label: {
                        ToolbarCircleLabel(systemImage: "gearshape.fill")
                    }
                    .accessibilityLabel("Settings")
                }
            }
            .fileImporter(
                isPresented: $showingFilePicker,
                allowedContentTypes: VideoImporter.pickerTypes,
                allowsMultipleSelection: true
            ) { result in
                switch result {
                case .success(let urls):
                    guard !urls.isEmpty else { return }
                    let session = ImportSession()
                    session.start(urls: urls, importer: app.importer, library: app.library)
                    importSession = session
                case .failure(let error):
                    errorMessage = error.localizedDescription
                }
            }
            .sheet(item: $importSession) { session in
                ImportProgressView(session: session)
                    .interactiveDismissDisabled(session.isRunning)
            }
            .confirmationDialog(
                "Delete “\(pendingDeletion?.title ?? "")”?",
                isPresented: Binding(
                    get: { pendingDeletion != nil },
                    set: { if !$0 { pendingDeletion = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Delete video and its file", role: .destructive) {
                    if let item = pendingDeletion {
                        do { try app.library.remove(item.id, deleteFiles: true) }
                        catch { errorMessage = error.localizedDescription }
                    }
                    pendingDeletion = nil
                }
            } message: {
                Text("This frees \(pendingDeletion?.formattedFileSize ?? "its storage") on this iPhone. The original in Files is not affected.")
            }
            .alert(
                "Something went wrong",
                isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
        .tint(ParentTheme.accent)
    }
}

struct VideoRow: View {
    let item: VideoItem
    let availability: MediaAvailability

    var body: some View {
        HStack(spacing: 14) {
            ThumbnailImage(item: item)
                .frame(width: 104, height: 58)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(ChildTheme.frame(for: item), lineWidth: 2.5)
                )
                .opacity(availability.isPlayable ? 1 : 0.5)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(AppFont.parent(16, .bold, relativeTo: .body))
                    .lineLimit(2)
                HStack(spacing: 6) {
                    if let duration = item.formattedDuration {
                        Text(duration)
                    }
                    if item.formattedDuration != nil, item.formattedFileSize != nil {
                        Text("·")
                    }
                    if let size = item.formattedFileSize {
                        Text(size)
                    }
                }
                .font(AppFont.parent(12, .regular, relativeTo: .caption))
                .foregroundStyle(ParentTheme.secondaryText)
                AvailabilityBadge(availability: availability)
            }
        }
        .padding(.vertical, 4)
    }
}

struct AvailabilityBadge: View {
    let availability: MediaAvailability

    var body: some View {
        Text(availability.parentLabel)
            .font(AppFont.parent(12, .bold, relativeTo: .caption))
            .foregroundStyle(availability.isPlayable ? ParentTheme.success : ParentTheme.warning)
    }
}

struct ImportProgressView: View {
    let session: ImportSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(session.entries) { entry in
                HStack {
                    statusIcon(for: entry.status)
                        .frame(width: 24)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.fileName).lineLimit(1)
                        if case .failed(let reason) = entry.status {
                            Text(reason)
                                .font(AppFont.parent(12, .regular, relativeTo: .caption))
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
            .font(AppFont.parent(16))
            .scrollContentBackground(.hidden)
            .background(ParentTheme.ground)
            .navigationTitle(session.isRunning ? "Importing…" : "Import finished")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    if session.isRunning {
                        Button("Cancel", role: .cancel) { session.cancel() }
                    } else {
                        Button("Done") { dismiss() }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if !session.isRunning {
                    Text(summary)
                        .font(AppFont.parent(13, .regular, relativeTo: .footnote))
                        .foregroundStyle(ParentTheme.secondaryText)
                        .padding()
                }
            }
        }
        .tint(ParentTheme.accent)
    }

    private var summary: String {
        let done = session.completedCount
        let failed = session.failedCount
        switch (done, failed) {
        case (_, 0): return done == 1 ? "1 video added." : "\(done) videos added."
        case (0, _): return "Nothing was added."
        default: return "\(done) added, \(failed) failed."
        }
    }

    @ViewBuilder
    private func statusIcon(for status: ImportSession.Status) -> some View {
        switch status {
        case .waiting:
            Image(systemName: "circle.dotted").foregroundStyle(.secondary)
        case .importing:
            ProgressView()
        case .done:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(ParentTheme.success)
        case .failed:
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        }
    }
}

/// Storage ring + counts, as drawn on the dashboard artboard.
struct StorageCard: View {
    @Environment(AppModel.self) private var app
    @State private var usedBytes: Int64 = 0
    @State private var freeBytes: Int64?

    private var fraction: Double {
        guard let freeBytes, usedBytes + freeBytes > 0 else { return 0 }
        return Double(usedBytes) / Double(usedBytes + freeBytes)
    }

    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .stroke(ParentTheme.ringTrack, lineWidth: 8)
                Circle()
                    .trim(from: 0, to: max(0.02, fraction))
                    .stroke(ParentTheme.accent, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeOut(duration: 0.6), value: fraction)
                Image(systemName: "internaldrive")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(ParentTheme.secondaryText)
            }
            .frame(width: 70, height: 70)
            .accessibilityLabel("\(Int((fraction * 100).rounded())) percent of storage used")

            VStack(alignment: .leading, spacing: 3) {
                Text("\(app.library.items.count) \(app.library.items.count == 1 ? "video" : "videos")")
                    .font(AppFont.parent(19, .extrabold, relativeTo: .title3))
                Text("\(ByteCountFormatter.string(fromByteCount: usedBytes, countStyle: .file)) in LittleScreen")
                    .font(AppFont.parent(15, .regular, relativeTo: .subheadline))
                    .foregroundStyle(ParentTheme.secondaryText)
                if let freeBytes {
                    Text("\(ByteCountFormatter.string(fromByteCount: freeBytes, countStyle: .file)) free on this iPhone")
                        .font(AppFont.parent(13, .regular, relativeTo: .footnote))
                        .foregroundStyle(ParentTheme.secondaryText)
                }
            }
            Spacer(minLength: 0)
        }
        .task(id: app.library.items) {
            let media = app.library.media
            let (used, free) = await Task.detached(priority: .utility) {
                (media.totalMediaBytes(), media.availableCapacity())
            }.value
            usedBytes = used
            freeBytes = free
        }
    }
}

/// Today's watching against the daily limit, with a one-tap bonus.
struct UsageRow: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let usage = app.usage
        let allowed = max(1, usage.allowedSecondsToday)
        let fraction = min(1, Double(usage.secondsToday) / Double(allowed))
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Watched today")
                        .font(AppFont.parent(15, .bold, relativeTo: .subheadline))
                    Spacer()
                    Text("\(usage.minutesWatchedToday) of \(usage.allowedSecondsToday / 60) min")
                        .font(AppFont.parent(13, .semibold, relativeTo: .footnote))
                        .foregroundStyle(usage.isLimitReached ? ParentTheme.warning : ParentTheme.secondaryText)
                        .monospacedDigit()
                }
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(ParentTheme.ringTrack)
                        Capsule()
                            .fill(usage.isLimitReached ? ParentTheme.warning : ParentTheme.accent)
                            .frame(width: max(6, proxy.size.width * fraction))
                    }
                }
                .frame(height: 8)
            }
            Button {
                app.usage.addBonus()
            } label: {
                Text("+\(UsageTracker.bonusMinutes) min")
                    .font(AppFont.parent(13, .extrabold, relativeTo: .footnote))
                    .foregroundStyle(ParentTheme.accent)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(ParentTheme.accent.opacity(0.14)))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Add \(UsageTracker.bonusMinutes) minutes for today")
        }
    }
}
