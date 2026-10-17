import SwiftUI

/// First launch. A parent PIN must exist before the app can ever leave child
/// mode, so this runs once, before anything else.
struct OnboardingView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 14) {
                        IconBadge(systemImage: "play.tv.fill", size: 88)
                        Text("Welcome to\nLittleScreen")
                            .font(.system(size: 38, weight: .heavy, design: .rounded))
                        Text("A video player for little ones. You choose the videos; your child just taps a picture and watches.")
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 12)

                    VStack(spacing: 12) {
                        OnboardingPoint(
                            icon: "square.and.arrow.down",
                            colors: [ChildTheme.frames[3], ChildTheme.frames[4]],
                            title: "Import videos from Files",
                            text: "MP4 and MOV files are copied into the app and play with no internet at all."
                        )
                        OnboardingPoint(
                            icon: "hand.raised.fill",
                            colors: [ChildTheme.frames[2], ChildTheme.frames[3]],
                            title: "Child mode is locked down",
                            text: "No seeking, no skipping, no autoplay, no recommendations, no links."
                        )
                        OnboardingPoint(
                            icon: "hand.tap.fill",
                            colors: [ChildTheme.frames[1], ChildTheme.frames[5]],
                            title: "Parents: hold three fingers",
                            text: "\(ParentGesture.description), then enter your PIN to manage the library."
                        )
                        OnboardingPoint(
                            icon: "lock.shield.fill",
                            colors: [ChildTheme.frames[0], ChildTheme.frames[4]],
                            title: "Guided Access for a hard lock",
                            text: "iOS always lets a child swipe to the Home Screen. Turn on Guided Access when you need the phone pinned to this app."
                        )
                    }

                    NavigationLink {
                        PINSetupView(title: "Choose a parent PIN") { app.completeOnboarding() }
                    } label: {
                        Label("Create parent PIN", systemImage: "key.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding(.top, 8)
                }
                .padding(24)
            }
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
        }
    }
}

private struct OnboardingPoint: View {
    let icon: String
    let colors: [Color]
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            IconBadge(systemImage: icon, size: 44, colors: colors)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                Text(text).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }
}
