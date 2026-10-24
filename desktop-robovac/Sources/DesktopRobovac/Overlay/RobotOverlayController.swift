import AppKit
import RobovacCore
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

    /// The display the user is working on: the one under the mouse pointer (where
    /// they just clicked the menu bar icon), falling back to the main display.
    var targetScreen: NSScreen? {
        let mouse = NSEvent.mouseLocation
        if let underMouse = NSScreen.screens.first(where: { $0.frame.contains(mouse) }) {
            return underMouse
        }
        return NSScreen.main ?? NSScreen.screens.first
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

    /// Where the app's menu bar icon sits, in overlay coordinates: the point just
    /// below the icon, so the robot can drop out of the menu bar like leaving a dock.
    /// Falls back to the right end of the menu bar when the item cannot be found.
    func menuBarAnchor(on screen: NSScreen) -> CGPoint {
        let region = desktopRegion(on: screen)
        var anchorX = region.maxX - 140
        for window in NSApp.windows {
            let className = String(describing: type(of: window))
            guard className.contains("StatusBarWindow") || window.level == .statusBar else { continue }
            let frame = window.frame
            guard frame.height <= 44, frame.width <= 120, screen.frame.contains(CGPoint(x: frame.midX, y: frame.midY)) else { continue }
            anchorX = frame.midX - screen.frame.minX
            break
        }
        return CGPoint(x: min(max(anchorX, region.minX + 40), region.maxX - 40), y: region.minY)
    }

    static func windowLevel(for layer: RobotLayer) -> NSWindow.Level {
        switch layer {
        case .aboveWindows:
            // Above normal and floating windows, below the menu bar and the Dock.
            return NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.floatingWindow)) + 1)
        case .behindWindows:
            // Just above the desktop icons, below every ordinary window.
            return NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
        }
    }

    func show(on screen: NSScreen, layer: RobotLayer) {
        if let window, self.screen == screen {
            window.level = RobotOverlayController.windowLevel(for: layer)
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
        window.level = RobotOverlayController.windowLevel(for: layer)
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]

        let host = NSHostingView(rootView: RobotAnimationView(scene: scene))
        host.frame = NSRect(origin: .zero, size: screen.frame.size)
        host.autoresizingMask = [.width, .height]
        window.contentView = host
        window.setFrame(screen.frame, display: true)
        window.orderFrontRegardless()
        self.window = window
        scene.startClock(on: host)
        print("Robovac overlay shown: screen=\(screen.frame) level=\(window.level.rawValue) visible=\(window.isVisible) screens=\(NSScreen.screens.count)")
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
