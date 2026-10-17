import SwiftUI

/// First launch. A parent PIN must exist before the app can ever leave child
/// mode, so this runs once, before anything else.
struct OnboardingView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "play.rectangle.on.rectangle.fill")
                            .font(.system(size: 48))
                            .foregroundStyle(Color.accentColor)
                        Text("Welcome to LittleScreen")
                            .font(.largeTitle.bold())
                        Text("A video player for little ones. You choose the videos; your child just taps a picture and watches.")
                            .foregroundStyle(.secondary)
                    }

                    OnboardingPoint(
                        icon: "square.and.arrow.down",
                        title: "Import videos from Files",
                        text: "MP4 and MOV files are copied into the app and play with no internet at all."
                    )
                    OnboardingPoint(
                        icon: "hand.raised.fill",
                        title: "Child mode is locked down",
                        text: "No seeking, no skipping, no autoplay, no recommendations, no links."
                    )
                    OnboardingPoint(
                        icon: "hand.tap.fill",
                        title: "Parents: hold three fingers",
                        text: "\(ParentGesture.description), then enter your PIN to manage the library."
                    )
                    OnboardingPoint(
                        icon: "lock.shield",
                        title: "Guided Access for a hard lock",
                        text: "iOS always lets a child swipe to the Home Screen. Turn on Guided Access in Settings when you need the phone pinned to this app."
                    )

                    NavigationLink {
                        PINSetupView(title: "Choose a parent PIN") { app.completeOnboarding() }
                    } label: {
                        Text("Create parent PIN")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
                .padding(24)
            }
        }
    }
}

private struct OnboardingPoint: View {
    let icon: String
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(Color.accentColor)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(text).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}
