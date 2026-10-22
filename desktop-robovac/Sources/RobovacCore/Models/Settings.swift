import Foundation

// MARK: - Decoding helpers

extension KeyedDecodingContainer {
    /// Decodes a value or falls back to `defaultValue` when the key is absent or
    /// malformed. Lets older settings files load after new fields are added.
    func decode<T: Decodable>(_ type: T.Type, forKey key: Key, default defaultValue: T) -> T {
        (try? decodeIfPresent(type, forKey: key)) ?? defaultValue
    }
}

// MARK: - Exclusions

/// Everything the user said the robot must leave alone.
public struct ExclusionRules: Codable, Equatable, Sendable {
    /// Folders the robot never touches. Items inside them (or the folders themselves) are skipped.
    public var excludedFolders: [URL]
    /// Lowercased extensions without the dot, e.g. "webloc".
    public var excludedExtensions: [String]
    public var excludedCategories: Set<FileCategory>
    /// Individual files that must never move.
    public var excludedFiles: [URL]
    /// Shell-style name patterns, e.g. "Work_*".
    public var excludedNamePatterns: [String]
    /// Directories are left alone unless the user opts in.
    public var includeDirectories: Bool
    /// Packages (.app, .pages, .rtfd, …) look like files in Finder but are directories on disk.
    public var includePackages: Bool

    public init(
        excludedFolders: [URL] = [],
        excludedExtensions: [String] = [],
        excludedCategories: Set<FileCategory> = [],
        excludedFiles: [URL] = [],
        excludedNamePatterns: [String] = [],
        includeDirectories: Bool = false,
        includePackages: Bool = false
    ) {
        self.excludedFolders = excludedFolders
        self.excludedExtensions = excludedExtensions.map { ExclusionRules.normalizeExtension($0) }
        self.excludedCategories = excludedCategories
        self.excludedFiles = excludedFiles
        self.excludedNamePatterns = excludedNamePatterns
        self.includeDirectories = includeDirectories
        self.includePackages = includePackages
    }

    public static func normalizeExtension(_ raw: String) -> String {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        while value.hasPrefix(".") { value.removeFirst() }
        return value
    }

    enum CodingKeys: String, CodingKey {
        case excludedFolders, excludedExtensions, excludedCategories, excludedFiles
        case excludedNamePatterns, includeDirectories, includePackages
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            excludedFolders: c.decode([URL].self, forKey: .excludedFolders, default: []),
            excludedExtensions: c.decode([String].self, forKey: .excludedExtensions, default: []),
            excludedCategories: c.decode(Set<FileCategory>.self, forKey: .excludedCategories, default: []),
            excludedFiles: c.decode([URL].self, forKey: .excludedFiles, default: []),
            excludedNamePatterns: c.decode([String].self, forKey: .excludedNamePatterns, default: []),
            includeDirectories: c.decode(Bool.self, forKey: .includeDirectories, default: false),
            includePackages: c.decode(Bool.self, forKey: .includePackages, default: false)
        )
    }
}

// MARK: - Destinations

/// Where cleaned files go.
public struct DestinationRules: Codable, Equatable, Sendable {
    /// Fallback destination for any category without its own folder.
    public var defaultDestination: URL
    /// Optional per-category destinations.
    public var categoryDestinations: [FileCategory: URL]
    /// Put each run's files into a dated subfolder of the default destination.
    public var useDatedSessionFolders: Bool

    public init(
        defaultDestination: URL = DestinationRules.suggestedDefaultDestination(),
        categoryDestinations: [FileCategory: URL] = [:],
        useDatedSessionFolders: Bool = true
    ) {
        self.defaultDestination = defaultDestination
        self.categoryDestinations = categoryDestinations
        self.useDatedSessionFolders = useDatedSessionFolders
    }

