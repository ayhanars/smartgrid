import SwiftUI

/// Grid of approved videos (FR-01). Big tiles, no chrome, nothing to tap that
/// leads anywhere but a video.
struct ChildLibraryView: View {
    @Environment(AppModel.self) private var app
    let onSelect: (VideoItem) -> Void

    private let columns = [GridItem(.adaptive(minimum: 150, maximum: 260), spacing: 16)]

    var body: some View {
        let items = app.library.childVisibleItems
        ZStack {
            ChildPalette.background.ignoresSafeArea()
            if items.isEmpty {
                ChildEmptyLibraryView()
            } else {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 20) {
                        ForEach(items) { item in
                            Button {
                                onSelect(item)
                            } label: {
                                VideoTile(item: item, showsTitle: app.settings.showTitlesInChildMode)
                            }
                            .buttonStyle(TileButtonStyle())
                            .accessibilityLabel(item.title)
                        }
                    }
                    .padding(16)
                    .padding(.top, 8)
                }
                .scrollIndicators(.hidden)
            }
        }
    }
}

struct VideoTile: View {
    let item: VideoItem
    let showsTitle: Bool

    var body: some View {
        VStack(spacing: 8) {
            ThumbnailImage(item: item)
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.8), lineWidth: 3)
                )
                .shadow(color: .black.opacity(0.15), radius: 6, y: 3)
            if showsTitle {
                Text(item.title)
                    .font(.system(.headline, design: .rounded))
                    .foregroundStyle(ChildPalette.text)
                    .lineLimit(1)
            }
        }
    }
}

struct ChildEmptyLibraryView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "film.stack")
                .font(.system(size: 64))
                .foregroundStyle(ChildPalette.text.opacity(0.4))
            Text("No videos yet")
                .font(.system(.title, design: .rounded).bold())
                .foregroundStyle(ChildPalette.text)
            Text("Parents: \(ParentGesture.description.lowercased()) to add videos.")
                .font(.callout)
                .foregroundStyle(ChildPalette.text.opacity(0.7))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
    }
}

enum ChildPalette {
    static let background = Color(red: 1.0, green: 0.97, blue: 0.90)
    static let text = Color(red: 0.25, green: 0.20, blue: 0.18)
}
