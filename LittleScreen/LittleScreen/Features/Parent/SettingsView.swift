import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var settings = app.settings
        @Bindable var usage = app.usage
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
                Toggle(isOn: $settings.showSkipButton) {
                    Label("Hold-to-skip circle", systemImage: "forward.end.circle")
                }
            } header: {
                Text("Child mode")
            } footer: {
                Text(childModeFooter)
            }

            Section {
                Picker(selection: $usage.limitMinutes) {
                    ForEach(UsageTracker.limitChoices, id: \.self) { minutes in
                        Text(UsageTracker.formatMinutes(minutes)).tag(minutes)
                    }
                } label: {
                    Label("Watching limit per day", systemImage: "hourglass")
                }
                if app.usage.isLimitEnabled {
                    LabeledContent {
                        Text(watchedTodayText)
                            .monospacedDigit()
                    } label: {
                        Label("Watched today", systemImage: "clock")
                    }
                    Button {
                        app.usage.addBonus()
                    } label: {
                        Label("Add \(UsageTracker.bonusMinutes) minutes for today", systemImage: "plus.circle")
                    }
                    Button(role: .destructive) {
                        app.usage.resetToday()
                    } label: {
                        Label("Reset today's time", systemImage: "arrow.counterclockwise")
                    }
                }
            } header: {
                Text("Daily limit")
            } footer: {
                Text("Counts only the time a video is actually playing. When the limit is reached, the child sees an “All done for today” screen and nothing plays until tomorrow. Extra minutes apply to today only. The day resets at midnight.")
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
                Text("The gesture only opens the PIN screen; it never unlocks anything by itself. If nothing is typed for a while the app returns to child mode.")
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
        .font(AppFont.parent(17))
        .scrollContentBackground(.hidden)
        .background(ParentTheme.ground)
        .tint(ParentTheme.accent)
        .navigationTitle("Settings")
    }

    private var childModeFooter: String {
        var text = "“Hold to leave”: pressing one finger on the video for a couple of seconds shows a single Back button. “Hold-to-skip circle”: a small circle in the corner jumps to the next video when held for about a second and a half; taps do nothing."
        if app.settings.endOfVideoBehavior.isAutomatic {
            text += " Automatic replay or next-video is your choice here; it stops when the daily limit is reached."
        } else {
            text += " The next video never starts on its own."
        }
        return text
    }

    private var watchedTodayText: String {
        let watched = app.usage.minutesWatchedToday
        let allowed = app.usage.allowedSecondsToday / 60
        return "\(watched) of \(allowed) min"
    }
}

/// Honest documentation of the iOS limits and how to close the gap (FR-04, §7).
struct GuidedAccessHelpView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("What LittleScreen controls")
                    .font(AppFont.parent(22, .extrabold, relativeTo: .title2))
                Text("Inside the app, child mode has no seeking, no skipping, no autoplay unless you turn it on, no recommendations, no links and no way into the parent area without your PIN.")

                Text("What no app can control")
                    .font(AppFont.parent(22, .extrabold, relativeTo: .title2))
                Text("iOS always lets anyone swipe up to the Home Screen, open Control Center or Notification Center, press the side button, or answer a call. LittleScreen cannot and does not claim to prevent that.")

                Text("Guided Access closes that gap")
                    .font(AppFont.parent(22, .extrabold, relativeTo: .title2))
                Text("Guided Access is Apple's built-in way to pin the iPhone to one app and ignore the Home gesture and hardware buttons until a passcode is entered.")

                VStack(alignment: .leading, spacing: 12) {
                    step(1, "Open the iPhone Settings app, then Accessibility → Guided Access, and turn it on.")
                    step(2, "Tap Passcode Settings and set a Guided Access passcode (Face ID can be allowed too).")
                    step(3, "Open LittleScreen in child mode.")
                    step(4, "Triple-click the side button (or Home button), then tap Start.")
                    step(5, "To finish, triple-click again and enter the Guided Access passcode.")
                }
                .padding()
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(ParentTheme.card))

                Text("Tip: in Guided Access options you can also disable the volume buttons and set a time limit. Guided Access settings live in iOS, not in this app, and may differ between iOS versions.")
                    .font(AppFont.parent(13, .regular, relativeTo: .footnote))
                    .foregroundStyle(ParentTheme.secondaryText)
            }
            .font(AppFont.parent(16))
            .padding()
        }
        .background(ParentTheme.ground.ignoresSafeArea())
        .navigationTitle("Device protection")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(AppFont.parent(15, .extrabold, relativeTo: .headline))
                .frame(width: 28, height: 28)
                .background(Circle().fill(ParentTheme.accent))
                .foregroundStyle(.white)
            Text(text)
        }
    }
}
