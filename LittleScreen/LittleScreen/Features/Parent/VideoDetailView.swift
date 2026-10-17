import AVFoundation
import PhotosUI
import SwiftUI

/// Edit one library entry: title, thumbnail, media file, deletion (FR-05).
struct VideoDetailView: View {
    let videoID: UUID

    @Environment(AppModel.self) private var app
    @State private var title = ""
    @State private var showingFramePicker = false
    @State private var showingReplacePicker = false
    @State private var photoItem: PhotosPickerItem?
    @State private var confirmDelete = false
    @State private var confirmRemoveFile = false
    @State private var importSession: ImportSession?
    @State private var errorMessage: String?

    var body: some View {
        if let item = app.library.item(with: videoID) {
            form(for: item)
        } else {
            ContentUnavailableView("Video removed", systemImage: "trash")
        }
    }

    private func form(for item: VideoItem) -> some View {
        let availability = app.library.availability[item.id] ?? .missing
        return Form {
            Section("Thumbnail") {
                ThumbnailImage(item: item)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                if availability.isPlayable {
                    Button {
                        showingFramePicker = true
                    } label: {
                        Label("Pick a frame from the video", systemImage: "film")
                    }
                }
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Label("Choose a photo", systemImage: "photo")
                }
            }

            Section("Title") {
                TextField("Title", text: $title)
                    .submitLabel(.done)
                    .onSubmit(saveTitle)
            }

            Section("Details") {
                LabeledContent("Status") {
                    AvailabilityBadge(availability: availability)
                }
                if let duration = item.formattedDuration {
                    LabeledContent("Duration", value: duration)
                }
                if let size = item.formattedFileSize {
                    LabeledContent("Size", value: size)
                }
                if let dimensions = item.formattedDimensions {
                    LabeledContent("Dimensions", value: dimensions)
                }
                LabeledContent("Added", value: item.createdAt.formatted(date: .abbreviated, time: .shortened))
            }

            Section {
                if availability.isPlayable {
                    Button(role: .destructive) {
                        confirmRemoveFile = true
                    } label: {
                        Label("Remove video file, keep entry", systemImage: "externaldrive.badge.minus")
                    }
                } else {
                    Button {
                        showingReplacePicker = true
                    } label: {
                        Label("Import the video file again", systemImage: "square.and.arrow.down")
                    }
                }
                Button(role: .destructive) {
                    confirmDelete = true
                } label: {
                    Label("Delete video", systemImage: "trash")
                }
            } footer: {
                Text("Deleting removes the video and its file from this iPhone. The original in Files is not affected.")
            }
        }
        .navigationTitle(item.title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { title = item.title }
        .onDisappear(perform: saveTitle)
        .sheet(isPresented: $showingFramePicker) {
            FramePickerView(url: app.library.paths.mediaURL(for: item), duration: item.durationSeconds ?? 0) { data in
                applyThumbnail(data)
            }
        }
        .sheet(item: $importSession) { session in
            ImportProgressView(session: session)
                .interactiveDismissDisabled(session.isRunning)
        }
        .fileImporter(isPresented: $showingReplacePicker, allowedContentTypes: VideoImporter.pickerTypes) { result in
            switch result {
            case .success(let url):
                let session = ImportSession()
                session.start(urls: [url], importer: app.importer, library: app.library, replacing: item.id)
                importSession = session
            case .failure(let error):
                errorMessage = error.localizedDescription
            }
        }
        .onChange(of: photoItem) { _, newValue in
            guard let newValue else { return }
            Task { await loadPhoto(newValue) }
        }
        .confirmationDialog("Delete “\(item.title)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete video and its file", role: .destructive) {
                do { try app.library.remove(item.id, deleteFiles: true) }
                catch { errorMessage = error.localizedDescription }
            }
        } message: {
            Text("This frees \(item.formattedFileSize ?? "its storage") on this iPhone.")
        }
        .confirmationDialog("Remove the video file?", isPresented: $confirmRemoveFile, titleVisibility: .visible) {
            Button("Remove file", role: .destructive) {
                do { try app.library.deleteMediaFile(for: item.id) }
                catch { errorMessage = error.localizedDescription }
            }
        } message: {
            Text("The entry stays in your library but is hidden from your child until you import the video again.")
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

    private func saveTitle() {
        do { try app.library.rename(videoID, to: title) }
        catch { errorMessage = error.localizedDescription }
    }

    private func applyThumbnail(_ data: Data) {
        do { try app.library.setThumbnail(for: videoID, jpegData: data) }
        catch { errorMessage = error.localizedDescription }
    }

    private func loadPhoto(_ pickerItem: PhotosPickerItem) async {
        defer { photoItem = nil }
        guard let data = try? await pickerItem.loadTransferable(type: Data.self),
              let image = UIImage(data: data),
              let jpeg = ThumbnailGenerator.jpegData(from: image) else {
            errorMessage = "That photo couldn't be used as a thumbnail."
            return
        }
        applyThumbnail(jpeg)
    }
}

/// Scrub through the video (parent only!) and pick a frame as the thumbnail.
struct FramePickerView: View {
    let url: URL
    let duration: Double
    let onPick: (Data) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var time: Double = 0
    @State private var preview: UIImage?
    @State private var previewTask: Task<Void, Never>?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                ZStack {
                    Rectangle().fill(Color.black)
                    if let preview {
                        Image(uiImage: preview)
                            .resizable()
                            .scaledToFit()
                    } else {
                        ProgressView().tint(.white)
                    }
                }
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                Slider(value: $time, in: 0...max(duration, 0.1))
                Text(formatted(time))
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .padding()
            .navigationTitle("Pick a frame")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Use frame") { save() }
                        .disabled(saving)
                }
            }
            .task { schedulePreview(delay: 0) }
            .onChange(of: time) { _, _ in schedulePreview(delay: 0.15) }
        }
    }

    private func schedulePreview(delay: Double) {
        previewTask?.cancel()
        let requested = time
        previewTask = Task { @MainActor in
            if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
            guard !Task.isCancelled else { return }
            let cmTime = CMTime(seconds: requested, preferredTimescale: 600)
            let data = try? await ThumbnailGenerator.jpegData(for: url, at: cmTime, maxDimension: 480)
            guard !Task.isCancelled, let data else { return }
            preview = UIImage(data: data)
        }
    }

    private func save() {
        saving = true
        let cmTime = CMTime(seconds: time, preferredTimescale: 600)
        Task { @MainActor in
            defer { saving = false }
            if let data = try? await ThumbnailGenerator.jpegData(for: url, at: cmTime) {
                onPick(data)
                dismiss()
            }
        }
    }

    private func formatted(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}
