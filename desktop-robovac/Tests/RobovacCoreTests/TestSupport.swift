import Foundation
import XCTest
@testable import RobovacCore

/// A throwaway desktop + destination folder pair on disk.
final class TemporaryDesktop {
    let root: URL
    let desktop: URL
    let destination: URL

    init() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("robovac-tests-\(UUID().uuidString)", isDirectory: true)
        desktop = root.appendingPathComponent("Desktop", isDirectory: true)
        destination = root.appendingPathComponent("Cleanups", isDirectory: true)
        try FileManager.default.createDirectory(at: desktop, withIntermediateDirectories: true)
    }

    @discardableResult
    func makeFile(_ name: String, contents: String = "hello", modifiedSecondsAgo: TimeInterval = 60) throws -> URL {
        let url = desktop.appendingPathComponent(name)
        try contents.data(using: .utf8)!.write(to: url)
        let date = Date().addingTimeInterval(-modifiedSecondsAgo)
        try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: url.path)
        return url
    }

    @discardableResult
    func makeFolder(_ name: String) throws -> URL {
        let url = desktop.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func tearDown() {
        try? FileManager.default.removeItem(at: root)
    }
}

func makeItem(
    _ name: String,
    in directory: URL = URL(fileURLWithPath: "/Users/test/Desktop", isDirectory: true),
    isDirectory: Bool = false,
    isPackage: Bool = false,
    isSymbolicLink: Bool = false,
    isAlias: Bool = false,
    hasScreenshotMetadata: Bool = false,
    modified: Date = Date(timeIntervalSince1970: 1_000_000),
    added: Date? = nil
) -> DesktopItem {
    DesktopItem(
        url: directory.appendingPathComponent(name),
        isDirectory: isDirectory,
        isPackage: isPackage,
        isSymbolicLink: isSymbolicLink,
        isAlias: isAlias,
        fileSize: 10,
        creationDate: modified,
        modificationDate: modified,
        addedDate: added,
        hasScreenshotMetadata: hasScreenshotMetadata
    )
}

let fixedNow: @Sendable () -> Date = { Date(timeIntervalSince1970: 2_000_000) }
