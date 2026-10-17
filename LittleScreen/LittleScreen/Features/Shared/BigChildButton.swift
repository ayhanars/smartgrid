import SwiftUI

/// Oversized, high-contrast capsule button for child-facing screens.
struct BigChildButton: View {
    let title: String
    let systemImage: String
    var tint: Color = ChildTheme.coral
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 24, weight: .heavy))
                Text(title)
                    .font(AppFont.child(26, .bold))
            }
            .padding(.horizontal, 36)
            .frame(minHeight: 76)
            .background(Capsule().fill(tint))
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.75), lineWidth: 3))
            .foregroundStyle(.white)
            .shadow(color: tint.opacity(0.5), radius: 13, y: 12)
        }
        .buttonStyle(TileButtonStyle())
    }
}

/// Gentle press feedback used by the library tiles and child buttons.
struct TileButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.65), value: configuration.isPressed)
    }
}

/// Horizontal wobble, driven by incrementing `animatableData`.
struct ShakeEffect: GeometryEffect {
    var amount: CGFloat = 12
    var shakesPerUnit: CGFloat = 3
    var animatableData: CGFloat

    func effectValue(size: CGSize) -> ProjectionTransform {
        let x = amount * sin(animatableData * .pi * shakesPerUnit)
        return ProjectionTransform(CGAffineTransform(translationX: x, y: 0))
    }
}

/// Rounded coloured square behind an SF Symbol: the app's badge motif.
struct IconBadge: View {
    let systemImage: String
    var size: CGFloat = 56
    var colors: [Color] = [ChildTheme.coral, ChildTheme.coral]

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
            .fill(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: systemImage)
                    .font(.system(size: size * 0.46, weight: .bold))
                    .foregroundStyle(.white)
            )
            .shadow(color: colors.last?.opacity(0.35) ?? .clear, radius: size * 0.17, y: size * 0.12)
    }
}

/// Parent-area primary button: 54 pt, 16 pt radius, coral, Nunito ExtraBold.
struct ParentPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(AppFont.parent(17, .extrabold, relativeTo: .headline))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(ParentTheme.accent))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Round white toolbar button with a coral glyph (parent navigation bars).
struct ToolbarCircleLabel: View {
    let systemImage: String

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 17, weight: .bold))
            .foregroundStyle(ParentTheme.accent)
            .frame(width: 36, height: 36)
            .background(Circle().fill(ParentTheme.card))
    }
}

extension Bundle {
    var appVersionDescription: String {
        let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }
}
