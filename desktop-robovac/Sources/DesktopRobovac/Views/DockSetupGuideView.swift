import SwiftUI

/// macOS does not let apps put files in the Dock, but a folder can live there
/// as a stack. This guide walks the user through adding the cleanup folder.
struct DockSetupGuideView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Keep your cleanups one click away").font(.title2.bold())
            Text("Add the Robovac destination folder to the right side of the Dock as a stack. Everything the robot collects shows up there, straight from the Dock.")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 10) {
                step(1, "Click “Reveal in Finder” below. The destination folder opens with its parent selected.")
                step(2, "Drag the folder onto the right side of the Dock, next to the Trash.")
                step(3, "Right-click the new stack and choose “Display as: Stack” and “Sort by: Date Added”.")
            }

            GroupBox {
                HStack {
                    Image(systemName: "folder")
                    Text(app.settings.cleaning.destinations.defaultDestination.path)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer()
                }
            }

            HStack {
                Spacer()
                Button("Reveal in Finder") {
                    let url = app.settings.cleaning.destinations.defaultDestination
                    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
                    SystemLinks.reveal(url)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 460)
        .background(BringToFront())
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(number)")
                .font(.caption.bold())
                .frame(width: 20, height: 20)
                .background(Circle().fill(Color.accentColor.opacity(0.2)))
            Text(text)
        }
    }
}
