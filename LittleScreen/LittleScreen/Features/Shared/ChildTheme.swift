import SwiftUI

/// Visual language of child mode: warm, soft, high-contrast, no chrome.
enum ChildTheme {
    static let backgroundTop = Color(red: 1.00, green: 0.96, blue: 0.88)
    static let backgroundBottom = Color(red: 0.99, green: 0.88, blue: 0.80)
    static let text = Color(red: 0.30, green: 0.21, blue: 0.18)
    static let textSoft = Color(red: 0.30, green: 0.21, blue: 0.18).opacity(0.6)

    /// Frame colours for tiles. Chosen so white thumbnails and dark thumbnails
    /// both read well against them.
    static let frames: [Color] = [
        Color(red: 0.98, green: 0.45, blue: 0.42),   // coral
        Color(red: 1.00, green: 0.73, blue: 0.25),   // sunflower
        Color(red: 0.36, green: 0.78, blue: 0.62),   // mint
        Color(red: 0.36, green: 0.66, blue: 0.95),   // sky
        Color(red: 0.66, green: 0.55, blue: 0.93),   // lavender
        Color(red: 0.98, green: 0.60, blue: 0.38),   // tangerine
    ]

    /// Stable per-video colour (derived from the UUID bytes, not `hashValue`,
    /// which changes between launches).
    static func frame(for item: VideoItem) -> Color {
        frames[Int(item.id.uuid.0) % frames.count]
    }

    static var background: some View {
        ZStack {
            LinearGradient(colors: [backgroundTop, backgroundBottom], startPoint: .top, endPoint: .bottom)
            Circle()
                .fill(Color.white.opacity(0.35))
                .frame(width: 420, height: 420)
                .blur(radius: 40)
                .offset(x: -160, y: -260)
            Circle()
                .fill(frames[1].opacity(0.18))
                .frame(width: 360, height: 360)
                .blur(radius: 50)
                .offset(x: 180, y: 320)
        }
        .ignoresSafeArea()
    }

    static let titleFont = Font.system(size: 34, weight: .heavy, design: .rounded)
    static let tileFont = Font.system(.title3, design: .rounded).weight(.bold)
}
