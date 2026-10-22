import AppKit
import SwiftUI

/// Design tokens from the Claude Design handoff (Popover.dc.html, Settings.dc.html).
/// Every colour carries a light and a dark value; sizes are in points.
enum DS {
    // MARK: Colours

    static func dynamic(_ light: NSColor, _ dark: NSColor) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        })
    }

    static func rgba(_ r: Int, _ g: Int, _ b: Int, _ a: Double = 1) -> NSColor {
        NSColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: a)
    }

    static func hex(_ value: UInt32, _ alpha: Double = 1) -> NSColor {
        rgba(Int((value >> 16) & 0xFF), Int((value >> 8) & 0xFF), Int(value & 0xFF), alpha)
    }

    static let accent = dynamic(hex(0x007AFF), hex(0x0A84FF))
    static let text = dynamic(hex(0x1D1D1F), hex(0xF5F5F7))
    static let secondary60 = dynamic(rgba(60, 60, 67, 0.6), rgba(235, 235, 245, 0.6))
    static let secondary70 = dynamic(rgba(60, 60, 67, 0.7), rgba(235, 235, 245, 0.7))
    static let secondary75 = dynamic(rgba(60, 60, 67, 0.75), rgba(235, 235, 245, 0.75))
    static let tertiary = dynamic(rgba(60, 60, 67, 0.45), rgba(235, 235, 245, 0.4))
    static let quaternary = dynamic(rgba(60, 60, 67, 0.35), rgba(235, 235, 245, 0.35))

    static let card = dynamic(hex(0xFFFFFF), rgba(255, 255, 255, 0.07))
    static let cardRing = dynamic(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.08))
    static let separator = dynamic(rgba(0, 0, 0, 0.07), rgba(255, 255, 255, 0.08))
    static let hairline = dynamic(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.06))
    static let pillTrack = dynamic(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08))
    static let pillSelected = dynamic(hex(0xFFFFFF), rgba(255, 255, 255, 0.16))
    static let hoverFill = dynamic(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08))
    static let switchOff = dynamic(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.2))
    static let fieldFill = dynamic(hex(0xFFFFFF), rgba(0, 0, 0, 0.25))
    static let fieldRing = dynamic(rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.12))
    static let chipFill = dynamic(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.1))
    static let chipClose = dynamic(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.15))
    static let progressTrack = dynamic(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.12))

    static let smallButton = dynamic(hex(0xFFFFFF), rgba(255, 255, 255, 0.1))
    static let smallButtonRing = dynamic(rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.5))
    static let disabledFill = dynamic(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.06))
    static let disabledText = dynamic(rgba(60, 60, 67, 0.35), rgba(235, 235, 245, 0.3))
    static let destructive = dynamic(hex(0xD70015), hex(0xFF453A))
    static let destructiveFill = dynamic(hex(0xFF3B30), hex(0xFF453A))
    static let success = dynamic(hex(0x1F8A3B), hex(0x30D158))
    static let folderBlue = dynamic(hex(0x74B2F5), hex(0x5AA2F0))

    enum Tint {
        case grey, green, orange, blue

        var background: Color {
            switch self {
            case .grey: return DS.dynamic(DS.hex(0xE3E3E7), DS.hex(0x3A3A3E))
            case .green: return DS.dynamic(DS.hex(0xD6F1DC), DS.hex(0x1B4A2A))
            case .orange: return DS.dynamic(DS.hex(0xFFE6C6), DS.hex(0x4F3511))
            case .blue: return DS.dynamic(DS.hex(0xD5E7FF), DS.hex(0x173B68))
            }
        }

        var foreground: Color {
            switch self {
            case .grey: return DS.secondary70
            case .green: return DS.dynamic(DS.hex(0x1F7A37), DS.hex(0x5FDC82))
            case .orange: return DS.dynamic(DS.hex(0x9A4D00), DS.hex(0xFFB340))
            case .blue: return DS.dynamic(DS.hex(0x0B57B8), DS.hex(0x79B8FF))
            }
        }
    }

    enum NoticeKind {
        case warn, info, neutral

        var dot: Color {
            switch self {
            case .warn: return DS.dynamic(DS.hex(0xFF9500), DS.hex(0xFF9F0A))
            case .info: return DS.accent
            case .neutral: return DS.quaternary
            }
        }

        var background: Color {
            switch self {
            case .warn: return DS.dynamic(DS.hex(0xFFF3E0), DS.rgba(255, 159, 10, 0.12))
            case .info: return DS.dynamic(DS.hex(0xE8F1FF), DS.rgba(10, 132, 255, 0.14))
            case .neutral: return DS.card
            }
        }

        var ring: Color {
            switch self {
            case .warn: return DS.dynamic(DS.rgba(255, 149, 0, 0.35), DS.rgba(255, 159, 10, 0.3))
            case .info: return DS.dynamic(DS.rgba(0, 122, 255, 0.3), DS.rgba(10, 132, 255, 0.3))
            case .neutral: return DS.cardRing
            }
        }
    }

    // MARK: Type

    static let title = Font.system(size: 15, weight: .semibold)
    static let body = Font.system(size: 13)
    static let bodySemibold = Font.system(size: 13, weight: .semibold)
    static let small = Font.system(size: 12)
    static let smallMedium = Font.system(size: 12, weight: .medium)
    static let smallSemibold = Font.system(size: 12, weight: .semibold)
    static let caption = Font.system(size: 11)
    static let captionMedium = Font.system(size: 11, weight: .medium)
    static let captionSemibold = Font.system(size: 11, weight: .semibold)
    static let micro = Font.system(size: 10, weight: .medium)
    static let stat = Font.system(size: 20, weight: .semibold)
}

