import SwiftUI

/// Switches between child mode, parent verification and the parent area.
/// The parent gesture recogniser is installed here so it is live everywhere.
struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @State private var backgroundedAt: Date?

    /// Parent area closes itself after this long in the background, so a phone
    /// left open on the dashboard does not hand a child the library editor.
    private let parentModeBackgroundTimeout: TimeInterval = 120

    var body: some View {
        Group {
            if app.needsPINSetup {
                OnboardingView()
            } else {
                switch app.mode {
                case .child:
                    ChildRootView()
                case .parentVerification:
                    PINEntryView()
                case .parent:
                    ParentDashboardView()
                }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: app.mode)
        .background {
            ParentGestureRecognizer { app.requestParentAccess() }
        }
        #if DEBUG
        // Debug builds only: ⌘⇧P on a hardware keyboard (or the Simulator)
        // opens parent verification, for testing where the gesture is awkward.
        .background {
            Button("Open parent verification") { app.requestParentAccess() }
                .keyboardShortcut("p", modifiers: [.command, .shift])
                .opacity(0)
                .accessibilityHidden(true)
        }
        #endif
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                backgroundedAt = Date()
            case .active:
                app.library.refreshAvailability()
                app.usage.rolloverIfNeeded()
                if let backgroundedAt, app.mode != .child,
                   Date().timeIntervalSince(backgroundedAt) > parentModeBackgroundTimeout {
                    app.returnToChildMode()
                }
                backgroundedAt = nil
            default:
                break
            }
        }
    }
}
