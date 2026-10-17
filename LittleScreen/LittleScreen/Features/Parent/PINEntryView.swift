import SwiftUI
import UIKit

/// Parent verification after the gesture (FR-04). Cancels itself back to child
/// mode if nobody types for a while, so an accidental trigger is harmless.
struct PINEntryView: View {
    @Environment(AppModel.self) private var app
    @State private var entry = ""
    @State private var message: String?
    @State private var shakes = 0
    @State private var idleTask: Task<Void, Never>?
    @State private var biometricAttempted = false

    private let idleTimeout: Double = 45

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = app.pin.remainingLock(at: context.date)
            ScrollView {
                VStack(spacing: 22) {
                    IconBadge(systemImage: "lock.fill", size: 72)
                        .padding(.top, 28)

                    PINPadView(
                        title: "Parents only",
                        subtitle: "Enter your PIN to manage videos.",
                        entry: $entry,
                        isDisabled: remaining != nil,
                        shakeTrigger: shakes,
                        onSubmit: submit
                    )

                    Group {
                        if let remaining {
                            Label("Too many wrong tries. Try again in \(Int(remaining.rounded(.up))) s.", systemImage: "hourglass")
                                .foregroundStyle(.red)
                        } else if let message {
                            Text(message).foregroundStyle(.red)
                        } else {
                            Text(" ")
                        }
                    }
                    .font(AppFont.parent(13, .semibold, relativeTo: .footnote))
                    .multilineTextAlignment(.center)
                    .frame(minHeight: 20)

                    if app.settings.biometricUnlockEnabled, let name = BiometricAuth.displayName, remaining == nil {
                        Button {
                            Task { await tryBiometrics(name: name) }
                        } label: {
                            Label("Use \(name)", systemImage: name == "Touch ID" ? "touchid" : "faceid")
                                .font(AppFont.parent(16, .bold))
                        }
                        .buttonStyle(.bordered)
                        .tint(ParentTheme.accent)
                        .controlSize(.large)
                    }

                    Button("Cancel") { app.cancelParentAccess() }
                        .font(AppFont.parent(17, .semibold))
                        .foregroundStyle(ParentTheme.secondaryText)
                        .padding(.vertical, 10)
                        .padding(.bottom, 24)
                }
                .padding(.horizontal)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(ParentTheme.ground.ignoresSafeArea())
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
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            app.parentVerified()
        case .wrong(let remaining):
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            shakes += 1
            entry = ""
            message = remaining == 1
                ? "Wrong PIN. One more try before a pause."
                : "Wrong PIN. \(remaining) tries left before a pause."
        case .locked:
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            shakes += 1
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
