import AppKit
import Foundation

/// Asks Finder where it draws each desktop icon, through a single Apple event.
///
/// This is the only exact source of icon positions on macOS. It uses the public
/// Finder scripting interface (no private API) and needs the user's one-time
/// Automation permission ("Desktop Robovac wants to control Finder"). When the
/// permission is missing or Finder does not answer, the caller falls back to
/// the grid approximation.
@MainActor
enum FinderIconPositions {
    struct Result {
        /// Icon centres keyed by file name, in Finder's coordinates: origin at the
        /// top-left corner of the main display, y growing downwards.
        var positions: [String: CGPoint]
        var error: String?
    }

    private static let script = """
    tell application "Finder"
        set itemNames to name of every item of desktop
        set itemPositions to desktop position of every item of desktop
        return {itemNames, itemPositions}
    end tell
    """

    static func fetch() -> Result {
        guard let appleScript = NSAppleScript(source: script) else {
            return Result(positions: [:], error: "Could not compile the Finder script.")
        }
        var errorInfo: NSDictionary?
        let descriptor = appleScript.executeAndReturnError(&errorInfo)
        if let errorInfo {
            let message = errorInfo[NSAppleScript.errorMessage] as? String ?? "Finder did not answer."
            return Result(positions: [:], error: message)
        }
        guard descriptor.numberOfItems == 2,
              let names = descriptor.atIndex(1),
              let points = descriptor.atIndex(2) else {
            return Result(positions: [:], error: "Unexpected reply from Finder.")
        }
        var positions: [String: CGPoint] = [:]
        let count = min(names.numberOfItems, points.numberOfItems)
        if count > 0 {
            for index in 1...count {
                guard let name = names.atIndex(index)?.stringValue,
                      let point = points.atIndex(index).flatMap(point(from:)) else { continue }
                positions[name] = point
            }
        }
        return Result(positions: positions, error: nil)
    }

    /// Finder answers with QuickDraw points ({v, h} as two big-endian shorts) or,
    /// depending on the coercion, with a two-item list {x, y}.
    static func point(from descriptor: NSAppleEventDescriptor) -> CGPoint? {
        if descriptor.numberOfItems == 2,
           let x = descriptor.atIndex(1)?.int32Value,
           let y = descriptor.atIndex(2)?.int32Value {
            return CGPoint(x: CGFloat(x), y: CGFloat(y))
        }
        let data = descriptor.data
        if data.count >= 4 {
            let bytes = [UInt8](data.prefix(4))
            let v = Int16(bitPattern: UInt16(bytes[0]) << 8 | UInt16(bytes[1]))
            let h = Int16(bitPattern: UInt16(bytes[2]) << 8 | UInt16(bytes[3]))
            return CGPoint(x: CGFloat(h), y: CGFloat(v))
        }
        if let list = descriptor.coerce(toDescriptorType: typeAEList), list.numberOfItems == 2,
           let x = list.atIndex(1)?.int32Value, let y = list.atIndex(2)?.int32Value {
            return CGPoint(x: CGFloat(x), y: CGFloat(y))
        }
        return nil
    }

    /// Converts a Finder desktop point to the overlay's coordinate space for `screen`.
    static func overlayPoint(_ finderPoint: CGPoint, on screen: NSScreen) -> CGPoint {
        guard let main = NSScreen.screens.first else { return finderPoint }
        let x = finderPoint.x - (screen.frame.minX - main.frame.minX)
        let y = finderPoint.y - (main.frame.maxY - screen.frame.maxY)
        return CGPoint(x: x, y: y)
    }
}
