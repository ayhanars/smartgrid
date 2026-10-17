import SwiftUI

/// Enter a new PIN twice. Used at first launch and from Settings.
struct PINSetupView: View {
    var title = "Choose a new PIN"
    var onComplete: () -> Void

    @Environment(AppModel.self) private var app
    @State private var step: Step = .enter
    @State private var firstEntry = ""
    @State private var entry = ""
    @State private var message: String?

    private enum Step { case enter, confirm }

    var body: some View {
        VStack(spacing: 20) {
            PINPadView(
                title: step == .enter ? title : "Enter it once more",
                subtitle: step == .enter
                    ? "\(PINManager.minLength) to \(PINManager.maxLength) digits. Pick something your child won't see you type."
                    : nil,
                entry: $entry,
                submitLabel: step == .enter ? "Next" : "Save PIN",
                onSubmit: handle
            )
            Text(message ?? " ")
                .font(.footnote)
                .foregroundStyle(.red)
                .multilineTextAlignment(.center)
        }
        .padding()
        .navigationTitle("Parent PIN")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func handle(_ pin: String) {
        switch step {
        case .enter:
            guard PINManager.isValidPIN(pin) else {
                message = "Use \(PINManager.minLength) to \(PINManager.maxLength) digits."
                return
            }
            firstEntry = pin
            entry = ""
            message = nil
            step = .confirm
        case .confirm:
            guard pin == firstEntry else {
                message = "Those didn't match. Start again."
                firstEntry = ""
                entry = ""
                step = .enter
                return
            }
            do {
                try app.pin.setPIN(pin)
                onComplete()
            } catch {
                message = error.localizedDescription
            }
        }
    }
}

/// Settings wrapper that pops itself after the PIN is saved.
struct ChangePINView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        PINSetupView { dismiss() }
    }
}