    /// `~/Documents/Robovac Cleanups`
    public static func suggestedDefaultDestination() -> URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents", isDirectory: true)
        return documents.appendingPathComponent("Robovac Cleanups", isDirectory: true)
    }

    enum CodingKeys: String, CodingKey {
        case defaultDestination, categoryDestinations, useDatedSessionFolders
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawDestinations = c.decode([String: URL].self, forKey: .categoryDestinations, default: [:])
        var destinations: [FileCategory: URL] = [:]
        for (key, url) in rawDestinations {
            if let category = FileCategory(rawValue: key) { destinations[category] = url }
        }
        self.init(
            defaultDestination: c.decode(URL.self, forKey: .defaultDestination, default: DestinationRules.suggestedDefaultDestination()),
            categoryDestinations: destinations,
            useDatedSessionFolders: c.decode(Bool.self, forKey: .useDatedSessionFolders, default: true)
        )
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(defaultDestination, forKey: .defaultDestination)
        var raw: [String: URL] = [:]
        for (category, url) in categoryDestinations { raw[category.rawValue] = url }
        try c.encode(raw, forKey: .categoryDestinations)
        try c.encode(useDatedSessionFolders, forKey: .useDatedSessionFolders)
    }
}

// MARK: - Sections

public struct GeneralSettings: Codable, Equatable, Sendable {
    public var launchAtLogin: Bool
    public var showDesktopRobot: Bool
    /// Overrides the Desktop folder (useful for sandboxed builds that need a user-granted bookmark).
    public var desktopURL: URL?
    /// Show the preview before every run, not just the first one.
    public var previewBeforeEveryRun: Bool
    public var hasCompletedFirstPreview: Bool

    public init(
        launchAtLogin: Bool = false,
        showDesktopRobot: Bool = true,
        desktopURL: URL? = nil,
        previewBeforeEveryRun: Bool = false,
        hasCompletedFirstPreview: Bool = false
    ) {
        self.launchAtLogin = launchAtLogin
        self.showDesktopRobot = showDesktopRobot
        self.desktopURL = desktopURL
        self.previewBeforeEveryRun = previewBeforeEveryRun
        self.hasCompletedFirstPreview = hasCompletedFirstPreview
    }

    enum CodingKeys: String, CodingKey {
        case launchAtLogin, showDesktopRobot, desktopURL, previewBeforeEveryRun, hasCompletedFirstPreview
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            launchAtLogin: c.decode(Bool.self, forKey: .launchAtLogin, default: false),
            showDesktopRobot: c.decode(Bool.self, forKey: .showDesktopRobot, default: true),
            desktopURL: c.decode(URL?.self, forKey: .desktopURL, default: nil),
            previewBeforeEveryRun: c.decode(Bool.self, forKey: .previewBeforeEveryRun, default: false),
            hasCompletedFirstPreview: c.decode(Bool.self, forKey: .hasCompletedFirstPreview, default: false)
        )
    }
}

public struct CleaningSettings: Codable, Equatable, Sendable {
    public var mode: CleaningMode
    public var rules: ExclusionRules
    public var destinations: DestinationRules
    /// Send the robot out by itself when new eligible files appear on the Desktop.
    public var autoCleanNewFiles: Bool
    /// Seconds to wait after the last change before an automatic run starts.
    public var autoCleanDelay: Double
    /// Put collected files in the Trash instead of a folder. Still undoable until the Trash is emptied.
    public var sendToTrash: Bool

    public init(
        mode: CleaningMode = .smartClean,
        rules: ExclusionRules = ExclusionRules(),
        destinations: DestinationRules = DestinationRules(),
        autoCleanNewFiles: Bool = false,
        autoCleanDelay: Double = 10,
        sendToTrash: Bool = false
    ) {
        self.mode = mode
        self.rules = rules
        self.destinations = destinations
        self.autoCleanNewFiles = autoCleanNewFiles
        self.autoCleanDelay = autoCleanDelay
        self.sendToTrash = sendToTrash
    }

    enum CodingKeys: String, CodingKey { case mode, rules, destinations, autoCleanNewFiles, autoCleanDelay, sendToTrash }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            mode: c.decode(CleaningMode.self, forKey: .mode, default: .smartClean),
            rules: c.decode(ExclusionRules.self, forKey: .rules, default: ExclusionRules()),
            destinations: c.decode(DestinationRules.self, forKey: .destinations, default: DestinationRules()),
            autoCleanNewFiles: c.decode(Bool.self, forKey: .autoCleanNewFiles, default: false),
            autoCleanDelay: c.decode(Double.self, forKey: .autoCleanDelay, default: 10),
            sendToTrash: c.decode(Bool.self, forKey: .sendToTrash, default: false)
        )
    }
}

