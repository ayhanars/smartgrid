import SwiftUI
import UIKit

/// The deliberate parent gesture (FR-04): hold three fingers on the screen.
/// Tuned so a toddler's palm or a two-finger grab does not fire it, and so it
/// cannot be confused with the single-finger holds used elsewhere in the app.
enum ParentGesture {
    static let fingers = 3
    static let holdDuration: TimeInterval = 1.0
    static let description = "Hold \(fingers) fingers on the screen for about a second"
}

/// Installs a window-level `UILongPressGestureRecognizer` so the gesture works
/// on every screen without stealing ordinary taps. SwiftUI has no multi-touch
/// gesture API, hence the UIKit bridge.
struct ParentGestureRecognizer: UIViewRepresentable {
    var onTrigger: () -> Void

    func makeUIView(context: Context) -> ParentGestureHostView {
        let view = ParentGestureHostView()
        view.onTrigger = onTrigger
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ uiView: ParentGestureHostView, context: Context) {
        uiView.onTrigger = onTrigger
    }
}

final class ParentGestureHostView: UIView, UIGestureRecognizerDelegate {
    var onTrigger: (() -> Void)?
    private var recognizer: UILongPressGestureRecognizer?
    private weak var attachedWindow: UIWindow?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        detach()
        guard let window else { return }
        let recognizer = UILongPressGestureRecognizer(target: self, action: #selector(handle(_:)))
        recognizer.numberOfTouchesRequired = ParentGesture.fingers
        recognizer.minimumPressDuration = ParentGesture.holdDuration
        recognizer.allowableMovement = 40
        recognizer.cancelsTouchesInView = false
        recognizer.delaysTouchesBegan = false
        recognizer.delaysTouchesEnded = false
        recognizer.delegate = self
        window.addGestureRecognizer(recognizer)
        self.recognizer = recognizer
        attachedWindow = window
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        nil // never intercept touches meant for the content underneath
    }

    private func detach() {
        if let recognizer, let attachedWindow {
            attachedWindow.removeGestureRecognizer(recognizer)
        }
        recognizer = nil
        attachedWindow = nil
    }

    @objc private func handle(_ recognizer: UILongPressGestureRecognizer) {
        guard recognizer.state == .began else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        onTrigger?()
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
    }
}
