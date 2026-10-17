import SwiftUI
import UIKit

/// Full-screen, control-free playback (FR-02).
///
/// There is no scrubber and no tap-to-show-controls. The only ways out are:
/// the video ends, a deliberate one-finger hold reveals a single Back button
/// (parent-configurable), a hold on the skip circle moves to the next video
/// (parent-configurable), the daily limit runs out, or the parent gesture.
struct ChildPlayerView: View {
    let item: VideoItem
    let url: URL
    let onExit: () -> Void
    let onSkip: () -> Void

    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @State private var controller: PlayerController
    @State private var exitVisible = false
    @State private var hideTask: Task<Void, Never>?
    @State private var countingUsage = false

    private let exitHoldDuration: Double = 1.5
    private let exitButtonTimeout: Double = 4

    init(item: VideoItem, url: URL, onExit: @escaping () -> Void, onSkip: @escaping () -> Void) {
        self.item = item
        self.url = url
        self.onExit = onExit
        self.onSkip = onSkip
        _controller = State(initialValue: PlayerController(url: url))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if case .failed = controller.state {
                ChildErrorView(onDone: onExit)
            } else {
                PlayerLayerView(player: controller.player)
                    .ignoresSafeArea()

                if controller.state == .loading {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(1.6)
                }

                // Touch shield: taps do nothing; a long hold may reveal Back.
                Color.clear
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .onTapGesture { /* intentionally inert */ }
                    .onLongPressGesture(minimumDuration: exitHoldDuration) {
                        if app.settings.allowLongPressExit { revealExitButton() }
                    }

                if exitVisible {
                    exitButton
                        .transition(.opacity)
                }

                if app.settings.showSkipButton, controller.state != .finished, !app.usage.isLimitReached {
                    VStack {
                        Spacer()
                        HStack {
                            Spacer()
                            HoldToSkipButton(action: onSkip)
                                .padding(24)
                        }
                    }
                }

                if controller.state == .finished,
                   app.settings.endOfVideoBehavior == .completionScreen {
                    CompletionView(onDone: onExit)
                        .transition(.opacity)
                }

                if app.usage.isLimitReached {
                    TimeUpView(onDark: true, onBack: onExit)
                        .transition(.opacity)
                        .zIndex(3)
                }
            }
        }
        .onAppear {
            controller.start()
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear {
            hideTask?.cancel()
            controller.stop()
            stopCountingUsage()
            UIApplication.shared.isIdleTimerDisabled = false
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                controller.sceneDidBecomeActive()
            } else {
                controller.sceneWillResignActive()
            }
        }
        .onChange(of: controller.state) { _, state in
            syncUsageCounting(playing: state == .playing)
            if state == .finished { handleFinished() }
        }
        .onChange(of: app.usage.isLimitReached) { _, reached in
            if reached { controller.pause() }
        }
        .animation(.easeInOut(duration: 0.25), value: controller.state)
        .animation(.easeInOut(duration: 0.25), value: app.usage.isLimitReached)
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
    }

    private var exitButton: some View {
        VStack {
            Spacer()
            HStack {
                Button(action: onExit) {
                    HStack(spacing: 8) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 22, weight: .black))
                        Text("Back")
                            .font(AppFont.child(24, .bold))
                    }
                    .padding(.leading, 20)
                    .padding(.trailing, 26)
                    .frame(minHeight: 66)
                    .background(Capsule().fill(Color.white))
                    .foregroundStyle(ChildTheme.text)
                    .shadow(color: .black.opacity(0.35), radius: 10, y: 4)
                }
                .buttonStyle(TileButtonStyle())
                .padding(24)
                Spacer()
            }
        }
    }

    private func handleFinished() {
        guard !app.usage.isLimitReached else { return }
        switch app.settings.endOfVideoBehavior {
        case .completionScreen:
            break
        case .returnToLibrary:
            onExit()
        case .loopSame:
            controller.restart()
        case .playNext:
            onSkip()
        }
    }

    private func syncUsageCounting(playing: Bool) {
        guard playing != countingUsage else { return }
        countingUsage = playing
        if playing {
            app.usage.beginPlaying()
        } else {
            app.usage.endPlaying()
        }
    }

    private func stopCountingUsage() {
        if countingUsage {
            countingUsage = false
            app.usage.endPlaying()
        }
    }

    private func revealExitButton() {
        withAnimation { exitVisible = true }
        hideTask?.cancel()
        hideTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(exitButtonTimeout))
            guard !Task.isCancelled else { return }
            withAnimation { exitVisible = false }
        }
    }
}

/// A circle that does nothing when tapped and skips to the next video when
/// held: the ring fills while the finger stays down, so the child (and the
/// parent) can see it is a deliberate action.
struct HoldToSkipButton: View {
    let action: () -> Void
    @State private var pressing = false
    @State private var fired = false

    private let holdDuration: Double = 1.5
    private let size: CGFloat = 64

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.black.opacity(0.35))
            Circle()
                .strokeBorder(Color.white.opacity(0.5), lineWidth: 3)
            Circle()
                .trim(from: 0, to: pressing ? 1 : 0)
                .stroke(ChildTheme.sunflower, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(1.5)
                .animation(pressing ? .linear(duration: holdDuration) : .easeOut(duration: 0.2), value: pressing)
            Image(systemName: "forward.end.fill")
                .font(.system(size: 24, weight: .heavy))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .scaleEffect(pressing ? 1.1 : 1)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: pressing)
        .opacity(0.9)
        .contentShape(Circle())
        .onLongPressGesture(minimumDuration: holdDuration, maximumDistance: 40) {
            guard !fired else { return }
            fired = true
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            action()
        } onPressingChanged: { isPressing in
            pressing = isPressing
            if isPressing { fired = false }
        }
        .accessibilityLabel("Next video")
        .accessibilityHint("Hold for a moment to skip to the next video")
    }
}

struct CompletionView: View {
    let onDone: () -> Void
    @State private var appeared = false

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.black.opacity(0.25), Color.black.opacity(0.7)],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()
            VStack(spacing: 26) {
                HStack(alignment: .bottom, spacing: 18) {
                    ForEach(0..<3, id: \.self) { index in
                        Image(systemName: "star.fill")
                            .font(.system(size: index == 1 ? 92 : 64))
                            .foregroundStyle(ChildTheme.sunflower)
                            .shadow(color: ChildTheme.sunflower.opacity(0.6), radius: 16)
                            .scaleEffect(appeared ? 1 : 0.2)
                            .rotationEffect(.degrees(appeared ? 0 : -30))
                            .animation(
                                .spring(response: 0.55, dampingFraction: 0.55).delay(Double(index) * 0.12),
                                value: appeared
                            )
                    }
                }
                Text("All done!")
                    .font(AppFont.child(44, .bold))
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.35), radius: 6, y: 2)
                BigChildButton(title: "More videos", systemImage: "square.grid.2x2.fill", action: onDone)
            }
        }
        .onAppear { appeared = true }
    }
}

/// Child-safe failure screen: no technical detail, no links, one way out (FR-10).
struct ChildErrorView: View {
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            IconBadge(systemImage: "face.dashed", size: 110, colors: [ChildTheme.sky, ChildTheme.lavender])
            Text("Oops! This video can't play right now.")
                .font(AppFont.child(30, .bold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            BigChildButton(title: "Back", systemImage: "chevron.left", action: onDone)
        }
    }
}
