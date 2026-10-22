import SwiftUI
import RobovacCore

/// Horizontal text tabs: the selected one is semibold with an accent check.
struct TabStrip<T: Hashable & Identifiable>: View {
    let items: [T]
    let title: (T) -> String
    @Binding var selection: T
    var disabled = false

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(items) { item in
                    let selected = item == selection
                    Button {
                        withAnimation(.snappy(duration: 0.2)) { selection = item }
                    } label: {
                        HStack(spacing: 5) {
                            if selected {
                                CheckGlyph().stroke(DS.accent, style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                                    .frame(width: 11, height: 9)
                            }
                            Text(title(item))
                                .font(.system(size: 13, weight: selected ? .semibold : .regular))
                                .foregroundStyle(selected ? DS.text : DS.secondary70)
                        }
                        .frame(height: 24)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, 2)
        }
        .disabled(disabled)
        .opacity(disabled ? 0.6 : 1)
    }
}

struct CheckGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX + rect.width * 0.12, y: rect.minY + rect.height * 0.55))
        p.addLine(to: CGPoint(x: rect.minX + rect.width * 0.38, y: rect.maxY - rect.height * 0.1))
        p.addLine(to: CGPoint(x: rect.maxX - rect.width * 0.1, y: rect.minY + rect.height * 0.12))
        return p
    }
}

/// Pill segmented control: 28 pt cells in a 999-radius track; the selected
/// cell is white (dark: 16% white) with a soft shadow and accent glyph.
struct PillPicker<T: Hashable, Glyph: View>: View {
    let options: [T]
    @Binding var selection: T
    var disabled = false
    @ViewBuilder let glyph: (T) -> Glyph

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let selected = option == selection
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { selection = option }
                } label: {
                    glyph(option)
                        .frame(maxWidth: .infinity)
                        .frame(height: 28)
                        .foregroundStyle(selected ? DS.accent : DS.secondary60)
                        .background(
                            Capsule().fill(selected ? DS.pillSelected : Color.clear)
                                .shadow(color: .black.opacity(selected ? 0.14 : 0), radius: 1.5, y: 1)
                        )
                        .overlay(Capsule().strokeBorder(selected ? DS.hairline : .clear, lineWidth: 0.5))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Capsule().fill(DS.pillTrack))
        .disabled(disabled)
        .opacity(disabled ? 0.6 : 1)
    }
}

