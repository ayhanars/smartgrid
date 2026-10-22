import AVFoundation
import Foundation
import RobovacCore

/// Plays short, procedurally generated sound effects. No audio assets are
/// shipped; every sound is synthesized once at first use and cached.
@MainActor
final class SoundManager {
    var settings: SoundSettings

    private let engine = AVAudioEngine()
    private var players: [AVAudioPlayerNode] = []
    private var nextPlayer = 0
    /// Dedicated looping player for the motor hum.
    private var motorPlayer: AVAudioPlayerNode?
    private var motorLevel: Double = 0
    private var motorTargetLevel: Double = 0
    private var motorRamp: Timer?
    private var cache: [SoundEvent: AVAudioPCMBuffer] = [:]
    private let sampleRate: Double = 44_100
    private lazy var format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
    private var started = false

    init(settings: SoundSettings) {
        self.settings = settings
    }

    func play(_ event: SoundEvent) {
        guard settings.isEnabled(event), settings.volume > 0 else { return }
        guard ensureStarted(), let buffer = buffer(for: event) else { return }
        let player = players[nextPlayer]
        nextPlayer = (nextPlayer + 1) % players.count
        player.volume = Float(settings.volume) * gain(for: event)
        player.scheduleBuffer(buffer, at: nil, options: [.interrupts], completionHandler: nil)
        if !player.isPlaying { player.play() }
    }

    func stopAll() {
        for player in players where player.isPlaying { player.stop() }
    }

    // MARK: Motor loop

