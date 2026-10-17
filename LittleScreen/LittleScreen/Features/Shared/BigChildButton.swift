import SwiftUI

/// Oversized, high-contrast button for child-facing screens.
struct BigChildButton: View {
    let title: String
    let systemImage: String
    var tint: Color = .accentColor
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 28, weight: .heavy, design: .rounded))
                .padding(.horizontal, 36)
                .frame(minHeight: 80)
                .background(
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [tint.opacity(0.95), tint],
                                startPoint: .top, endPoint: .bottom
                            )
                        )
                )
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.7), lineWidth: 3))
                .foregroundStyle(.white)
                .shadow(color: tint.opacity(0.5), radius: 14, y: 8)
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

/// Rounded gradient square behind an SF Symbol: the app's "hero icon" motif.
struct IconBadge: View {
    let systemImage: String
    var size: CGFloat = 56
    var colors: [Color] = [Color(red: 1.0, green: 0.62, blue: 0.40), Color(red: 0.97, green: 0.36, blue: 0.46)]

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: systemImage)
                    .font(.system(size: size * 0.46, weight: .bold))
                    .foregroundStyle(.white)
            )
            .shadow(color: colors.last?.opacity(0.35) ?? .clear, radius: size * 0.18, y: size * 0.1)
    }
}

extension Bundle {
    var appVersionDescription: String {
        let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }
}