/// Small text pill segmented control used in Settings (e.g. White / Graphite).
struct TextPillPicker<T: Hashable>: View {
    let options: [T]
    let title: (T) -> String
    @Binding var selection: T

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let selected = option == selection
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { selection = option }
                } label: {
                    Text(title(option))
                        .font(DS.smallMedium)
                        .foregroundStyle(selected ? DS.accent : DS.secondary60)
                        .padding(.horizontal, 12)
                        .frame(height: 22)
                        .background(Capsule().fill(selected ? DS.pillSelected : Color.clear).shadow(color: .black.opacity(selected ? 0.14 : 0), radius: 1.5, y: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(Capsule().fill(DS.pillTrack))
    }
}

/// Route glyphs from the design: horizontal serpentines with 2, 3 and 5 passes,
/// a bouncing zigzag, and a direct arrow. Drawn in a 22 × 14 box, stroke 1.6.
struct RouteGlyph: View {
    let pattern: MovementPattern

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width / 22, size.height / 14)
            var ctx = context
            ctx.translateBy(x: (size.width - 22 * scale) / 2, y: (size.height - 14 * scale) / 2)
            ctx.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round)
            switch pattern {
            case .quick: ctx.stroke(RouteGlyph.serpentine(passes: 2), with: .color(.primary), style: style)
            case .standard: ctx.stroke(RouteGlyph.serpentine(passes: 3), with: .color(.primary), style: style)
            case .deep: ctx.stroke(RouteGlyph.serpentine(passes: 5), with: .color(.primary), style: style)
            case .bounce:
                var p = Path()
                p.move(to: CGPoint(x: 2, y: 12))
                p.addLine(to: CGPoint(x: 6, y: 2))
                p.addLine(to: CGPoint(x: 10, y: 12))
                p.addLine(to: CGPoint(x: 14, y: 2))
                p.addLine(to: CGPoint(x: 18, y: 12))
                p.addLine(to: CGPoint(x: 20, y: 7))
                ctx.stroke(p, with: .color(.primary), style: style)
            case .direct:
                var p = Path()
                p.move(to: CGPoint(x: 2, y: 7))
                p.addLine(to: CGPoint(x: 19, y: 7))
                p.move(to: CGPoint(x: 14, y: 2))
                p.addLine(to: CGPoint(x: 19, y: 7))
                p.addLine(to: CGPoint(x: 14, y: 12))
                ctx.stroke(p, with: .color(.primary), style: style)
            }
        }
        .frame(width: 22, height: 14)
    }

    /// `passes` horizontal runs joined by half-circle turns, as in the design's serp().
    static func serpentine(passes: Int) -> Path {
        let top: CGFloat = 2, bottom: CGFloat = 12
        let step = (bottom - top) / CGFloat(passes - 1)
        let r = min(step / 2, 2.2)
        var p = Path()
        var y = top
        for i in 0..<passes {
            let leftToRight = i % 2 == 0
            if i == 0 { p.move(to: CGPoint(x: leftToRight ? 2 : 20, y: y)) }
            p.addLine(to: CGPoint(x: leftToRight ? 20 - r : 2 + r, y: y))
            if i < passes - 1 {
                // Half circle down to the next pass.
                let centre = CGPoint(x: leftToRight ? 20 - r : 2 + r, y: y + step / 2)
                p.addArc(center: centre, radius: step / 2, startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: !leftToRight)
            }
            y += step
        }
        return p
    }
}

/// Droplet glyph that fills from the bottom; a slash for Off. 14 × 16 box.
struct TrailGlyph: View {
    let level: TrailLevel

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width / 14, size.height / 16)
            var ctx = context
            ctx.translateBy(x: (size.width - 14 * scale) / 2, y: (size.height - 16 * scale) / 2)
            ctx.scaleBy(x: scale, y: scale)
            let drop = TrailGlyph.dropPath()
            if level != .off {
                var fill = ctx
                fill.clip(to: drop)
                fill.fill(Path(CGRect(x: 0, y: level.fillY, width: 14, height: 16)), with: .color(.primary))
            }
            ctx.stroke(drop, with: .color(.primary), style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
            if level == .off {
                var slash = Path()
                slash.move(to: CGPoint(x: 2, y: 14))
                slash.addLine(to: CGPoint(x: 12, y: 2))
                ctx.stroke(slash, with: .color(.primary), style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
            }
        }
        .frame(width: 14, height: 16)
    }

    static func dropPath() -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 7, y: 1.5))
        p.addCurve(to: CGPoint(x: 2.2, y: 10.2), control1: CGPoint(x: 7, y: 1.5), control2: CGPoint(x: 2.2, y: 7))
        p.addArc(center: CGPoint(x: 7, y: 10.2), radius: 4.8, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
        p.addCurve(to: CGPoint(x: 7, y: 1.5), control1: CGPoint(x: 11.8, y: 7), control2: CGPoint(x: 7, y: 1.5))
        p.closeSubpath()
        return p
    }
}

/// Presets for the trail, mapped onto the opacity setting.
enum TrailLevel: CaseIterable, Hashable {
    case off, low, medium, high

    var fillY: CGFloat {
        switch self {
        case .off: return 16
        case .low: return 11.5
        case .medium: return 8.5
        case .high: return 0
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
        return allCases.filter { $0 != .off }.min { abs($0.opacity - appearance.trailOpacity) < abs($1.opacity - appearance.trailOpacity) } ?? .medium
    }
}
