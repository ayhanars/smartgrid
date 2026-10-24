import Foundation

/// Shown in the popover and diagnostics so it is obvious which build is running.
enum BuildInfo {
    static let version = "0.4.0"
    static let number = 151
    static let date = "2026-10-22"
    static var label: String { "Build \(number)" }
    static var longLabel: String { "v\(version) (\(number)) · \(date)" }
}
