import Foundation

/// Minimal shell-style glob matcher supporting `*` and `?`, matched case-insensitively
/// against the whole file name.
public struct GlobPattern: Equatable, Sendable {
    public let pattern: String
    private let regex: NSRegularExpression?

    public init(_ pattern: String) {
        self.pattern = pattern
        var expression = "^"
        for character in pattern {
            switch character {
            case "*": expression += ".*"
            case "?": expression += "."
            default: expression += NSRegularExpression.escapedPattern(for: String(character))
            }
        }
        expression += "$"
        regex = try? NSRegularExpression(pattern: expression, options: [.caseInsensitive])
    }

    public func matches(_ name: String) -> Bool {
        guard let regex else { return false }
        let range = NSRange(name.startIndex..<name.endIndex, in: name)
        return regex.firstMatch(in: name, options: [], range: range) != nil
    }

    public static func == (lhs: GlobPattern, rhs: GlobPattern) -> Bool { lhs.pattern == rhs.pattern }
}
