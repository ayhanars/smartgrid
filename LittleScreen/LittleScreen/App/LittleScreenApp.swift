import SwiftUI

@main
struct LittleScreenApp: App {
    @State private var app = AppModel.live()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
        }
    }
}