public enum TrailStyle: String, Codable, CaseIterable, Sendable, Identifiable {
    case damp
    case sheen
    case tireMarks
    case none

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .damp: return "Damp trail"
        case .sheen: return "Cleaned sheen"
        case .tireMarks: return "Tire marks"
        case .none: return "No trail"
        }
    }
}

/// How Finder arranges the desktop. Used to approximate icon positions, since
/// macOS offers no public API for reading them.
public enum IconArrangement: String, Codable, CaseIterable, Sendable, Identifiable {
    case dateAdded
    case name
    case kind
    case dateModified

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .dateAdded: return "Date added (Finder default)"
        case .name: return "Name"
        case .kind: return "Kind"
        case .dateModified: return "Date modified"
        }
    }
}

/// How the robot works the desktop.
public enum MovementPattern: String, Codable, CaseIterable, Sendable, Identifiable {
    /// Wide serpentine passes: fewest lanes, quickest.
    case quick
    /// Serpentine passes one mop width apart: full coverage.
    case standard
    /// Overlapping serpentine passes: every spot twice.
    case deep
    /// Straight runs with random bounces off the edges, like an older robot vacuum.
    case bounce
    /// Always the nearest file next, no exploring.
    case direct

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .quick: return "Quick"
        case .standard: return "Standard"
        case .deep: return "Deep"
        case .bounce: return "Explore"
        case .direct: return "Direct"
        }
    }

    public var summary: String {
        switch self {
        case .quick: return "Wide serpentine lanes across the desktop, collecting files as it passes. Fewest passes."
        case .standard: return "Serpentine lanes one mop width apart, so every part of the desktop gets a pass."
        case .deep: return "Overlapping serpentine lanes; every spot is covered twice. Longest run."
        case .bounce: return "Straight runs with a new heading at every edge, like a classic robot vacuum. After the exploring time it heads for the nearest file."
        case .direct: return "Drives straight to the nearest remaining file every time. Quickest and most predictable."
        }
    }

    /// Lane spacing as a multiple of the mop width, for the serpentine patterns.
    public var laneSpacingFactor: Double? {
        switch self {
        case .quick: return 1.7
        case .standard: return 1.0
        case .deep: return 0.6
        case .bounce, .direct: return nil
        }
    }

    public var isCoverage: Bool { laneSpacingFactor != nil }

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        if raw == "sweep" { self = .standard; return }
        self = MovementPattern(rawValue: raw) ?? .standard
    }
}

/// The robot's colour scheme.
public enum RobotSkin: String, Codable, CaseIterable, Sendable, Identifiable {
    case light
    case dark

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .light: return "White"
        case .dark: return "Graphite"
        }
    }
}

/// Which windows the robot is drawn in front of.
public enum RobotLayer: String, Codable, CaseIterable, Sendable, Identifiable {
    /// Above every window but still click-through. Always visible.
    case aboveWindows
    /// Above the desktop icons and below application windows.
    case behindWindows

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .aboveWindows: return "In front of windows"
        case .behindWindows: return "Behind windows, above desktop icons"
        }
    }
}

public struct AppearanceSettings: Codable, Equatable, Sendable {
    /// Robot diameter in points.
    public var robotSize: Double
    /// Cruise speed in points per second.
    public var movementSpeed: Double
    public var trailStyle: TrailStyle
    public var trailOpacity: Double
    public var trailFadeDuration: Double
    public var particleEffects: Bool
    /// 0…1, scales particle counts and wobble.
    public var animationIntensity: Double
    public var reducedMotion: Bool
    public var iconArrangement: IconArrangement
    /// Finder's desktop grid, used for the icon position approximation.
    public var iconGridColumnWidth: Double
    public var iconGridRowHeight: Double
    public var movementPattern: MovementPattern
    public var robotLayer: RobotLayer
    /// Ask Finder for the exact icon positions (needs the Automation permission once).
    public var useFinderIconPositions: Bool
    /// Seconds the robot explores before giving up and heading for a file (bounce pattern).
    public var wanderSeconds: Double
    public var robotSkin: RobotSkin

