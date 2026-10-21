import XCTest
@testable import RobovacCore

final class FileClassifierTests: XCTestCase {
    let classifier = FileClassifier()

    func testExtensionsMapToCategories() {
        XCTAssertEqual(classifier.classify(makeItem("photo.JPG")), .image)
        XCTAssertEqual(classifier.classify(makeItem("report.pdf")), .pdf)
        XCTAssertEqual(classifier.classify(makeItem("notes.md")), .document)
        XCTAssertEqual(classifier.classify(makeItem("budget.xlsx")), .document)
        XCTAssertEqual(classifier.classify(makeItem("clip.mov")), .video)
        XCTAssertEqual(classifier.classify(makeItem("song.m4a")), .audio)
        XCTAssertEqual(classifier.classify(makeItem("bundle.zip")), .archive)
        XCTAssertEqual(classifier.classify(makeItem("installer.dmg")), .archive)
        XCTAssertEqual(classifier.classify(makeItem("mystery.xyz123")), .other)
        XCTAssertEqual(classifier.classify(makeItem("README")), .other)
    }

    func testScreenshotsRecognisedByMacOSNamingConvention() {
        XCTAssertEqual(classifier.classify(makeItem("Screenshot 2026-10-21 at 14.02.11.png")), .screenshot)
        XCTAssertEqual(classifier.classify(makeItem("Screen Shot 2021-03-04 at 9.15.01 AM.png")), .screenshot)
        XCTAssertEqual(classifier.classify(makeItem("Bildschirmfoto 2026-10-21 um 14.02.11.png")), .screenshot)
        XCTAssertEqual(classifier.classify(makeItem("Capture d’écran 2026-10-21 à 14.02.11.png")), .screenshot)
        XCTAssertEqual(classifier.classify(makeItem("スクリーンショット 2026-10-21 14.02.11.png")), .screenshot)
        XCTAssertEqual(classifier.classify(makeItem("CleanShot 2026-10-21 at 14.02.11@2x.png")), .screenshot)
    }

    func testScreenshotsRecognisedByMetadataEvenWithPlainName() {
        let item = makeItem("IMG_0001.png", hasScreenshotMetadata: true)
        XCTAssertEqual(classifier.classify(item), .screenshot)
    }

    func testScreenshotNameOnNonImageIsNotAScreenshot() {
        XCTAssertEqual(classifier.classify(makeItem("Screenshot notes.txt")), .document)
        XCTAssertEqual(classifier.classify(makeItem("Screen Recording 2026-10-21 at 14.02.11.mov")), .video)
    }

    func testPlainImageIsNotAScreenshot() {
        XCTAssertEqual(classifier.classify(makeItem("holiday.png")), .image)
        XCTAssertFalse(classifier.isScreenshot(makeItem("Screenshots.pdf")))
    }

    func testDirectoriesAreOther() {
        XCTAssertEqual(classifier.classify(makeItem("Photos.png", isDirectory: true)), .other)
    }
}