    /// Sets how loud the continuous motor hum should be (0 = silent). The level
    /// is smoothed so speed changes sound like a motor spinning up and down.
    func setMotorLevel(_ level: Double) {
        let clamped = min(max(level, 0), 1)
        guard settings.enabled, settings.continuousMotorSound, settings.isEnabled(.movement), settings.volume > 0 else {
            if motorTargetLevel != 0 || motorLevel != 0 { stopMotor() }
            return
        }
        motorTargetLevel = clamped
        if clamped > 0 { startMotorIfNeeded() }
        if motorRamp == nil {
            let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in self?.rampMotor() }
            }
            RunLoop.main.add(timer, forMode: .common)
            motorRamp = timer
        }
    }

    private func startMotorIfNeeded() {
        guard ensureStarted() else { return }
        if motorPlayer == nil {
            let player = AVAudioPlayerNode()
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            motorPlayer = player
        }
        guard let player = motorPlayer, !player.isPlaying else { return }
        let samples = ProceduralSoundSynth(sampleRate: sampleRate).motorLoop(duration: 2.0)
        guard let buffer = makeBuffer(samples) else { return }
        player.volume = 0
        player.scheduleBuffer(buffer, at: nil, options: [.loops], completionHandler: nil)
        player.play()
    }

    private func rampMotor() {
        let step = 0.08
        if motorLevel < motorTargetLevel {
            motorLevel = min(motorTargetLevel, motorLevel + step)
        } else if motorLevel > motorTargetLevel {
            motorLevel = max(motorTargetLevel, motorLevel - step * 1.5)
        }
        motorPlayer?.volume = Float(settings.volume) * Float(motorLevel) * 0.8
        if motorLevel == 0, motorTargetLevel == 0 {
            stopMotor()
        }
    }

    private func stopMotor() {
        motorRamp?.invalidate()
        motorRamp = nil
        motorLevel = 0
        motorTargetLevel = 0
        motorPlayer?.stop()
    }

    /// Suction intensity changes the suction sample, so drop the cached one when it changes.
    func settingsDidChange(_ newSettings: SoundSettings) {
        if newSettings.suctionIntensity != settings.suctionIntensity {
            cache[.suction] = nil
        }
        settings = newSettings
    }

    // MARK: Engine

    private func ensureStarted() -> Bool {
        if started { return true }
        for _ in 0..<4 {
            let player = AVAudioPlayerNode()
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            players.append(player)
        }
        engine.mainMixerNode.outputVolume = 1
        do {
            try engine.start()
            started = true
        } catch {
            started = false
        }
        return started
    }

    private func gain(for event: SoundEvent) -> Float {
        switch event {
        case .movement: return 0.35
        case .turn: return 0.45
        case .suction: return Float(0.4 + 0.6 * settings.suctionIntensity)
        case .collect: return 0.8
        case .avoid: return 0.6
        case .start: return 0.7
        case .complete: return 0.8
        case .error: return 0.7
        }
    }

    private func buffer(for event: SoundEvent) -> AVAudioPCMBuffer? {
        if let cached = cache[event] { return cached }
        guard let buffer = makeBuffer(synthesize(event)) else { return nil }
        cache[event] = buffer
        return buffer
    }

    private func makeBuffer(_ samples: [Float]) -> AVAudioPCMBuffer? {
        guard !samples.isEmpty,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)) else { return nil }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        guard let channel = buffer.floatChannelData?[0] else { return nil }
        for (index, sample) in samples.enumerated() {
            channel[index] = sample
        }
        return buffer
    }

    // MARK: Synthesis

    private func synthesize(_ event: SoundEvent) -> [Float] {
        let synth = ProceduralSoundSynth(sampleRate: sampleRate)
        switch event {
        case .start:
            return synth.mix([
                synth.sweep(from: 320, to: 980, duration: 0.38, amplitude: 0.45, attack: 0.02, release: 0.12),
                synth.sweep(from: 180, to: 180, duration: 0.05, amplitude: 0.3, attack: 0.002, release: 0.03),
            ])
        case .movement:
            return synth.mix([
                synth.noise(duration: 0.14, amplitude: 0.18, cutoffStart: 400, cutoffEnd: 250, attack: 0.02, release: 0.08),
                synth.sweep(from: 110, to: 95, duration: 0.14, amplitude: 0.16, attack: 0.02, release: 0.08),
            ])
        case .suction:
            return synth.vacuumSuction(intensity: Float(settings.suctionIntensity))
        case .collect:
            return synth.mix([
                synth.sweep(from: 900, to: 260, duration: 0.07, amplitude: 0.5, attack: 0.002, release: 0.04),
                synth.delayed(synth.sweep(from: 1_320, to: 1_320, duration: 0.28, amplitude: 0.3, attack: 0.004, release: 0.22), by: 0.06),
            ])
        case .turn:
            return synth.sweep(from: 640, to: 440, duration: 0.1, amplitude: 0.3, attack: 0.005, release: 0.05)
        case .avoid:
            return synth.mix([
                synth.sweep(from: 520, to: 520, duration: 0.09, amplitude: 0.35, attack: 0.005, release: 0.04),
                synth.delayed(synth.sweep(from: 400, to: 400, duration: 0.12, amplitude: 0.35, attack: 0.005, release: 0.06), by: 0.11),
            ])
        case .complete:
            let notes: [Double] = [523.25, 659.25, 783.99, 1_046.5]
            var layers: [[Float]] = []
            for (index, note) in notes.enumerated() {
                let tone = synth.sweep(from: note, to: note, duration: 0.32, amplitude: 0.32, attack: 0.005, release: 0.22)
                layers.append(synth.delayed(tone, by: Double(index) * 0.11))
            }
            return synth.mix(layers)
        case .error:
            return synth.mix([
                synth.sweep(from: 190, to: 170, duration: 0.26, amplitude: 0.35, attack: 0.005, release: 0.08),
                synth.sweep(from: 570, to: 510, duration: 0.26, amplitude: 0.12, attack: 0.005, release: 0.08),
            ])
        }
    }
}

/// Small additive synthesizer used to build the effects.
struct ProceduralSoundSynth {
    let sampleRate: Double

