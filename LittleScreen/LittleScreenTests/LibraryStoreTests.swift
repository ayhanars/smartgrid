import XCTest
@testable import LittleScreen

@MainActor
final class LibraryStoreTests: XCTestCase {
    private var paths: AppPaths!

    override func setUp() async throws {
        paths = AppPaths.temporary()
        try paths.ensureDirectories()
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: paths.root)
    }

    private func makeMediaFile(named name: String, bytes: Int = 16) throws -> URL {
        let url = paths.mediaDirectory.appendingPathComponent(name)
        try Data(repeating: 0xAB, count: bytes).write(to: url)
        return url
    }

    func testAddSaveAndReloadRoundTrip() throws {
        _ = try makeMediaFile(named: "a.mp4")
        let store = LibraryStore(paths: paths)
        store.load()
        try store.add(VideoItem(title: "Ducks", mediaFileName: "a.mp4", durationSeconds: 42))

        let reloaded = LibraryStore(paths: paths)
        reloaded.load()
        XCTAssertEqual(reloaded.items.count, 1)
        XCTAssertEqual(reloaded.items.first?.title, "Ducks")
        XCTAssertEqual(reloaded.items.first?.durationSeconds, 42)
        XCTAssertEqual(reloaded.availability[reloaded.items[0].id], .available)
    }

    func testMissingMediaIsHiddenFromChildButKeptForParent() throws {
        let store = LibraryStore(paths: paths)
        store.load()
        try store.add(VideoItem(title: "Gone", mediaFileName: "nope.mp4"))

        XCTAssertEqual(store.items.count, 1)
        XCTAssertTrue(store.childVisibleItems.isEmpty)
        XCTAssertEqual(store.availability[store.items[0].id], .missing)
    }

    func testEmptyMediaFileIsUnreadable() throws {
        _ = try makeMediaFile(named: "empty.mp4", bytes: 0)
        let store = LibraryStore(paths: paths)
        store.load()
        try store.add(VideoItem(title: "Empty", mediaFileName: "empty.mp4"))
        XCTAssertEqual(store.availability[store.items[0].id], .unreadable)
        XCTAssertTrue(store.childVisibleItems.isEmpty)
    }

    func testRemoveWithFilesDeletesMediaAndThumbnail() throws {
        let media = try makeMediaFile(named: "b.mp4")
        let thumb = paths.thumbnailDirectory.appendingPathComponent("b.jpg")
        try Data([1, 2, 3]).write(to: thumb)
        let store = LibraryStore(paths: paths)
        store.load()
        let item = VideoItem(title: "B", mediaFileName: "b.mp4", thumbnailFileName: "b.jpg")
        try store.add(item)

        try store.remove(item.id, deleteFiles: true)

        XCTAssertTrue(store.items.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: media.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: thumb.path))
    }

    func testDeleteMediaFileKeepsRecord() throws {
        let media = try makeMediaFile(named: "c.mp4")
        let store = LibraryStore(paths: paths)
        store.load()
        let item = VideoItem(title: "C", mediaFileName: "c.mp4")
        try store.add(item)

        try store.deleteMediaFile(for: item.id)

        XCTAssertEqual(store.items.count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: media.path))
        XCTAssertEqual(store.availability[item.id], .missing)
    }

    func testAttachMediaKeepsIdentityTitleAndThumbnail() throws {
        _ = try makeMediaFile(named: "new.mp4", bytes: 64)
        let store = LibraryStore(paths: paths)
        store.load()
        let original = VideoItem(title: "Keep me", mediaFileName: "old.mp4", thumbnailFileName: "keep.jpg")
        try store.add(original)
        let imported = VideoItem(title: "ignored", mediaFileName: "new.mp4", thumbnailFileName: nil, durationSeconds: 9, fileSizeBytes: 64)

        try store.attachMedia(from: imported, to: original.id)

        let updated = try XCTUnwrap(store.item(with: original.id))
        XCTAssertEqual(updated.title, "Keep me")
        XCTAssertEqual(updated.thumbnailFileName, "keep.jpg")
        XCTAssertEqual(updated.mediaFileName, "new.mp4")
        XCTAssertEqual(updated.durationSeconds, 9)
        XCTAssertEqual(store.availability[original.id], .available)
    }

    func testRenameIgnoresBlankTitles() throws {
        let store = LibraryStore(paths: paths)
        store.load()
        let item = VideoItem(title: "Original", mediaFileName: "x.mp4")
        try store.add(item)
        try store.rename(item.id, to: "   ")
        XCTAssertEqual(store.item(with: item.id)?.title, "Original")
        try store.rename(item.id, to: "  New  ")
        XCTAssertEqual(store.item(with: item.id)?.title, "New")
    }

    func testMoveRenumbersSortOrder() throws {
        let store = LibraryStore(paths: paths)
        store.load()
        for name in ["one", "two", "three"] {
            try store.add(VideoItem(title: name, mediaFileName: "\(name).mp4"))
        }
        try store.move(fromOffsets: IndexSet(integer: 2), toOffset: 0)
        XCTAssertEqual(store.items.map(\.title), ["three", "one", "two"])
        XCTAssertEqual(store.items.map(\.sortOrder), [0, 1, 2])

        let reloaded = LibraryStore(paths: paths)
        reloaded.load()
        XCTAssertEqual(reloaded.items.map(\.title), ["three", "one", "two"])
    }

    func testCorruptLibraryFileIsSetAsideNotOverwritten() throws {
        try Data("not json".utf8).write(to: paths.libraryFile)
        let store = LibraryStore(paths: paths)
        store.load()

        XCTAssertTrue(store.items.isEmpty)
        XCTAssertNotNil(store.lastError)
        let siblings = try FileManager.default.contentsOfDirectory(atPath: paths.root.path)
        XCTAssertTrue(siblings.contains { $0.hasPrefix("library.corrupt-") })
    }

    func testSetThumbnailReplacesFileAndName() throws {
        let store = LibraryStore(paths: paths)
        store.load()
        let item = VideoItem(title: "T", mediaFileName: "t.mp4")
        try store.add(item)

        try store.setThumbnail(for: item.id, jpegData: Data([0xFF, 0xD8]))
        let first = try XCTUnwrap(store.item(with: item.id)?.thumbnailFileName)
        try store.setThumbnail(for: item.id, jpegData: Data([0xFF, 0xD8, 0xFF]))
        let second = try XCTUnwrap(store.item(with: item.id)?.thumbnailFileName)

        XCTAssertNotEqual(first, second)
        XCTAssertFalse(FileManager.default.fileExists(atPath: paths.thumbnailDirectory.appendingPathComponent(first).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: paths.thumbnailDirectory.appendingPathComponent(second).path))
    }
}
