import SwiftUI
import RobovacCore

@main
struct DesktopRobovacApp: App {
    @NSApplicationDelegateAdaptor(AppLifecycleManager.self) private var lifecycle

    var body: some Scene {
        MenuBarExtra {
            PopoverView()
                .environmentObject(lifecycle.appState)
        } label: {
            Image(nsImage: RobotIconRenderer.menuBarImage())
                .accessibilityLabel("Desktop Robovac")
        }
        .menuBarExtraStyle(.window)

        Window("Cleaning Preview", id: WindowID.preview) {
            PreviewView()
                .environmentObject(lifecycle.appState)
        }
        .windowResizability(.contentSize)
        .defaultSize(width: 560, height: 620)

        Window("Add to the Dock", id: WindowID.dockGuide) {
            DockSetupGuideView()
                .environmentObject(lifecycle.appState)
        }
        .windowResizability(.contentSize)

        Settings {
            SettingsView()
                .environmentObject(lifecycle.appState)
        }
    }
}

enum WindowID {
    static let preview = "preview"
    static let dockGuide = "dock-guide"
}
