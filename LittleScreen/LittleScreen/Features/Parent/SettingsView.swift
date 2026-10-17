import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var settings = app.settings
        Form {
            Section {
                Toggle(isOn: $settings.showTitlesInChildMode) {
                    Label("Show video titles", systemImage: "textformat")
                }
                Picker(selection: $settings.endOfVideoBehavior) {
                    ForEach(AppSettings.EndOfVideoBehavior.allCases) { behavior in
                        Text(behavior.label).tag(behavior)
                    }
                } label: {
                    Label("When a video ends", systemImage: "flag.checkered")
                }
                Toggle(isOn: $settings.allowLongPressExit) {
                    Label("Hold to leave a video", systemImage: "hand.tap")
                }
            } header: {
                Text("Child mode")
            } footer: {
                Text("With “Hold to leave” on, pressing one finger on the video for a couple of seconds shows a single Back button. With it off, a video can only be left when it ends or with the parent gesture. The next video never starts on its own.")
            }

            Section {
                NavigationLink { ChangePINView() } label: { Label("Change PIN", systemImage: "key.fill") }
                if let name = BiometricAuth.displayName {
                    Toggle(isOn: $settings.biometricUnlockEnabled) {
                        Label("Unlock with \(name)", systemImage: name == "Touch ID" ? "touchid" : "faceid")
                    }
                }
                LabeledContent("Parent gesture", value: ParentGesture.description)
            } header: {
                Text("Parent access")
            } footer: {
                Text("The gesture only opens this PIN screen; it never unlocks anything by itself. If nothing is typed for a while the app returns to child mode.")
            }

            Section("Device protection") {
                NavigationLink {
                    GuidedAccessHelpView()
                } label: {
                    Label("Guided Access and what the app can't block", systemImage: "lock.shield")
                }
            }

            Section("Storage") {
                StorageCard()
                LabeledContent("Library location", value: "On this iPhone only")
            }

            Section("About") {
                LabeledContent("Version", value: Bundle.main.appVersionDescription)
                LabeledContent("Tracking & ads", value: "None")
            }
        }
        .navigationTitle("Settings")
    }
}

/// Honest documentation of the iOS limits and how to close the gap (FR-04, §7).
struct GuidedAccessHelpView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("What LittleScreen controls")
                    .font(.title2.bold())
                Text("Inside the app, child mode has no seeking, no skipping, no autoplay, no recommendations, no links and no way into the parent area without your PIN.")

                Text("What no app can control")
                    .font(.title2.bold())
                Text("iOS always lets anyone swipe up to the Home Screen, open Control Center or Notification Center, press the side button, or answer a call. LittleScreen cannot and does not claim to prevent that.")

                Text("Guided Access closes that gap")
                    .font(.title2.bold())
                Text("Guided Access is Apple's built-in way to pin the iPhone to one app and ignore the Home gesture and hardware buttons until a passcode is entered.")

                VStack(alignment: .leading, spacing: 12) {
                    step(1, "Open the iPhone Settings app, then Accessibility → Guided Access, and turn it on.")
                    step(2, "Tap Passcode Settings and set a Guided Access passcode (Face ID can be allowed too).")
                    step(3, "Open LittleScreen in child mode.")
                    step(4, "Triple-click the side button (or Home button), then tap Start.")
                    step(5, "To finish, triple-click again and enter the Guided Access passcode.")
                }
                .padding()
                .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemBackground)))

                Text("Tip: in Guided Access options you can also disable the volume buttons and set a time limit. Guided Access settings live in iOS, not in this app, and may differ between iOS versions.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding()
        }
        .navigationTitle("Device protection")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.headline)
                .frame(width: 28, height: 28)
                .background(Circle().fill(Color.accentColor))
                .foregroundStyle(.white)
            Text(text)
        }
    }
}
