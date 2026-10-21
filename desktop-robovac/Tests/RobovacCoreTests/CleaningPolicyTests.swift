import XCTest
@testable import RobovacCore

final class CleaningPolicyTests: XCTestCase {
    let desktop = URL(fileURLWithPath: "/Users/test/Desktop", isDirectory: true)

    func policy(rules: ExclusionRules = ExclusionRules(), mode: CleaningMode = .smartClean) -> CleaningPolicy {
        CleaningPolicy(rules: rules, mode: mode, desktopURL: desktop, now: fixedNow)
    }

    func testPlainFileIsEligible() {
        let decision = policy().evaluate(makeItem("report.pdf"))
        XCTAssertTrue(decision.isEligible)
        XCTAssertEqual(decision.category, .pdf)
    }

    func testDirectoriesExcludedByDefaultAndIncludedOnOptIn() {
        let folder = makeItem("Project", isDirectory: true)
        XCTAssertEqual(policy().evaluate(folder).exclusionReason, .directory)
        let opted = policy(rules: ExclusionRules(includeDirectories: true))
        XCTAssertTrue(opted.evaluate(folder).isEligible)
    }

    func testPackagesExcludedByDefault() {
        let package = makeItem("Letter.pages", isDirectory: true, isPackage: true)
        XCTAssertEqual(policy().evaluate(package).exclusionReason, .package)
    }

    func testSymlinksAndAliasesAreNeverMoved() {
        XCTAssertEqual(policy().evaluate(makeItem("link.pdf", isSymbolicLink: true)).exclusionReason, .symbolicLink)
        XCTAssertEqual(policy().evaluate(makeItem("alias", isAlias: true)).exclusionReason, .alias)
    }

    func testExcludedExtensionNormalisesDots() {
        let rules = ExclusionRules(excludedExtensions: [".WEBLOC"])
        let decision = policy(rules: rules).evaluate(makeItem("site.webloc"))
        XCTAssertEqual(decision.exclusionReason, .excludedExtension("webloc"))
    }

    func testExcludedCategory() {
        let rules = ExclusionRules(excludedCategories: [.pdf])
        XCTAssertEqual(policy(rules: rules).evaluate(makeItem("a.pdf")).exclusionReason, .excludedCategory(.pdf))
        XCTAssertTrue(policy(rules: rules).evaluate(makeItem("a.png")).isEligible)
    }

    func testExcludedFileAndNamePattern() {
        let rules = ExclusionRules(
            excludedFiles: [desktop.appendingPathComponent("keep.txt")],
            excludedNamePatterns: ["Work_*"]
        )
        XCTAssertEqual(policy(rules: rules).evaluate(makeItem("keep.txt")).exclusionReason, .excludedFile)
        XCTAssertEqual(policy(rules: rules).evaluate(makeItem("Work_plan.docx")).exclusionReason, .namePattern("Work_*"))
        XCTAssertTrue(policy(rules: rules).evaluate(makeItem("Homework.docx")).isEligible)
    }

    func testExcludedFolderProtectsTheFolderAndItsContents() {
        let project = desktop.appendingPathComponent("Project", isDirectory: true)
        let rules = ExclusionRules(excludedFolders: [project], includeDirectories: true)
        let folderDecision = policy(rules: rules).evaluate(makeItem("Project", isDirectory: true))
        XCTAssertEqual(folderDecision.exclusionReason, .insideExcludedFolder(project.path))
        let other = policy(rules: rules).evaluate(makeItem("Projects.txt"))
        XCTAssertTrue(other.isEligible, "A sibling with a similar prefix must not be caught")
    }

    func testItemsOutsideDesktopAreNeverProcessed() {
        let elsewhere = URL(fileURLWithPath: "/Users/test/Documents", isDirectory: true)
        let decision = policy().evaluate(makeItem("stray.pdf", in: elsewhere))
        XCTAssertEqual(decision.exclusionReason, .outsideDesktop)
    }

    func testScreenshotSweepOnlyTakesScreenshots() {
        let sweep = policy(mode: .screenshotSweep)
        XCTAssertTrue(sweep.evaluate(makeItem("Screenshot 2026-10-21 at 1.00.00.png")).isEligible)
        XCTAssertEqual(sweep.evaluate(makeItem("photo.png")).exclusionReason, .notInMode(.screenshotSweep))
    }

    func testInProgressDownloadsAndFreshFilesAreSkipped() {
        XCTAssertEqual(policy().evaluate(makeItem("movie.mp4.crdownload")).exclusionReason, .downloadInProgress)
        let fresh = makeItem("fresh.png", modified: fixedNow().addingTimeInterval(-0.5))
        XCTAssertEqual(policy().evaluate(fresh).exclusionReason, .recentlyModified)
    }

    func testGlobPattern() {
        XCTAssertTrue(GlobPattern("Work_*").matches("work_notes.txt"))
        XCTAssertTrue(GlobPattern("*.bak").matches("x.bak"))
        XCTAssertFalse(GlobPattern("*.bak").matches("x.bak.txt"))
        XCTAssertTrue(GlobPattern("IMG_????.jpg").matches("IMG_1234.jpg"))
        XCTAssertFalse(GlobPattern("IMG_????.jpg").matches("IMG_12345.jpg"))
        XCTAssertTrue(GlobPattern("a(b).txt").matches("a(b).txt"))
    }
}
