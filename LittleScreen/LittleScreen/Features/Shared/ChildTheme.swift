import SwiftUI
import UIKit

/// Typefaces bundled with the app (see Resources/Fonts, OFL licensed).
/// Child mode uses Fredoka (round, friendly); the parent area uses Nunito.
/// If a font fails to load, `Font.custom` silently falls back to the system font.
enum AppFont {
    enum Weight { case regular, medium, semibold, bold, extrabold }

    /// Fixed-size Fredoka for child screens (child UI is already oversized).
    static func child(_ size: CGFloat, _ weight: Weight = .semibold) -> Font {
        .custom(childName(weight), fixedSize: size)
    }

    /// Nunito that scales with Dynamic Type, for parent screens.
    static func parent(_ size: CGFloat, _ weight: Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(parentName(weight), size: size, relativeTo: style)
    }

    static func parentUIFont(_ size: CGFloat, _ weight: Weight) -> UIFont {
        UIFont(name: parentName(weight), size: size) ?? .systemFont(ofSize: size, weight: weight == .extrabold ? .heavy : .bold)
    }

    private static func childName(_ weight: Weight) -> String {
        switch weight {
        case .regular: return "Fredoka-Regular"
        case .medium: return "Fredoka-Medium"
        case .semibold: return "Fredoka-SemiBold"
        case .bold, .extrabold: return "Fredoka-Bold"
        }
    }

    private static func parentName(_ weight: Weight) -> String {
        switch weight {
        case .regular, .medium: return "Nunito-Regular"
        case .semibold: return "Nunito-SemiBold"
        case .bold: return "Nunito-Bold"
        case .extrabold: return "Nunito-ExtraBold"
        }
    }
}

/// Visual language of child mode: warm, soft, high-contrast, no chrome.
enum ChildTheme {
    static let ground = Color(red: 1.00, green: 0.965, blue: 0.898)      // #FFF6E5 cream
    static let text = Color(red: 0.227, green: 0.169, blue: 0.145)       // #3A2B25 cocoa
    static let textSoft = Color(red: 0.227, green: 0.169, blue: 0.145).opacity(0.62)

    static let coral = Color(red: 0.969, green: 0.431, blue: 0.420)      // #F76E6B
    static let sunflower = Color(red: 1.00, green: 0.729, blue: 0.247)   // #FFBA3F
    static let mint = Color(red: 0.361, green: 0.780, blue: 0.620)       // #5CC79E
    static let sky = Color(red: 0.361, green: 0.659, blue: 0.949)        // #5CA8F2
    static let lavender = Color(red: 0.659, green: 0.549, blue: 0.925)   // #A88CEC
    static let tangerine = Color(red: 0.980, green: 0.604, blue: 0.380)  // #FA9A61

    /// Frame colours for tiles, in the order they cycle.
    static let frames: [Color] = [coral, sunflower, mint, sky, lavender, tangerine]

    /// Stable per-video colour (derived from the UUID bytes, not `hashValue`,
    /// which changes between launches).
    static func frame(for item: VideoItem) -> Color {
        frames[Int(item.id.uuid.0) % frames.count]
    }

    static var background: some View {
        ZStack {
            ground
            Circle()
                .fill(Color.white.opacity(0.55))
                .frame(width: 320, height: 320)
                .blur(radius: 30)
                .offset(x: -150, y: -300)
            Circle()
                .fill(sunflower.opacity(0.14))
                .frame(width: 300, height: 300)
                .blur(radius: 40)
                .offset(x: 170, y: 300)
        }
        .ignoresSafeArea()
    }

    // Tile geometry from the style tile.
    static let tileOuterRadius: CGFloat = 24
    static let tileFramePadding: CGFloat = 7
    static let tileInnerRadius: CGFloat = 17
}

/// Parent area: calm, light, one coral accent. Follows light/dark mode.
enum ParentTheme {
    static let groundUIColor = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.11, green: 0.10, blue: 0.095, alpha: 1)
            : UIColor(red: 0.957, green: 0.945, blue: 0.925, alpha: 1)   // #F4F1EC
    }
    static let cardUIColor = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.165, green: 0.153, blue: 0.141, alpha: 1)
            : UIColor.white
    }
    static let secondaryTextUIColor = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.66, green: 0.63, blue: 0.60, alpha: 1)
            : UIColor(red: 0.42, green: 0.384, blue: 0.361, alpha: 1)   // #6B625C
    }
    static let hairlineUIColor = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(white: 1, alpha: 0.08)
            : UIColor(red: 0.91, green: 0.882, blue: 0.847, alpha: 1)   // #E8E1D8
    }

    static let ground = Color(uiColor: groundUIColor)
    static let card = Color(uiColor: cardUIColor)
    static let secondaryText = Color(uiColor: secondaryTextUIColor)
    static let hairline = Color(uiColor: hairlineUIColor)
    static let accent = ChildTheme.coral
    static let success = Color(red: 0.18, green: 0.62, blue: 0.416)     // #2E9E6A
    static let warning = Color(red: 0.78, green: 0.44, blue: 0.06)      // #C7700F
    static let ringTrack = Color(red: 0.937, green: 0.914, blue: 0.882) // #EFE9E1
}
