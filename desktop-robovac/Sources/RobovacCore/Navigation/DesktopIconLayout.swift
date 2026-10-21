import Foundation
#if canImport(CoreGraphics)
import CoreGraphics
#endif

/// Approximates where Finder draws each desktop icon.
///
/// macOS has no public API for reading desktop icon positions, and the PRD rules
/// out private Finder APIs and AppleScript as the primary mechanism. Finder's
/// default behaviour is predictable enough for a convincing animation, though:
/// icons sit on a fixed grid of columns that fill from the top-right corner,
/// top to bottom, then move one column to the left. This type reproduces that
/// grid in overlay coordinates (origin top-left). The robot drives to these
/// approximate cells; the file move itself is always authoritative.
public struct DesktopIconLayout: Sendable {
    /// Usable desktop region (below the menu bar, above the Dock), origin top-left.
    public var region: CGRect
    public var columnWidth: CGFloat
    public var rowHeight: CGFloat
    public var arrangement: IconArrangement
    /// Finder keeps a small gap between the first column and the screen edge.
    public var rightInset: CGFloat
    public var topInset: CGFloat

    public init(
        region: CGRect,
        columnWidth: CGFloat = 96,
        rowHeight: CGFloat = 104,
        arrangement: IconArrangement = .dateAdded,
        rightInset: CGFloat = 12,
        topInset: CGFloat = 8
    ) {
        self.region = region
        self.columnWidth = max(24, columnWidth)
        self.rowHeight = max(24, rowHeight)
        self.arrangement = arrangement
        self.rightInset = rightInset
        self.topInset = topInset
    }

    public var rowsPerColumn: Int {
        max(1, Int(((region.height - topInset) / rowHeight).rounded(.down)))
    }

    public var columnCount: Int {
        max(1, Int(((region.width - rightInset) / columnWidth).rounded(.down)))
    }

    /// The centre of grid slot `index` (0 = top-right).
    public func slotCenter(at index: Int) -> CGPoint {
        let column = index / rowsPerColumn
        let row = index % rowsPerColumn
        let x = region.maxX - rightInset - (CGFloat(column) + 0.5) * columnWidth
        let y = region.minY + topInset + (CGFloat(row) + 0.5) * rowHeight
        return CGPoint(x: max(region.minX + columnWidth / 2, x), y: min(region.maxY - rowHeight / 2, y))
    }

    /// Rectangle covered by the icon in slot `index`.
    public func slotRect(at index: Int) -> CGRect {
        let center = slotCenter(at: index)
        return CGRect(x: center.x - columnWidth / 2, y: center.y - rowHeight / 2, width: columnWidth, height: rowHeight)
    }

    /// Items in the order Finder fills slots for the configured arrangement.
    public func ordered(_ items: [DesktopItem]) -> [DesktopItem] {
        switch arrangement {
        case .dateAdded:
            return items.sorted { a, b in
                let da = a.addedDate ?? .distantPast
                let db = b.addedDate ?? .distantPast
                if da != db { return da < db }
                return a.name.localizedStandardCompare(b.name) == .orderedAscending
            }
        case .name:
            return items.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        case .kind:
            return items.sorted { a, b in
                if a.fileExtension != b.fileExtension { return a.fileExtension < b.fileExtension }
                return a.name.localizedStandardCompare(b.name) == .orderedAscending
            }
        case .dateModified:
            return items.sorted { a, b in
                let da = a.modificationDate ?? .distantPast
                let db = b.modificationDate ?? .distantPast
                if da != db { return da > db }
                return a.name.localizedStandardCompare(b.name) == .orderedAscending
            }
        }
    }

    /// Assigns every item an approximate icon centre.
    public func positions(for items: [DesktopItem]) -> [UUID: CGPoint] {
        var result: [UUID: CGPoint] = [:]
        for (index, item) in ordered(items).enumerated() {
            result[item.id] = slotCenter(at: index)
        }
        return result
    }

    /// Assigns every item its approximate icon rectangle.
    public func rects(for items: [DesktopItem]) -> [UUID: CGRect] {
        var result: [UUID: CGRect] = [:]
        for (index, item) in ordered(items).enumerated() {
            result[item.id] = slotRect(at: index)
        }
        return result
    }
}
