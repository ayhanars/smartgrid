import Foundation
import Observation

/// Top-level application state: which mode the app is in and the services the
/// screens share (FR-03, FR-04).
@MainActor
@Observable
final class AppModel {
    enum Mode: Equatable {
        /// Default. The child browses and watches; nothing is editable.
        case child
        /// The parent gesture fired; waiting for PIN or biometrics.
        case parentVerification
        /// Verified parent managing the library.
        case parent
    }

    private(set) var mode: Mode = .child

    let library: LibraryStore
    let pin: PINManager
    let settings: AppSettings
    let importer: VideoImporter

    init(library: LibraryStore, pin: PINManager, settings: AppSettings) {
        self.library = library
        self.pin = pin
        self.settings = settings
        self.importer = VideoImporter(paths: library.paths, media: library.media)
    }

    static func live() -> AppModel {
        let paths = (try? AppPaths.default()) ?? AppPaths.temporary()
        let library = LibraryStore(paths: paths)
        library.load()
        return AppModel(library: library, pin: PINManager(), settings: AppSettings())
    }

    /// First launch: a PIN must exist before child mode can be left.
    var needsPINSetup: Bool { !pin.isPINSet }

    func requestParentAccess() {
        guard mode == .child else { return }
        mode = .parentVerification
    }

    func cancelParentAccess() {
        guard mode == .parentVerification else { return }
        mode = .child
    }

    func parentVerified() {
        mode = .parent
    }

    func returnToChildMode() {
        mode = .child
        library.refreshAvailability()
    }

    func completeOnboarding() {
        settings.hasCompletedOnboarding = true
        mode = .parent
    }
}