// MARK: - Surfaces

/// White card on a hairline ring, radius 10.
struct CardBackground: ViewModifier {
    var radius: CGFloat = 10
    var fill: Color = DS.card
    var ring: Color = DS.cardRing

    func body(content: Content) -> some View {
        content
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(fill))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(ring, lineWidth: 0.5))
    }
}

extension View {
    func dsCard(radius: CGFloat = 10, fill: Color = DS.card, ring: Color = DS.cardRing) -> some View {
        modifier(CardBackground(radius: radius, fill: fill, ring: ring))
    }
}

/// "Title                     Value" row header; the value in accent colour.
struct DSSectionHeader: View {
    let title: String
    var value: String? = nil
    var uppercase = false

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            if uppercase {
                Text(title.uppercased())
                    .font(DS.captionSemibold)
                    .tracking(0.66)
                    .foregroundStyle(DS.secondary60)
            } else {
                Text(title).font(DS.smallSemibold)
            }
            Spacer()
            if let value {
                Text(value)
                    .font(uppercase ? DS.caption : DS.smallMedium)
                    .foregroundStyle(uppercase ? DS.secondary60 : DS.accent)
            }
        }
        .padding(.horizontal, 2)
    }
}

// MARK: - Buttons

/// 22 pt high small button: white with a hairline ring, or accent / destructive.
struct DSSmallButtonStyle: ButtonStyle {
    enum Kind { case secondary, primary, destructive, destructiveText }
    var kind: Kind = .secondary

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(kind == .secondary || kind == .destructiveText ? DS.small : DS.smallSemibold)
            .foregroundStyle(foreground)
            .padding(.horizontal, 10)
            .frame(height: 22)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(background))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(ring, lineWidth: 0.5))
            .opacity(configuration.isPressed ? 0.75 : 1)
    }

    private var foreground: Color {
        switch kind {
        case .secondary: return DS.text
        case .primary, .destructive: return .white
        case .destructiveText: return DS.destructive
        }
    }

    private var background: Color {
        switch kind {
        case .secondary, .destructiveText: return DS.smallButton
        case .primary: return DS.accent
        case .destructive: return DS.destructiveFill
        }
    }

    private var ring: Color {
        switch kind {
        case .secondary, .destructiveText: return DS.smallButtonRing
        case .primary, .destructive: return .clear
        }
    }
}

/// 36 pt high main action: filled accent, white secondary, or red-text destructive.
struct DSPrimaryButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, destructive, disabled }
    var kind: Kind = .primary

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(DS.bodySemibold)
            .foregroundStyle(foreground)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity)
            .frame(height: 36)
            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(background))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(ring, lineWidth: 0.5))
            .shadow(color: kind == .primary ? Color(nsColor: DS.hex(0x007AFF, 0.35)) : .clear, radius: 1.5, y: 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
    }

    private var foreground: Color {
        switch kind {
        case .primary: return .white
        case .secondary: return DS.text
        case .destructive: return DS.destructive
        case .disabled: return DS.disabledText
        }
    }

    private var background: Color {
        switch kind {
        case .primary: return DS.accent
        case .secondary, .destructive: return DS.smallButton
        case .disabled: return DS.disabledFill
        }
    }

    private var ring: Color {
        switch kind {
        case .secondary, .destructive: return DS.dynamic(DS.rgba(0, 0, 0, 0.18), DS.rgba(0, 0, 0, 0.5))
        default: return .clear
        }
    }
}

/// Footer icon + label button, 26 pt, hover fill.
struct DSFooterButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        DSFooterButtonLabel(configuration: configuration)
    }
}

private struct DSFooterButtonLabel: View {
    let configuration: ButtonStyleConfiguration
    @State private var hovering = false

    var body: some View {
        configuration.label
            .font(DS.captionMedium)
            .foregroundStyle(DS.secondary75)
            .padding(.horizontal, 8)
            .frame(height: 26)
            .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(hovering ? DS.hoverFill : Color.clear))
            .opacity(configuration.isPressed ? 0.7 : 1)
            .onHover { hovering = $0 }
    }
}

// MARK: - Switch

/// 26 × 15 pill switch with a 13 pt knob.
struct DSSwitchStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) { configuration.isOn.toggle() }
        } label: {
            HStack {
                configuration.label
                Spacer(minLength: 10)
                DSSwitchKnob(isOn: configuration.isOn)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct DSSwitchKnob: View {
    var isOn: Bool

    var body: some View {
        ZStack(alignment: isOn ? .trailing : .leading) {
            Capsule().fill(isOn ? DS.accent : DS.switchOff)
                .overlay(Capsule().strokeBorder(DS.dynamic(DS.rgba(0, 0, 0, 0.1), DS.rgba(255, 255, 255, 0.1)), lineWidth: 0.5))
            Circle()
                .fill(.white)
                .shadow(color: .black.opacity(0.3), radius: 1, y: 1)
                .frame(width: 13, height: 13)
                .padding(1)
        }
        .frame(width: 26, height: 15)
    }
}
