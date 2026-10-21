import Foundation
import RobovacCore

/// Persists `RobovacSettings` as JSON in UserDefaults.
struct SettingsStore {
    let defaults: UserDefaults
    let key: String

    init(defaults: UserDefaults = .standard, key: String = "robovac.settings") {
        self.defaults = defaults
        self.key = key
    }

    func load() -> RobovacSettings {
        guard let data = defaults.data(forKey: key) else { return .default }
        return (try? JSONDecoder().decode(RobovacSettings.self, from: data)) ?? .default
    }

    func save(_ settings: RobovacSettings) {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        defaults.set(data, forKey: key)
    }
}
