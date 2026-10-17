import SwiftUI
import UIKit

@main
struct LittleScreenApp: App {
    @State private var app = AppModel.live()

    init() {
        Self.configureNavigationBar()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
        }
    }

    /// Parent-area navigation bars use Nunito and the warm ground colour.
    private static func configureNavigationBar() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = ParentTheme.groundUIColor
        appearance.shadowColor = .clear
        appearance.largeTitleTextAttributes = [.font: AppFont.parentUIFont(32, .extrabold)]
        appearance.titleTextAttributes = [.font: AppFont.parentUIFont(17, .bold)]
        let bar = UINavigationBar.appearance()
        bar.standardAppearance = appearance
        bar.scrollEdgeAppearance = appearance
        bar.compactAppearance = appearance
    }
}
