import Foundation

/// Everything the engine needs for one run.
public struct CleaningConfiguration: Sendable {
    public var desktopURL: URL
    public var mode: CleaningMode
    public var rules: ExclusionRules
    public var destinations: DestinationRules

    public init(desktopURL: URL, mode: CleaningMode, rules: ExclusionRules, destinations: DestinationRules) {
        self.desktopURL = desktopURL
        self.mode = mode
        self.rules = rules
        self.destinations = destinations
    }

    public init(settings: RobovacSettings) {
        self.init(
            desktopURL: settings.general.desktopURL ?? DesktopScanner.defaultDesktopURL,
            mode: settings.cleaning.mode,
            rules: settings.cleaning.rules,
            destinations: settings.cleaning.destinations
        )
    }
}

/// One file the robot will collect, with the folder it goes to.
public struct CleaningTarget: Identifiable, Hashable, Sendable {
    public let item: DesktopItem
    public let category: FileCategory
    public let destinationDirectory: URL

    public var id: UUID { item.id }

    public init(item: DesktopItem, category: FileCategory, destinationDirectory: URL) {
        self.item = item
        self.category = category
        self.destinationDirectory = destinationDirectory
    }
}

/// The result of scanning and evaluating the Desktop: what will move, what won't, and where.
public struct CleaningPlan: Sendable {
    public let configuration: CleaningConfiguration
    public let createdAt: Date
    /// Every item seen on the Desktop, eligible or not. The overlay uses this to lay out the virtual grid.
    public let scannedItems: [DesktopItem]
    public private(set) var targets: [CleaningTarget]
    public let excluded: [PolicyDecision]

    public init(configuration: CleaningConfiguration, createdAt: Date, scannedItems: [DesktopItem], targets: [CleaningTarget], excluded: [PolicyDecision]) {
        self.configuration = configuration
        self.createdAt = createdAt
        self.scannedItems = scannedItems
        self.targets = targets
        self.excluded = excluded
    }

    public var countsByCategory: [FileCategory: Int] {
        var counts: [FileCategory: Int] = [:]
        for target in targets { counts[target.category, default: 0] += 1 }
        return counts
    }

    /// Unique destination folders in first-use order.
    public var destinationDirectories: [URL] {
        var seen = Set<String>()
        var result: [URL] = []
        for target in targets where seen.insert(target.destinationDirectory.path).inserted {
            result.append(target.destinationDirectory)
        }
        return result
    }

    /// Returns a copy whose targets follow `order`. Targets missing from `order` keep their relative order at the end.
    public func reordered(by order: [UUID]) -> CleaningPlan {
        var byID: [UUID: CleaningTarget] = [:]
        for target in targets { byID[target.id] = target }
        var ordered: [CleaningTarget] = []
        var used = Set<UUID>()
        for id in order {
            if let target = byID[id], used.insert(id).inserted { ordered.append(target) }
        }
        for target in targets where !used.contains(target.id) { ordered.append(target) }
        var copy = self
        copy.targets = ordered
        return copy
    }
}

/// Scans the Desktop and turns the result into a `CleaningPlan`.
public struct CleaningPlanner: Sendable {
    public var configuration: CleaningConfiguration
    public var scanner: DesktopScanner
    public var classifier: FileClassifier
    public var now: @Sendable () -> Date

    public init(
        configuration: CleaningConfiguration,
        scanner: DesktopScanner = DesktopScanner(),
        classifier: FileClassifier = FileClassifier(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.configuration = configuration
        self.scanner = scanner
        self.classifier = classifier
        self.now = now
    }

    public func makePlan() throws -> CleaningPlan {
        let items = try scanner.scan(directory: configuration.desktopURL)
        return makePlan(from: items)
    }

    public func makePlan(from items: [DesktopItem]) -> CleaningPlan {
        let date = now()
        let policy = CleaningPolicy(
            rules: configuration.rules,
            mode: configuration.mode,
            desktopURL: configuration.desktopURL,
            classifier: classifier,
            now: now
        )
        let router = DestinationRouter(rules: configuration.destinations, sessionDate: date)
        var targets: [CleaningTarget] = []
        var excluded: [PolicyDecision] = []
        for decision in policy.evaluate(items) {
            if decision.isEligible {
                targets.append(CleaningTarget(
                    item: decision.item,
                    category: decision.category,
                    destinationDirectory: router.destinationDirectory(for: decision.category)
                ))
            } else {
                excluded.append(decision)
            }
        }
        return CleaningPlan(configuration: configuration, createdAt: date, scannedItems: items, targets: targets, excluded: excluded)
    }
}
