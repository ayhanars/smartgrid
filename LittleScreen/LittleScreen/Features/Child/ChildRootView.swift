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
                ChildPlayerView(item: selected, url: app.library.paths.mediaURL(for: selected)) {
                    withAnimation(.easeInOut(duration: 0.2)) { self.selected = nil }
                }
                .id(selected.id)
                .transition(.opacity)
                .zIndex(1)
            }
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .preferredColorScheme(.light)
    }
}
