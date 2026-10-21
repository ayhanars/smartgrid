import XCTest
@testable import RobovacCore

final class FileOperationServiceTests: XCTestCase {
    var desktop: TemporaryDesktop!
    let service = FileOperationService()

    override func setUpWithError() throws {
        desktop = try TemporaryDesktop()
    }

    override func tearDown() {
        desktop.tearDown()
    }

    func testMovePreservesNameAndContents() throws {
        let url = try desktop.makeFile("report.pdf", contents: "PDF-1.4")
        let item = try XCTUnwrap(DesktopScanner().inspect(url: url))
        let result = service.move(item: item, toDirectory: desktop.destination)
        let moved = try result.get()
        XCTAssertEqual(moved.lastPathComponent, "report.pdf")
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        XCTAssertEqual(try String(contentsOf: moved, encoding: .utf8), "PDF-1.4")
    }

    func testMoveNeverOverwritesExistingDestinationFile() throws {
        try FileManager.default.createDirectory(at: desktop.destination, withIntermediateDirectories: true)
        let existing = desktop.destination.appendingPathComponent("report.pdf")
        try "original".data(using: .utf8)!.write(to: existing)
        let url = try desktop.makeFile("report.pdf", contents: "new")
        let item = try XCTUnwrap(DesktopScanner().inspect(url: url))
        let moved = try service.move(item: item, toDirectory: desktop.destination).get()
        XCTAssertEqual(moved.lastPathComponent, "report 2.pdf")
        XCTAssertEqual(try String(contentsOf: existing, encoding: .utf8), "original")
        XCTAssertEqual(try String(contentsOf: moved, encoding: .utf8), "new")
    }

    func testMissingSourceIsASkip() throws {
        let url = try desktop.makeFile("gone.txt")
        let item = try XCTUnwrap(DesktopScanner().inspect(url: url))
        try FileManager.default.removeItem(at: url)
        let result = service.move(item: item, toDirectory: desktop.destination)
        guard case .failure(let failure) = result else { return XCTFail("expected failure") }
        XCTAssertEqual(failure, .sourceMissing)
        XCTAssertTrue(failure.isSkip)
    }

    func testChangedFileSinceScanIsSkipped() throws {
        let url = try desktop.makeFile("notes.txt", contents: "short")
        let item = try XCTUnwrap(DesktopScanner().inspect(url: url))
        try "a much longer body".data(using: .utf8)!.write(to: url)
        let result = service.move(item: item, toDirectory: desktop.destination)
        guard case .failure(let failure) = result else { return XCTFail("expected failure") }
        XCTAssertEqual(failure, .identityChanged)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
    }

    func testUniqueURLNumbering() throws {
        try FileManager.default.createDirectory(at: desktop.destination, withIntermediateDirectories: true)
        for name in ["a.txt", "a 2.txt", "noext", "noext 2"] {
            try Data().write(to: desktop.destination.appendingPathComponent(name))
        }
        XCTAssertEqual(FileOperationService.uniqueURL(forName: "a.txt", in: desktop.destination).lastPathComponent, "a 3.txt")
        XCTAssertEqual(FileOperationService.uniqueURL(forName: "noext", in: desktop.destination).lastPathComponent, "noext 3")
        XCTAssertEqual(FileOperationService.uniqueURL(forName: "b.txt", in: desktop.destination).lastPathComponent, "b.txt")
    }

    func testRestoreRefusesToOverwriteUnlessRenamingIsAllowed() throws {
        let url = try desktop.makeFile("doc.txt", contents: "one")
        let item = try XCTUnwrap(DesktopScanner().inspect(url: url))
        let moved = try service.move(item: item, toDirectory: desktop.destination).get()
        try "two".data(using: .utf8)!.write(to: url)

        let blocked = service.restore(from: moved, to: url, renameIfOccupied: false)
        guard case .failure(let failure) = blocked else { return XCTFail("expected conflict") }
        XCTAssertEqual(failure, .originalOccupied)
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), "two")

        let renamed = try service.restore(from: moved, to: url, renameIfOccupied: true).get()
        XCTAssertEqual(renamed.lastPathComponent, "doc 2.txt")
        XCTAssertEqual(try String(contentsOf: renamed, encoding: .utf8), "one")
    }
}
