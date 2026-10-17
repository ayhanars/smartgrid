import SwiftUI
import UIKit

/// Full-screen, control-free playback (FR-02).
///
/// There is no scrubber, no skip, no tap-to-show-controls. The only ways out
/// are: the video ends, a deliberate one-finger hold reveals a single Back
/// button (parent-configurable), or the parent gesture.
struct ChildPlayerView: View {
    let item: VideoItem
    let url: URL
    let onExit: () -> Void

    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @State private var controller: PlayerController
    @State private var exitVisible = false
    @State private var hideTask: Task<Void, Never>?

    private let exitHoldDuration: Double = 1.5
    private let exitButtonTimeout: Double = 4

    init(item: VideoItem, url: URL, onExit: @escaping () -> Void) {
        self.item = item
        self.url = url
        self.onExit = onExit
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

                if controller.state == .finished,
                   app.settings.endOfVideoBehavior == .completionScreen {
                    CompletionView(onDone: onExit)
                        .transition(.opacity)
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
            if state == .finished, app.settings.endOfVideoBehavior == .returnToLibrary {
                onExit()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: controller.state)
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
    }

    private var exitButton: some View {
        VStack {
            Spacer()
            HStack {
                Button(action: onExit) {
                    Label("Back", systemImage: "chevron.left")
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .padding(.horizontal, 24)
                        .frame(minHeight: 64)
                        .background(Capsule().fill(.white.opacity(0.9)))
                        .foregroundStyle(.black)
                }
                .buttonStyle(TileButtonStyle())
                .padding(24)
                Spacer()
            }
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

struct CompletionView: View {
    let onDone: () -> Void
    @State private var appeared = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(spacing: 28) {
                Image(systemName: "star.fill")
                    .font(.system(size: 96))
                    .foregroundStyle(.yellow)
                    .symbolEffect(.bounce, value: appeared)
                Text("All done!")
                    .font(.system(size: 40, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
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
            Image(systemName: "face.dashed")
                .font(.system(size: 80))
                .foregroundStyle(.white.opacity(0.9))
            Text("Oops! This video can't play right now.")
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            BigChildButton(title: "Back", systemImage: "chevron.left", action: onDone)
        }
    }
}
