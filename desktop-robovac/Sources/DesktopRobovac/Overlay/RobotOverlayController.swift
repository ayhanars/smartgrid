import AppKit
import SwiftUI

/// A borderless, transparent, click-through window that sits just above the
/// desktop icons and below every normal application window.
final class OverlayWindow: NSWindow {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// Creates and tears down the overlay window for the display that shows the
/// desktop icons (the display with the menu bar).
@MainActor
final class RobotOverlayController {
    let scene = RobotSceneModel()
    private var window: OverlayWindow?
    private(set) var screen: NSScreen?

    /// The display Finder uses for the desktop: the one holding the menu bar.
    var targetScreen: NSScreen? {
        NSScreen.screens.first ?? NSScreen.main
    }

    /// Desktop area in overlay coordinates (origin top-left, y downwards):
    /// everything between the menu bar and the Dock.
    func desktopRegion(on screen: NSScreen) -> CGRect {
        let frame = screen.frame
        let visible = screen.visibleFrame
        let top = frame.maxY - visible.maxY
        let left = visible.minX - frame.minX
        return CGRect(x: left, y: top, width: visible.width, height: visible.height)
    }

    var isShowing: Bool { window != nil }

    func show(on screen: NSScreen) {
        if let window, self.screen == screen {
            window.setFrame(screen.frame, display: true)
            window.orderFrontRegardless()
            return
        }
        hide()
        self.screen = screen

        let window = OverlayWindow(
            contentRect: screen.frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.hidesOnDeactivate = false
        window.isExcludedFromWindowsMenu = true
        window.animationBehavior = .none
        // Just above the desktop icons, below every ordinary window.
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]

        let host = NSHostingView(rootView: RobotAnimationView(scene: scene))
        host.frame = NSRect(origin: .zero, size: screen.frame.size)
        host.autoresizingMask = [.width, .height]
        window.contentView = host
        window.setFrame(screen.frame, display: true)
        window.orderFrontRegardless()
        self.window = window
        scene.startClock()
    }

    func hide() {
        scene.stopClock()
        scene.setVisible(false)
        scene.resetEffects()
        window?.orderOut(nil)
        window?.contentView = nil
        window?.close()
        window = nil
        screen = nil
    }
}
