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
                    StorageSummaryRow()
                }

                Section {
                    if app.library.items.isEmpty {
                        ContentUnavailableView {
                            Label("No videos yet", systemImage: "film.stack")
                        } description: {
                            Text("Tap Add to import MP4 or MOV files from the Files app. They are copied into LittleScreen and play offline.")
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
                } footer: {
                    Text("Only these videos appear in child mode. Entries whose file is missing are hidden from the child until the video is imported again.")
                }
            }
            .navigationTitle("Parent Area")
            .navigationDestination(for: UUID.self) { id in
                VideoDetailView(videoID: id)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        app.returnToChildMode()
                    } label: {
                        Label("Child Mode", systemImage: "play.rectangle.fill")
                    }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if !app.library.items.isEmpty {
                        EditButton()
                    }
                    Button {
                        showingFilePicker = true
                    } label: {
                        Label("Add", systemImage: "plus")
                    }
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Label("Settings", systemImage: "gearshape")
                    }
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
    }
}

struct VideoRow: View {
    let item: VideoItem
    let availability: MediaAvailability

    var body: some View {
        HStack(spacing: 12) {
            ThumbnailImage(item: item)
                .frame(width: 96, height: 54)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.body)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    if let duration = item.formattedDuration { Text(duration) }
                    if let size = item.formattedFileSize { Text(size) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                AvailabilityBadge(availability: availability)
            }
        }
        .padding(.vertical, 4)
    }
}

struct AvailabilityBadge: View {
    let availability: MediaAvailability

    var body: some View {
        Label(availability.parentLabel, systemImage: availability.isPlayable ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            .font(.caption2)
            .foregroundStyle(availability.isPlayable ? Color.green : Color.orange)
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
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
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
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding()
                }
            }
        }
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
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed:
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        }
    }
}

struct StorageSummaryRow: View {
    @Environment(AppModel.self) private var app
    @State private var usedBytes: Int64 = 0
    @State private var freeBytes: Int64?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "internaldrive")
                .font(.title2)
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(app.library.items.count) \(app.library.items.count == 1 ? "video" : "videos") · \(ByteCountFormatter.string(fromByteCount: usedBytes, countStyle: .file)) used")
                if let freeBytes {
                    Text("\(ByteCountFormatter.string(fromByteCount: freeBytes, countStyle: .file)) free on this iPhone")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
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