    func sweep(from startHz: Double, to endHz: Double, duration: Double, amplitude: Float, attack: Double, release: Double) -> [Float] {
        let count = Int(duration * sampleRate)
        guard count > 0 else { return [] }
        var samples = [Float](repeating: 0, count: count)
        var phase = 0.0
        for i in 0..<count {
            let t = Double(i) / sampleRate
            let progress = t / duration
            let frequency = startHz + (endHz - startHz) * progress
            phase += 2 * Double.pi * frequency / sampleRate
            let envelope = envelopeValue(t: t, duration: duration, attack: attack, release: release)
            samples[i] = Float(sin(phase)) * amplitude * envelope
        }
        return samples
    }

    /// White noise through a one-pole low-pass filter whose cutoff sweeps over time.
    func noise(duration: Double, amplitude: Float, cutoffStart: Double, cutoffEnd: Double, attack: Double, release: Double) -> [Float] {
        let count = Int(duration * sampleRate)
        guard count > 0 else { return [] }
        var samples = [Float](repeating: 0, count: count)
        var generator = SplitMix64(seed: 0x5EED_0BEE)
        var filtered: Float = 0
        for i in 0..<count {
            let t = Double(i) / sampleRate
            let progress = t / duration
            let cutoff = cutoffStart + (cutoffEnd - cutoffStart) * progress
            let alpha = Float(1 - exp(-2 * Double.pi * cutoff / sampleRate))
            let white = Float(generator.nextUnit() * 2 - 1)
            filtered += alpha * (white - filtered)
            let envelope = envelopeValue(t: t, duration: duration, attack: attack, release: release)
            samples[i] = filtered * amplitude * envelope
        }
        return samples
    }

    /// A seamless motor hum: a low fundamental with harmonics and a soft rumble.
    /// Frequencies are integer multiples of 1/duration so the loop point is silent.
    func motorLoop(duration: Double) -> [Float] {
        let count = Int(duration * sampleRate)
        guard count > 0 else { return [] }
        // Generate a little extra and crossfade it into the head so the noise
        // component loops without a click; the tones are periodic over `duration`.
        let fade = min(count / 8, Int(0.12 * sampleRate))
        let total = count + fade
        let base = (92.0 * duration).rounded() / duration
        var samples = [Float](repeating: 0, count: total)
        var generator = SplitMix64(seed: 0xA11CE)
        var rumble: Float = 0
        var hiss: Float = 0
        let rumbleAlpha = Float(1 - exp(-2 * Double.pi * 180 / sampleRate))
        let hissAlpha = Float(1 - exp(-2 * Double.pi * 900 / sampleRate))
        for i in 0..<total {
            let t = Double(i) / sampleRate
            let wobble = 1 + 0.015 * sin(2 * Double.pi * t / duration)
            let phase = 2 * Double.pi * base * wobble * t
            var value = sin(phase) * 0.22 + sin(phase * 2) * 0.12 + sin(phase * 3) * 0.06 + sin(phase * 5.5) * 0.03
            let white = Float(generator.nextUnit() * 2 - 1)
            rumble += rumbleAlpha * (white - rumble)
            hiss += hissAlpha * (white - hiss)
            value += Double(rumble) * 0.5 + Double(hiss - rumble) * 0.08
            samples[i] = Float(value)
        }
        for i in 0..<fade {
            let mix = Float(i) / Float(fade)
            samples[i] = samples[i] * mix + samples[count + i] * (1 - mix)
        }
        return Array(samples.prefix(count))
    }

