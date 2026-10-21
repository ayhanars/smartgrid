import AppKit
import RobovacCore

/// Application startup and shutdown. Keeps the app a menu bar utility (no Dock
/// icon) and makes sure an interrupted cleaning session is recorded as such.
@MainActor
final class AppLifecycleManager: NSObject, NSApplicationDelegate, ObservableObject {
    let appState: AppState

    override init() {
        appState = AppState()
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // `swift run` has no Info.plist; LSUIElement in the bundled app does the same thing.
        NSApp.setActivationPolicy(.accessory)
        appState.start()
        if ProcessInfo.processInfo.environment["ROBOVAC_SMOKE_TEST"] == "1" {
            appState.runSmokeTest()
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        appState.shutdown()
        return .terminateNow
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
}