    public init(
        robotSize: Double = 64,
        movementSpeed: Double = 260,
        trailStyle: TrailStyle = .damp,
        trailOpacity: Double = 0.6,
        trailFadeDuration: Double = 4.5,
        particleEffects: Bool = true,
        animationIntensity: Double = 1.0,
        reducedMotion: Bool = false,
        iconArrangement: IconArrangement = .dateAdded,
        iconGridColumnWidth: Double = 96,
        iconGridRowHeight: Double = 104,
        movementPattern: MovementPattern = .standard,
        robotLayer: RobotLayer = .behindWindows,
        useFinderIconPositions: Bool = true,
        wanderSeconds: Double = 5,
        robotSkin: RobotSkin = .light
    ) {
        self.robotSize = robotSize
        self.movementSpeed = movementSpeed
        self.trailStyle = trailStyle
        self.trailOpacity = trailOpacity
        self.trailFadeDuration = trailFadeDuration
        self.particleEffects = particleEffects
        self.animationIntensity = animationIntensity
        self.reducedMotion = reducedMotion
        self.iconArrangement = iconArrangement
        self.iconGridColumnWidth = iconGridColumnWidth
        self.iconGridRowHeight = iconGridRowHeight
        self.movementPattern = movementPattern
        self.robotLayer = robotLayer
        self.useFinderIconPositions = useFinderIconPositions
        self.wanderSeconds = wanderSeconds
        self.robotSkin = robotSkin
    }

    enum CodingKeys: String, CodingKey {
        case robotSize, movementSpeed, trailStyle, trailOpacity, trailFadeDuration
        case particleEffects, animationIntensity, reducedMotion, iconArrangement
        case iconGridColumnWidth, iconGridRowHeight, movementPattern, robotLayer, useFinderIconPositions, wanderSeconds, robotSkin
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = AppearanceSettings()
        self.init(
            robotSize: c.decode(Double.self, forKey: .robotSize, default: d.robotSize),
            movementSpeed: c.decode(Double.self, forKey: .movementSpeed, default: d.movementSpeed),
            trailStyle: c.decode(TrailStyle.self, forKey: .trailStyle, default: d.trailStyle),
            trailOpacity: c.decode(Double.self, forKey: .trailOpacity, default: d.trailOpacity),
            trailFadeDuration: c.decode(Double.self, forKey: .trailFadeDuration, default: d.trailFadeDuration),
            particleEffects: c.decode(Bool.self, forKey: .particleEffects, default: d.particleEffects),
            animationIntensity: c.decode(Double.self, forKey: .animationIntensity, default: d.animationIntensity),
            reducedMotion: c.decode(Bool.self, forKey: .reducedMotion, default: d.reducedMotion),
            iconArrangement: c.decode(IconArrangement.self, forKey: .iconArrangement, default: d.iconArrangement),
            iconGridColumnWidth: c.decode(Double.self, forKey: .iconGridColumnWidth, default: d.iconGridColumnWidth),
            iconGridRowHeight: c.decode(Double.self, forKey: .iconGridRowHeight, default: d.iconGridRowHeight),
            movementPattern: c.decode(MovementPattern.self, forKey: .movementPattern, default: d.movementPattern),
            robotLayer: c.decode(RobotLayer.self, forKey: .robotLayer, default: d.robotLayer),
            useFinderIconPositions: c.decode(Bool.self, forKey: .useFinderIconPositions, default: d.useFinderIconPositions),
            wanderSeconds: c.decode(Double.self, forKey: .wanderSeconds, default: d.wanderSeconds),
            robotSkin: c.decode(RobotSkin.self, forKey: .robotSkin, default: d.robotSkin)
        )
    }
}

public enum SoundEvent: String, Codable, CaseIterable, Sendable, Identifiable {
    case start
    case movement
    case suction
    case collect
    case turn
    case avoid
    case complete
    case error

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .start: return "Robot starting"
        case .movement: return "Motor and wheels"
        case .suction: return "Vacuum suction"
        case .collect: return "File collected"
        case .turn: return "Turning (soft whir)"
        case .avoid: return "Bumping an edge (muted thud)"
        case .complete: return "Cleaning complete"
        case .error: return "Error or blocked"
        }
    }
}