    /// A vacuum gulping a file: turbine spinning up, air rush, rattle of the item
    /// going in, then a thump as it lands. About 1.4 seconds.
    func vacuumSuction(intensity: Float) -> [Float] {
        let duration = 1.4
        let count = Int(duration * sampleRate)
        var generator = SplitMix64(seed: 0x5AC7_10B)
        let strength = 0.6 + 0.4 * intensity

        // Air rush: band-passed noise whose band climbs as the suction builds.
        var rush = [Float](repeating: 0, count: count)
        var low: Float = 0
        var high: Float = 0
        for i in 0..<count {
            let t = Double(i) / sampleRate
            let progress = t / duration
            let envelope: Double = progress < 0.25 ? progress / 0.25 : (progress > 0.8 ? max(0, (1 - progress) / 0.2) : 1)
            let cutoffHigh = 700 + 2_800 * min(1, progress * 1.4)
            let cutoffLow = 180 + 300 * progress
            let alphaHigh = Float(1 - exp(-2 * Double.pi * cutoffHigh / sampleRate))
            let alphaLow = Float(1 - exp(-2 * Double.pi * cutoffLow / sampleRate))
            let white = Float(generator.nextUnit() * 2 - 1)
            high += alphaHigh * (white - high)
            low += alphaLow * (white - low)
            rush[i] = (high - low) * Float(envelope) * 0.5 * strength
        }

        // Turbine: a whine that spins up, with harmonics and a little vibrato.
        var turbine = [Float](repeating: 0, count: count)
        var phase = 0.0
        for i in 0..<count {
            let t = Double(i) / sampleRate
            let progress = t / duration
            let spin = 1 - pow(1 - min(1, progress / 0.7), 2)
            let frequency = 160 + 760 * spin + 12 * sin(2 * Double.pi * 7 * t)
            phase += 2 * Double.pi * frequency / sampleRate
            let envelope: Double = progress < 0.15 ? progress / 0.15 : (progress > 0.75 ? max(0, (1 - progress) / 0.25) : 1)
            let value = sin(phase) * 0.5 + sin(phase * 2) * 0.25 + sin(phase * 3) * 0.12 + sin(phase * 4.01) * 0.06
            turbine[i] = Float(value * envelope) * 0.24 * strength
        }

        // Rattle: short clicks while the item tumbles into the intake.
        var rattle = [Float](repeating: 0, count: count)
        let clickCount = 7 + Int(generator.nextUnit() * 5)
        for _ in 0..<clickCount {
            let start = Int((0.45 + generator.nextUnit() * 0.5) * sampleRate)
            let length = Int((0.006 + generator.nextUnit() * 0.012) * sampleRate)
            let amplitude = Float(0.25 + generator.nextUnit() * 0.35)
            for j in 0..<length where start + j < count {
                let fade = 1 - Float(j) / Float(length)
                rattle[start + j] += Float(generator.nextUnit() * 2 - 1) * amplitude * fade
            }
        }

        // Thump: a low hit as the file lands inside, near the end.
        let thump = delayed(mix([
            sweep(from: 140, to: 60, duration: 0.22, amplitude: 0.7, attack: 0.002, release: 0.16),
            noise(duration: 0.05, amplitude: 0.35, cutoffStart: 1_200, cutoffEnd: 300, attack: 0.001, release: 0.04),
        ]), by: 1.08)

        return mix([rush, turbine, rattle, thump])
    }

    func delayed(_ samples: [Float], by seconds: Double) -> [Float] {
        let padding = [Float](repeating: 0, count: Int(seconds * sampleRate))
        return padding + samples
    }

    func mix(_ layers: [[Float]]) -> [Float] {
        let length = layers.map { $0.count }.max() ?? 0
        var result = [Float](repeating: 0, count: length)
        for layer in layers {
            for (index, sample) in layer.enumerated() {
                result[index] += sample
            }
        }
        // Soft clip so stacked layers never exceed full scale.
        for index in result.indices {
            let value = result[index]
            result[index] = value / (1 + abs(value) * 0.3)
        }
        return result
    }

    private func envelopeValue(t: Double, duration: Double, attack: Double, release: Double) -> Float {
        var value = 1.0
        if attack > 0, t < attack { value = t / attack }
        let remaining = duration - t
        if release > 0, remaining < release { value = min(value, max(0, remaining / release)) }
        return Float(value)
    }
}

/// Tiny deterministic PRNG so synthesized noise is identical every launch.
struct SplitMix64 {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    mutating func nextUnit() -> Double {
        Double(next() >> 11) / Double(1 << 53)
    }
}
