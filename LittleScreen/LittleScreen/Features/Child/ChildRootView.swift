import SwiftUI

/// The whole child experience: library → full-screen player → back (4.1).
/// The player is layered in a ZStack rather than presented modally so the
/// parent gesture can replace the entire child UI in one step.
struct ChildRootView: View {
    @Environment(AppModel.self) private var app
    @State private var selected: VideoItem?

    var body: some View {
        ZStack {
            ChildLibraryView { item in
                withAnimation(.easeInOut(duration: 0.2)) { selected = item }
            }
            if let selected {
                ChildPlayerView(
                    item: selected,
                    url: app.library.paths.mediaURL(for: selected),
                    onExit: {
                        withAnimation(.easeInOut(duration: 0.2)) { self.selected = nil }
                    },
                    onSkip: {
                        withAnimation(.easeInOut(duration: 0.2)) { self.selected = next(after: selected) }
                    }
                )
                .id(selected.id)
                .transition(.opacity)
                .zIndex(1)
            }
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .preferredColorScheme(.light)
    }

    /// The video after `item` in library order, wrapping to the first. Returns
    /// nil (back to the library) when nothing else is playable.
    private func next(after item: VideoItem) -> VideoItem? {
        let items = app.library.childVisibleItems
        guard !items.isEmpty else { return nil }
        guard let index = items.firstIndex(where: { $0.id == item.id }) else { return items.first }
        let candidate = items[(index + 1) % items.count]
        return candidate.id == item.id ? nil : candidate
    }
}
