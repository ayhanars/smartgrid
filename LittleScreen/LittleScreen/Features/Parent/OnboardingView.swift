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
                        IconBadge(systemImage: "play.tv.fill", size: 88, colors: [ChildTheme.tangerine, ChildTheme.coral])
                        Text("Welcome to\nLittleScreen")
                            .font(AppFont.parent(38, .extrabold, relativeTo: .largeTitle))
                        Text("A video player for little ones. You choose the videos; your child just taps a picture and watches.")
                            .font(AppFont.parent(17))
                            .foregroundStyle(ParentTheme.secondaryText)
                    }
                    .padding(.top, 12)

                    VStack(spacing: 12) {
                        OnboardingPoint(
                            icon: "square.and.arrow.down",
                            colors: [ChildTheme.sky, ChildTheme.lavender],
                            title: "Import videos from Files",
                            text: "MP4 and MOV files are copied into the app and play with no internet at all."
                        )
                        OnboardingPoint(
                            icon: "hand.raised.fill",
                            colors: [ChildTheme.mint, ChildTheme.sky],
                            title: "Child mode is locked down",
                            text: "No seeking, no skipping, no recommendations, no links. Autoplay only if you turn it on."
                        )
                        OnboardingPoint(
                            icon: "hand.tap.fill",
                            colors: [ChildTheme.sunflower, ChildTheme.tangerine],
                            title: "Parents: hold three fingers",
                            text: "\(ParentGesture.description), then enter your PIN to manage the library."
                        )
                        OnboardingPoint(
                            icon: "hourglass",
                            colors: [ChildTheme.lavender, ChildTheme.coral],
                            title: "Set a daily limit",
                            text: "Choose how long videos may play each day. The child gets a friendly “all done for today”."
                        )
                        OnboardingPoint(
                            icon: "lock.shield.fill",
                            colors: [ChildTheme.coral, ChildTheme.tangerine],
                            title: "Guided Access for a hard lock",
                            text: "iOS always lets a child swipe to the Home Screen. Turn on Guided Access when you need the phone pinned to this app."
                        )
                    }

                    NavigationLink {
                        PINSetupView(title: "Choose a parent PIN") { app.completeOnboarding() }
                    } label: {
                        Label("Create parent PIN", systemImage: "key.fill")
                    }
                    .buttonStyle(ParentPrimaryButtonStyle())
                    .padding(.top, 8)
                }
                .padding(24)
            }
            .background(ParentTheme.ground.ignoresSafeArea())
        }
        .tint(ParentTheme.accent)
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
                Text(title)
                    .font(AppFont.parent(16, .bold, relativeTo: .headline))
                Text(text)
                    .font(AppFont.parent(14, .regular, relativeTo: .subheadline))
                    .foregroundStyle(ParentTheme.secondaryText)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(ParentTheme.card)
        )
    }
}
