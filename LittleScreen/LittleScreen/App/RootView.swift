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
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                backgroundedAt = Date()
            case .active:
                app.library.refreshAvailability()
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
