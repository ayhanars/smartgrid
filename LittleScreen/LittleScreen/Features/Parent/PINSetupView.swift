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
    @State private var shakes = 0

    private enum Step { case enter, confirm }

    var body: some View {
        VStack(spacing: 20) {
            IconBadge(systemImage: "key.fill", size: 64)
                .padding(.top, 8)
            PINPadView(
                title: step == .enter ? title : "Enter it once more",
                subtitle: step == .enter
                    ? "\(PINManager.minLength) to \(PINManager.maxLength) digits. Pick something your child won't see you type."
                    : nil,
                entry: $entry,
                submitLabel: step == .enter ? "Next" : "Save PIN",
                shakeTrigger: shakes,
                onSubmit: handle
            )
            Text(message ?? " ")
                .font(.footnote.weight(.medium))
                .foregroundStyle(.red)
                .multilineTextAlignment(.center)
            Spacer(minLength: 0)
        }
        .padding()
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle("Parent PIN")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func handle(_ pin: String) {
        switch step {
        case .enter:
            guard PINManager.isValidPIN(pin) else {
                shakes += 1
                message = "Use \(PINManager.minLength) to \(PINManager.maxLength) digits."
                return
            }
            firstEntry = pin
            entry = ""
            message = nil
            step = .confirm
        case .confirm:
            guard pin == firstEntry else {
                shakes += 1
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
