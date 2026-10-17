import SwiftUI

/// Parent verification after the gesture (FR-04). Cancels itself back to child
/// mode if nobody types for a while, so an accidental trigger is harmless.
struct PINEntryView: View {
    @Environment(AppModel.self) private var app
    @State private var entry = ""
    @State private var message: String?
    @State private var idleTask: Task<Void, Never>?
    @State private var biometricAttempted = false

    private let idleTimeout: Double = 45

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = app.pin.remainingLock(at: context.date)
            VStack(spacing: 20) {
                Spacer(minLength: 0)
                PINPadView(
                    title: "Parents only",
                    subtitle: "Enter your PIN to manage videos.",
                    entry: $entry,
                    isDisabled: remaining != nil,
                    onSubmit: submit
                )

                Group {
                    if let remaining {
                        Text("Too many wrong tries. Try again in \(Int(remaining.rounded(.up))) s.")
                            .foregroundStyle(.red)
                    } else if let message {
                        Text(message).foregroundStyle(.red)
                    } else {
                        Text(" ")
                    }
                }
                .font(.footnote)
                .multilineTextAlignment(.center)

                if app.settings.biometricUnlockEnabled, let name = BiometricAuth.displayName, remaining == nil {
                    Button {
                        Task { await tryBiometrics(name: name) }
                    } label: {
                        Label("Use \(name)", systemImage: name == "Touch ID" ? "touchid" : "faceid")
                    }
                }

                Button("Cancel", role: .cancel) { app.cancelParentAccess() }
                    .controlSize(.large)
                Spacer(minLength: 0)
            }
            .padding()
        }
        .onAppear { restartIdleTimer() }
        .onDisappear { idleTask?.cancel() }
        .onChange(of: entry) { _, _ in restartIdleTimer() }
        .task {
            guard app.settings.biometricUnlockEnabled, !biometricAttempted,
                  let name = BiometricAuth.displayName, app.pin.remainingLock() == nil else { return }
            biometricAttempted = true
            await tryBiometrics(name: name)
        }
    }

    private func submit(_ pin: String) {
        switch app.pin.verify(pin) {
        case .success, .notSet:
            app.parentVerified()
        case .wrong(let remaining):
            entry = ""
            message = remaining == 1
                ? "Wrong PIN. One more try before a pause."
                : "Wrong PIN. \(remaining) tries left before a pause."
        case .locked:
            entry = ""
            message = nil
        }
    }

    private func tryBiometrics(name: String) async {
        let ok = await BiometricAuth.authenticate(reason: "Open the LittleScreen parent area")
        if ok {
            app.parentVerified()
        } else {
            message = "\(name) didn't work. Enter your PIN instead."
            restartIdleTimer()
        }
    }

    private func restartIdleTimer() {
        idleTask?.cancel()
        idleTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(idleTimeout))
            guard !Task.isCancelled else { return }
            app.cancelParentAccess()
        }
    }
}
