import SwiftUI

/// Grid of approved videos (FR-01). Big colourful tiles, one header line,
/// nothing to tap that leads anywhere but a video.
struct ChildLibraryView: View {
    @Environment(AppModel.self) private var app
    let onSelect: (VideoItem) -> Void

    private let columns = [GridItem(.adaptive(minimum: 160, maximum: 280), spacing: 20)]

    var body: some View {
        let items = app.library.childVisibleItems
        ZStack {
            ChildTheme.background
            if items.isEmpty {
                ChildEmptyLibraryView()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        header
                        LazyVGrid(columns: columns, spacing: 24) {
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
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 32)
                }
                .scrollIndicators(.hidden)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(ChildTheme.frames[1])
            Text("My Videos")
                .font(ChildTheme.titleFont)
                .foregroundStyle(ChildTheme.text)
        }
        .padding(.leading, 4)
    }
}

struct VideoTile: View {
    let item: VideoItem
    let showsTitle: Bool

    var body: some View {
        let frame = ChildTheme.frame(for: item)
        VStack(spacing: 10) {
            ZStack(alignment: .bottomTrailing) {
                ThumbnailImage(item: item)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .padding(7)
                    .background(
                        RoundedRectangle(cornerRadius: 25, style: .continuous)
                            .fill(frame)
                    )
                    .shadow(color: frame.opacity(0.45), radius: 12, y: 7)

                Circle()
                    .fill(Color.white)
                    .frame(width: 46, height: 46)
                    .overlay(
                        Image(systemName: "play.fill")
                            .font(.system(size: 20, weight: .black))
                            .foregroundStyle(frame)
                            .offset(x: 2)
                    )
                    .shadow(color: .black.opacity(0.18), radius: 4, y: 2)
                    .padding(16)
            }
            if showsTitle {
                Text(item.title)
                    .font(ChildTheme.tileFont)
                    .foregroundStyle(ChildTheme.text)
                    .lineLimit(1)
                    .padding(.horizontal, 6)
            }
        }
    }
}

struct ChildEmptyLibraryView: View {
    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                RoundedRectangle(cornerRadius: 36, style: .continuous)
                    .fill(Color.white.opacity(0.7))
                    .frame(width: 150, height: 150)
                    .shadow(color: ChildTheme.frames[0].opacity(0.25), radius: 16, y: 8)
                Image(systemName: "play.tv.fill")
                    .font(.system(size: 64, weight: .semibold))
                    .foregroundStyle(ChildTheme.frames[0])
            }
            Text("No videos yet")
                .font(ChildTheme.titleFont)
                .foregroundStyle(ChildTheme.text)
            Text("Parents: \(ParentGesture.description.lowercased()) to add videos.")
                .font(.system(.callout, design: .rounded))
                .foregroundStyle(ChildTheme.textSoft)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
    }
}
