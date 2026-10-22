import SwiftUI
import RobovacCore

/// Horizontal text tabs: the selected one is bold with a blue check badge,
/// like a robot vacuum app's mode strip.
struct TabStrip<T: Hashable & Identifiable>: View {
    let items: [T]
    let title: (T) -> String
    @Binding var selection: T
    var disabled = false

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 18) {
                ForEach(items) { item in
                    let selected = item == selection
                    Button {
                        withAnimation(.snappy(duration: 0.2)) { selection = item }
                    } label: {
                        HStack(spacing: 5) {
                            Text(title(item))
                                .font(.system(size: 15, weight: selected ? .semibold : .regular))
                                .foregroundStyle(selected ? Color.primary : Color.secondary)
                            if selected {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 12))
                                    .foregroundStyle(.white, Color.accentColor)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 2)
            .padding(.vertical, 4)
        }
        .disabled(disabled)
        .opacity(disabled ? 0.6 : 1)
    }
}

/// A pill-shaped segmented control holding custom glyphs.
struct PillPicker<T: Hashable, Glyph: View>: View {
    let options: [T]
    @Binding var selection: T
    var disabled = false
    @ViewBuilder let glyph: (T) -> Glyph

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(options.enumerated()), id: \.offset) { index, option in
                let selected = option == selection
                Button {
                    withAnimation(.snappy(duration: 0.2)) { selection = option }
                } label: {
                    glyph(option)
                        .frame(maxWidth: .infinity)
                        .frame(height: 30)
                        .foregroundStyle(selected ? Color.primary : Color.secondary)
                        .background(
                            Capsule().fill(selected ? Color.primary.opacity(0.16) : Color.clear)
                        )
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                if index < options.count - 1, !selected, options[index + 1] != selection {
                    Rectangle().fill(Color.primary.opacity(0.12)).frame(width: 1, height: 14)
                }
            }
        }
        .padding(3)
        .background(Capsule().fill(Color.primary.opacity(0.07)))
        .disabled(disabled)
        .opacity(disabled ? 0.6 : 1)
    }
}

/// Section header in the "Title  Value" style with the value in the accent colour.
struct ControlHeader: View {
    let title: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title).font(.system(size: 13, weight: .medium))
            Text(value).font(.system(size: 12)).foregroundStyle(Color.accentColor)
            Spacer()
        }
    }
}

/// Route glyphs: serpentines of increasing density, a bouncing zigzag, and a direct arrow.
struct RouteGlyph: View {
    let pattern: MovementPattern

    var body: some View {
        Canvas { context, size in
            let inset: CGFloat = 4
            let rect = CGRect(x: inset, y: inset, width: size.width - inset * 2, height: size.height - inset * 2)
            var path = Path()
            switch pattern {
            case .quick, .standard, .deep:
                let lanes = pattern == .quick ? 2 : (pattern == .standard ? 3 : 4)
                let gap = rect.width / CGFloat(lanes)
                var x = rect.maxX
                var down = true
                path.move(to: CGPoint(x: x, y: rect.minY))
                for lane in 0..<lanes {
                    path.addLine(to: CGPoint(x: x, y: down ? rect.maxY : rect.minY))
                    if lane < lanes - 1 {
                        x -= gap
                        path.addLine(to: CGPoint(x: x, y: down ? rect.maxY : rect.minY))
                    }
                    down.toggle()
                }
                context.stroke(path, with: .color(.primary), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
            case .bounce:
                path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
                path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.3, y: rect.minY))
                path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.62, y: rect.maxY))
                path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + rect.height * 0.25))
                context.stroke(path, with: .color(.primary), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                context.stroke(Path(CGRect(x: rect.minX - 1, y: rect.minY - 1, width: rect.width + 2, height: rect.height + 2)), with: .color(.primary.opacity(0.35)), lineWidth: 1)
            case .direct:
                path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
                path.addLine(to: CGPoint(x: rect.maxX - 3, y: rect.minY + 3))
                context.stroke(path, with: .color(.primary), style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
                var head = Path()
                head.move(to: CGPoint(x: rect.maxX - 8, y: rect.minY + 1))
                head.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
                head.addLine(to: CGPoint(x: rect.maxX - 1, y: rect.minY + 8))
                context.stroke(head, with: .color(.primary), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                context.fill(Path(ellipseIn: CGRect(x: rect.minX - 2, y: rect.maxY - 2, width: 4, height: 4)), with: .color(.primary))
            }
        }
        .frame(width: 24, height: 18)
    }
}

/// Trail strength glyphs: a droplet that fills progressively, and a crossed one for off.
struct TrailGlyph: View {
    let level: TrailLevel

    var body: some View {
        ZStack {
            Image(systemName: level == .off ? "drop.slash" : "drop")
                .font(.system(size: 14))
            if level != .off {
                Image(systemName: "drop.fill")
                    .font(.system(size: 14))
                    .mask(alignment: .bottom) {
                        Rectangle().frame(height: 16 * level.fill)
                    }
            }
        }
        .frame(width: 24, height: 18)
    }
}

/// Presets for the trail, mapped onto the opacity setting.
enum TrailLevel: CaseIterable, Hashable {
    case off, low, medium, high

    var fill: CGFloat {
        switch self {
        case .off: return 0
        case .low: return 0.35
        case .medium: return 0.65
        case .high: return 1
        }
    }

    var displayName: String {
        switch self {
        case .off: return "Off"
        case .low: return "Low"
        case .medium: return "Medium"
        case .high: return "High"
        }
    }

    var opacity: Double {
        switch self {
        case .off: return 0
        case .low: return 0.25
        case .medium: return 0.4
        case .high: return 0.6
        }
    }

    static func closest(to appearance: AppearanceSettings) -> TrailLevel {
        if appearance.trailStyle == .none { return .off }
        return allCases.min { abs($0.opacity - appearance.trailOpacity) < abs($1.opacity - appearance.trailOpacity) } ?? .medium
    }
}
