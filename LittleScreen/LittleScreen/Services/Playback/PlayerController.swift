import AVFoundation
import Foundation
import Observation

/// Owns the AVPlayer for one child playback session (FR-02).
///
/// The controller exposes a tiny state machine and no seeking API at all, so
/// the UI cannot accidentally grow scrubbing or skipping.
@MainActor
@Observable
final class PlayerController {
    enum State: Equatable {
        case loading
        case playing
        case paused
        case finished
        case failed(String)
    }

    private(set) var state: State = .loading
    /// Technical detail of the last failure, for the parent area / logs.
    private(set) var failureDetail: String?

    let player = AVPlayer()
    private let url: URL
    @ObservationIgnored private var statusObservation: NSKeyValueObservation?
    @ObservationIgnored private var notificationTokens: [NSObjectProtocol] = []
    @ObservationIgnored private var pausedByInterruption = false
    @ObservationIgnored private var pausedBySystem = false

    init(url: URL) {
        self.url = url
        player.allowsExternalPlayback = false
        player.actionAtItemEnd = .pause              // never roll into anything else
        player.preventsDisplaySleepDuringVideoPlayback = true
    }

    func start() {
        guard notificationTokens.isEmpty else { return }
        guard FileManager.default.fileExists(atPath: url.path) else {
            fail(detail: "Media file missing at \(url.lastPathComponent)")
            return
        }
        configureAudioSession()

        let item = AVPlayerItem(url: url)
        statusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            let status = item.status
            let detail = item.error?.localizedDescription
            Task { @MainActor in self?.handle(status: status, detail: detail) }
        }

        let center = NotificationCenter.default
        notificationTokens.append(center.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.finish() }
        })
        notificationTokens.append(center.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main
        ) { [weak self] note in
            let detail = (note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error)?.localizedDescription
            Task { @MainActor in self?.fail(detail: detail ?? "Playback failed before the end") }
        })
        notificationTokens.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(), queue: .main
        ) { [weak self] note in
            let typeValue = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt ?? 0
            let optionsValue = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            Task { @MainActor in self?.handleInterruption(typeValue: typeValue, optionsValue: optionsValue) }
        })

        player.replaceCurrentItem(with: item)
        player.play()
    }

    /// Tears everything down. Must be called when the player leaves the screen.
    func stop() {
        player.pause()
        player.replaceCurrentItem(with: nil)
        statusObservation = nil
        for token in notificationTokens {
            NotificationCenter.default.removeObserver(token)
        }
        notificationTokens = []
    }

    // MARK: Parent-configured and limit-driven control (never exposed to the child UI)

    func pause() {
        player.pause()
        if state == .playing { state = .paused }
    }

    /// Plays the same item again from the start (the "loop" end-of-video option).
    func restart() {
        player.seek(to: .zero)
        player.play()
        state = .playing
    }

    // MARK: App lifecycle

    func sceneWillResignActive() {
        guard state == .playing else { return }
        player.pause()
        state = .paused
        pausedBySystem = true
    }

    func sceneDidBecomeActive() {
        if pausedBySystem, state == .paused {
            player.play()
            state = .playing
        }
        pausedBySystem = false
    }

    // MARK: Internals

    private func handle(status: AVPlayerItem.Status, detail: String?) {
        switch status {
        case .readyToPlay:
            if state == .loading { state = .playing }
        case .failed:
            fail(detail: detail ?? "The player could not load this file")
        case .unknown:
            break
        @unknown default:
            break
        }
    }

    private func finish() {
        guard state != .finished else { return }
        player.pause()
        state = .finished
    }

    private func fail(detail: String) {
        player.pause()
        failureDetail = detail
        state = .failed(detail)
    }

    private func handleInterruption(typeValue: UInt, optionsValue: UInt) {
        guard let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
        switch type {
        case .began:
            if state == .playing {
                player.pause()
                state = .paused
                pausedByInterruption = true
            }
        case .ended:
            let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
            if pausedByInterruption, state == .paused, options.contains(.shouldResume) {
                player.play()
                state = .playing
            }
            pausedByInterruption = false
        @unknown default:
            break
        }
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback)
        try? session.setActive(true)
    }
}
