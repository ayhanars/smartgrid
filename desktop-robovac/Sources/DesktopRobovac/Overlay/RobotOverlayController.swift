import AppKit
import RobovacCore
import SwiftUI

/// A borderless, transparent, click-through window that sits just above the
/// desktop icons and below every normal application window.
final class OverlayWindow: NSWindow {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// Layer-backed container with a top-left origin, matching the overlay's
/// coordinate space, so subviews can be placed straight from robot coordinates.
final class OverlayContainerView: NSView {
    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
}

/// Creates and tears down the overlay window for the display that shows the
/// desktop icons (the display with the menu bar).
@MainActor
final class RobotOverlayController {
    let scene = RobotSceneModel()
    private var window: OverlayWindow?
    private(set) var screen: NSScreen?
    private var robotHost: NSHostingView<RobotLayerView>?
    private var trailHost: NSHostingView<TrailLayerView>?
    private var trailFrame = CGRect.zero

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

        // Two small layer-backed views instead of one full-screen canvas: the
        // compositor moves the robot's view, and only its contents are redrawn.
        let container = OverlayContainerView(frame: NSRect(origin: .zero, size: screen.frame.size))
        container.wantsLayer = true
        container.autoresizingMask = [.width, .height]

        let trailHost = NSHostingView(rootView: TrailLayerView(scene: scene, clock: scene.trailClock))
        trailHost.wantsLayer = true
        trailHost.isHidden = true
        trailHost.frame = .zero
        container.addSubview(trailHost)

        let robotHost = NSHostingView(rootView: RobotLayerView(scene: scene))
        robotHost.wantsLayer = true
        robotHost.isHidden = true
        robotHost.frame = NSRect(x: 0, y: 0, width: scene.robotHostSide, height: scene.robotHostSide)
        container.addSubview(robotHost)

        window.contentView = container
        window.setFrame(screen.frame, display: true)
        window.orderFrontRegardless()
        self.window = window
        self.trailHost = trailHost
        self.robotHost = robotHost
        trailFrame = .zero
        scene.backingScale = window.backingScaleFactor
        scene.resetFrameStats()
        scene.onFrame = { [weak self] in self?.layoutHosts() }
        scene.startClock(on: container)
        print("Robovac overlay shown: screen=\(screen.frame) level=\(window.level.rawValue) visible=\(window.isVisible) screens=\(NSScreen.screens.count)")
    }

    func hide() {
        scene.stopClock()
        scene.onFrame = nil
        scene.setVisible(false)
        scene.resetEffects()
        window?.orderOut(nil)
        window?.contentView = nil
        window?.close()
        window = nil
        screen = nil
        robotHost = nil
        trailHost = nil
    }

    /// Moves the robot's view with the robot and fits the trail's view to the
    /// trail. Frame changes are composited, not redrawn.
    private func layoutHosts() {
        if let robotHost {
            let side = scene.robotHostSide
            if robotHost.frame.width != side {
                robotHost.setFrameSize(NSSize(width: side, height: side))
            }
            robotHost.setFrameOrigin(NSPoint(x: scene.robotHostOrigin.x, y: scene.robotHostOrigin.y))
            let visible = scene.pose.isVisible || scene.sprite != nil || !scene.particles.particles.isEmpty
            if robotHost.isHidden == visible { robotHost.isHidden = !visible }
        }
        guard let trailHost, scene.frame % 2 == 0 else { return }
        guard let bounds = scene.trail.liveBounds() else {
            if !trailHost.isHidden { trailHost.isHidden = true }
            return
        }
        // Grow in 32 pt steps so the view is not re-laid out every frame.
        let step: CGFloat = 32
        let fitted = CGRect(
            x: (bounds.minX / step).rounded(.down) * step,
            y: (bounds.minY / step).rounded(.down) * step,
            width: 0, height: 0
        ).union(CGRect(
            x: (bounds.maxX / step).rounded(.up) * step,
            y: (bounds.maxY / step).rounded(.up) * step,
            width: 0, height: 0
        ))
        if fitted != trailFrame {
            trailFrame = fitted
            scene.trailClock.origin = fitted.origin
            trailHost.frame = fitted
        }
        if trailHost.isHidden { trailHost.isHidden = false }
    }
}
