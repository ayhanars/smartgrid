import XCTest
@testable import RobovacCore

final class SettingsTests: XCTestCase {
    func testRoundTrip() throws {
        var settings = RobovacSettings()
        settings.cleaning.mode = .gentleClean
        settings.cleaning.rules.excludedExtensions = ["webloc"]
        settings.cleaning.rules.excludedCategories = [.pdf]
        settings.cleaning.destinations.categoryDestinations[.screenshot] = URL(fileURLWithPath: "/tmp/Shots")
        settings.appearance.trailStyle = .tireMarks
        settings.sound.enabledEvents = [.start, .complete]
        let data = try JSONEncoder().encode(settings)
        let decoded = try JSONDecoder().decode(RobovacSettings.self, from: data)
        XCTAssertEqual(decoded, settings)
    }

    func testMissingKeysFallBackToDefaults() throws {
        let json = #"{"cleaning":{"mode":"screenshotSweep"},"sound":{"volume":0.2}}"#
        let decoded = try JSONDecoder().decode(RobovacSettings.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.cleaning.mode, .screenshotSweep)
        XCTAssertEqual(decoded.sound.volume, 0.2)
        XCTAssertEqual(decoded.sound.enabled, true)
        XCTAssertEqual(decoded.appearance, AppearanceSettings())
        XCTAssertEqual(decoded.general, GeneralSettings())
    }

    func testEmptyObjectDecodesToDefaults() throws {
        let decoded = try JSONDecoder().decode(RobovacSettings.self, from: Data("{}".utf8))
        XCTAssertEqual(decoded, RobovacSettings())
    }
}
