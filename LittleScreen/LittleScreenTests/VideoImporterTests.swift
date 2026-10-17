import CoreMedia
import XCTest
@testable import LittleScreen

final class VideoImporterTests: XCTestCase {
    func testDefaultTitleCleansFileName() {
        XCTAssertEqual(VideoImporter.defaultTitle(for: URL(fileURLWithPath: "/x/Peppa_Pig-ep01.mp4")), "Peppa Pig ep01")
        XCTAssertEqual(VideoImporter.defaultTitle(for: URL(fileURLWithPath: "/x/___.mp4")), "Untitled video")
        let long = String(repeating: "a", count: 200)
        XCTAssertEqual(VideoImporter.defaultTitle(for: URL(fileURLWithPath: "/x/\(long).mov")).count, VideoImporter.maxTitleLength)
    }

    func testFileTypeCheck() {
        XCTAssertNoThrow(try VideoImporter.checkFileType(of: URL(fileURLWithPath: "/a/b.mp4")))
        XCTAssertNoThrow(try VideoImporter.checkFileType(of: URL(fileURLWithPath: "/a/b.MOV")))
        XCTAssertNoThrow(try VideoImporter.checkFileType(of: URL(fileURLWithPath: "/a/b.m4v")))
        XCTAssertThrowsError(try VideoImporter.checkFileType(of: URL(fileURLWithPath: "/a/b.pdf"))) { error in
            XCTAssertEqual(error as? ImportError, .unsupportedType("pdf"))
        }
        XCTAssertThrowsError(try VideoImporter.checkFileType(of: URL(fileURLWithPath: "/a/b.mp3"))) { error in
            XCTAssertEqual(error as? ImportError, .unsupportedType("mp3"))
        }
    }

    func testThumbnailTimeIsClampedInsideTheVideo() {
        XCTAssertEqual(VideoImporter.thumbnailTime(for: 0).seconds, 0)
        XCTAssertEqual(VideoImporter.thumbnailTime(for: .nan).seconds, 0)
        XCTAssertEqual(VideoImporter.thumbnailTime(for: 2).seconds, 0.5, accuracy: 0.001)
        XCTAssertEqual(VideoImporter.thumbnailTime(for: 0.3).seconds, 0.3, accuracy: 0.001)
        XCTAssertEqual(VideoImporter.thumbnailTime(for: 30).seconds, 3, accuracy: 0.001)
        XCTAssertEqual(VideoImporter.thumbnailTime(for: 600).seconds, 5, accuracy: 0.001)
    }

    func testFourCC() {
        XCTAssertEqual(VideoImporter.fourCC(CMFormatDescription.MediaSubType.h264.rawValue), "avc1")
        XCTAssertEqual(VideoImporter.fourCC(CMFormatDescription.MediaSubType.hevc.rawValue), "hvc1")
    }

    func testVideoItemFormatting() {
        var item = VideoItem(title: "x", mediaFileName: "x.mp4", durationSeconds: 3725, fileSizeBytes: 1_048_576, pixelWidth: 1920, pixelHeight: 1080)
        XCTAssertEqual(item.formattedDuration, "1:02:05")
        XCTAssertEqual(item.formattedDimensions, "1920 × 1080")
        XCTAssertNotNil(item.formattedFileSize)
        item.durationSeconds = 65
        XCTAssertEqual(item.formattedDuration, "1:05")
        item.durationSeconds = nil
        XCTAssertNil(item.formattedDuration)
    }

    func testImportingAMissingFileFailsCleanly() async throws {
        let paths = AppPaths.temporary()
        try paths.ensureDirectories()
        defer { try? FileManager.default.removeItem(at: paths.root) }
        let importer = VideoImporter(paths: paths, media: MediaStore(paths: paths))
        let bogus = paths.root.appendingPathComponent("nothing-here.mp4")

        do {
            _ = try await importer.importVideo(from: bogus)
            XCTFail("Expected an error")
        } catch let error as ImportError {
            XCTAssertTrue(error == .accessDenied || error == .unreadable, "unexpected \(error)")
        }
        // Nothing was left behind in the media directory.
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: paths.mediaDirectory.path)
        XCTAssertTrue(leftovers.isEmpty)
    }

    func testImportingANonVideoFileIsRejected() async throws {
        let paths = AppPaths.temporary()
        try paths.ensureDirectories()
        defer { try? FileManager.default.removeItem(at: paths.root) }
        let importer = VideoImporter(paths: paths, media: MediaStore(paths: paths))
        let fake = paths.root.appendingPathComponent("fake.mp4")
        try Data("definitely not an mp4".utf8).write(to: fake)

        do {
            _ = try await importer.importVideo(from: fake)
            XCTFail("Expected an error")
        } catch let error as ImportError {
            XCTAssertTrue(error == .unreadable || error == .noVideoTrack || error == .notPlayable, "unexpected \(error)")
        }
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: paths.mediaDirectory.path)
        XCTAssertTrue(leftovers.isEmpty)
    }
}
