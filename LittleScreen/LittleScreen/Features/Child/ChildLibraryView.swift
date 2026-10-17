import SwiftUI

/// Grid of approved videos (FR-01). Big colourful tiles, one header line,
/// nothing to tap that leads anywhere but a video.
struct ChildLibraryView: View {
    @Environment(AppModel.self) private var app
    let onSelect: (VideoItem) -> Void

    private let columns = [GridItem(.adaptive(minimum: 160, maximum: 280), spacing: 16)]

    var body: some View {
        let items = app.library.childVisibleItems
        ZStack {
            ChildTheme.background
            if app.usage.isLimitReached {
                TimeUpView(onDark: false, onBack: nil)
            } else if items.isEmpty {
                ChildEmptyLibraryView()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        header
                        LazyVGrid(columns: columns, spacing: 22) {
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
                    .padding(.top, 14)
                    .padding(.bottom, 36)
                }
                .scrollIndicators(.hidden)
            }
        }
        .onAppear { app.usage.rolloverIfNeeded() }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(ChildTheme.sunflower)
            Text("My Videos")
                .font(AppFont.child(34, .bold))
                .foregroundStyle(ChildTheme.text)
        }
        .padding(.leading, 2)
    }
}

struct VideoTile: View {
    let item: VideoItem
    let showsTitle: Bool

    var body: some View {
        let frame = ChildTheme.frame(for: item)
        VStack(spacing: 8) {
            ZStack(alignment: .bottomTrailing) {
                ThumbnailImage(item: item)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: ChildTheme.tileInnerRadius, style: .continuous))
                    .padding(ChildTheme.tileFramePadding)
                    .background(
                        RoundedRectangle(cornerRadius: ChildTheme.tileOuterRadius, style: .continuous)
                            .fill(frame)
                    )
                    .shadow(color: frame.opacity(0.38), radius: 11, y: 10)

                Circle()
                    .fill(Color.white)
                    .frame(width: 40, height: 40)
                    .overlay(
                        Image(systemName: "play.fill")
                            .font(.system(size: 17, weight: .black))
                            .foregroundStyle(frame)
                            .offset(x: 1.5)
                    )
                    .shadow(color: .black.opacity(0.18), radius: 4, y: 3)
                    .padding(14)
            }
            if showsTitle {
                Text(item.title)
                    .font(AppFont.child(18, .semibold))
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
                    .fill(Color.white.opacity(0.75))
                    .frame(width: 150, height: 150)
                    .shadow(color: ChildTheme.coral.opacity(0.25), radius: 16, y: 8)
                Image(systemName: "play.tv.fill")
                    .font(.system(size: 64, weight: .semibold))
                    .foregroundStyle(ChildTheme.coral)
            }
            Text("No videos yet")
                .font(AppFont.child(34, .bold))
                .foregroundStyle(ChildTheme.text)
            Text("Parents: \(ParentGesture.description.lowercased()) to add videos.")
                .font(AppFont.child(17, .regular))
                .foregroundStyle(ChildTheme.textSoft)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
    }
}

/// Shown when today's watching limit is used up: in the library instead of the
/// grid, and over the player if the limit runs out mid-video.
struct TimeUpView: View {
    let onDark: Bool
    let onBack: (() -> Void)?
    @Environment(AppModel.self) private var app

    var body: some View {
        ZStack {
            if onDark {
                Color.black.opacity(0.72).ignoresSafeArea()
            }
            VStack(spacing: 22) {
                IconBadge(systemImage: "moon.stars.fill", size: 110, colors: [ChildTheme.lavender, ChildTheme.sky])
                Text("All done for today!")
                    .font(AppFont.child(36, .bold))
                    .foregroundStyle(onDark ? Color.white : ChildTheme.text)
                    .multilineTextAlignment(.center)
                Text("Time for something else.\nSee you tomorrow!")
                    .font(AppFont.child(20, .regular))
                    .foregroundStyle(onDark ? Color.white.opacity(0.85) : ChildTheme.textSoft)
                    .multilineTextAlignment(.center)
                if let onBack {
                    BigChildButton(title: "Back", systemImage: "chevron.left", tint: ChildTheme.lavender, action: onBack)
                        .padding(.top, 6)
                }
            }
            .padding(.horizontal, 32)
        }
        .task {
            // Midnight can pass while this screen is up; re-check every half minute.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { break }
                app.usage.rolloverIfNeeded()
            }
        }
    }
}