public struct SoundSettings: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var volume: Double
    /// 0 = rare motor blips, 1 = frequent.
    public var movementSoundFrequency: Double
    public var suctionIntensity: Double
    public var completionSound: Bool
    public var enabledEvents: Set<SoundEvent>
    /// A soft motor hum that runs while the robot drives, louder with speed.
    public var continuousMotorSound: Bool
    /// Bumped when the default sound set changes, so saved settings adopt the new set once.
    public var defaultsVersion: Int

    /// Motor hum, suction, pickups and the completion chime; no turn or bump blips.
    public static let defaultEvents: Set<SoundEvent> = [.start, .movement, .suction, .collect, .complete, .error]
    public static let currentDefaultsVersion = 2

    public init(
        enabled: Bool = true,
        volume: Double = 0.6,
        movementSoundFrequency: Double = 0,
        suctionIntensity: Double = 0.7,
        completionSound: Bool = true,
        enabledEvents: Set<SoundEvent> = SoundSettings.defaultEvents,
        continuousMotorSound: Bool = true,
        defaultsVersion: Int = SoundSettings.currentDefaultsVersion
    ) {
        self.enabled = enabled
        self.volume = volume
        self.movementSoundFrequency = movementSoundFrequency
        self.suctionIntensity = suctionIntensity
        self.completionSound = completionSound
        self.enabledEvents = enabledEvents
        self.continuousMotorSound = continuousMotorSound
        self.defaultsVersion = defaultsVersion
    }

    enum CodingKeys: String, CodingKey {
        case enabled, volume, movementSoundFrequency, suctionIntensity, completionSound, enabledEvents
        case continuousMotorSound, defaultsVersion
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = SoundSettings()
        let version = c.decode(Int.self, forKey: .defaultsVersion, default: 1)
        let upgraded = version < SoundSettings.currentDefaultsVersion
        self.init(
            enabled: c.decode(Bool.self, forKey: .enabled, default: d.enabled),
            volume: c.decode(Double.self, forKey: .volume, default: d.volume),
            movementSoundFrequency: upgraded ? d.movementSoundFrequency : c.decode(Double.self, forKey: .movementSoundFrequency, default: d.movementSoundFrequency),
            suctionIntensity: c.decode(Double.self, forKey: .suctionIntensity, default: d.suctionIntensity),
            completionSound: c.decode(Bool.self, forKey: .completionSound, default: d.completionSound),
            enabledEvents: upgraded ? d.enabledEvents : c.decode(Set<SoundEvent>.self, forKey: .enabledEvents, default: d.enabledEvents),
            continuousMotorSound: c.decode(Bool.self, forKey: .continuousMotorSound, default: d.continuousMotorSound),
            defaultsVersion: SoundSettings.currentDefaultsVersion
        )
    }

    public func isEnabled(_ event: SoundEvent) -> Bool {
        guard enabled, enabledEvents.contains(event) else { return false }
        if event == .complete { return completionSound }
        return true
    }
}

/// Every persisted preference, in one Codable value.
public struct RobovacSettings: Codable, Equatable, Sendable {
    public var general: GeneralSettings
    public var cleaning: CleaningSettings
    public var appearance: AppearanceSettings
    public var sound: SoundSettings

    public init(
        general: GeneralSettings = GeneralSettings(),
        cleaning: CleaningSettings = CleaningSettings(),
        appearance: AppearanceSettings = AppearanceSettings(),
        sound: SoundSettings = SoundSettings()
    ) {
        self.general = general
        self.cleaning = cleaning
        self.appearance = appearance
        self.sound = sound
    }

    public static let `default` = RobovacSettings()

    enum CodingKeys: String, CodingKey { case general, cleaning, appearance, sound }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            general: c.decode(GeneralSettings.self, forKey: .general, default: GeneralSettings()),
            cleaning: c.decode(CleaningSettings.self, forKey: .cleaning, default: CleaningSettings()),
            appearance: c.decode(AppearanceSettings.self, forKey: .appearance, default: AppearanceSettings()),
            sound: c.decode(SoundSettings.self, forKey: .sound, default: SoundSettings())
        )
    }
}
