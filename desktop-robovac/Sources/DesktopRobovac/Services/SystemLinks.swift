import AppKit
import SwiftUI

/// Brings the hosting window in front of the menu bar popover and makes it
/// key; without this, windows opened from the popover appear behind it.
struct BringToFront: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        DispatchQueue.main.async { raise(view) }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async { raise(nsView) }
    }

    private func raise(_ view: NSView) {
        guard let window = view.window else { return }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        // Dismiss the menu bar panel so it no longer covers the window.
        for panel in NSApp.windows where panel !== window && String(describing: type(of: panel)).contains("MenuBarExtra") {
            panel.orderOut(nil)
        }
    }
}

enum SystemLinks {
    /// Privacy & Security → Files and Folders, where Desktop access is granted.
    static func openFilesAndFoldersPrivacy() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders") {
            NSWorkspace.shared.open(url)
        }
    }

    static func reveal(_ url: URL) {
        if FileManager.default.fileExists(atPath: url.path) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } else {
            NSWorkspace.shared.activateFileViewerSelecting([url.deletingLastPathComponent()])
        }
    }
}
