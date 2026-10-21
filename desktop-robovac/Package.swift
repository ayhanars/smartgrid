// swift-tools-version: 5.9
import PackageDescription

// RobovacCore is the platform-neutral cleaning engine (scanning, classification,
// policy, routing, file moves, history/undo, navigation planning). It only needs
// Foundation, so it builds and tests anywhere. The DesktopRobovac executable is
// the macOS menu bar app and only exists when building on macOS.

var targets: [Target] = [
    .target(
        name: "RobovacCore",
        path: "Sources/RobovacCore"
    ),
    .testTarget(
        name: "RobovacCoreTests",
        dependencies: ["RobovacCore"],
        path: "Tests/RobovacCoreTests"
    ),
]

var products: [Product] = [
    .library(name: "RobovacCore", targets: ["RobovacCore"]),
]

#if os(macOS)
targets.append(
    .executableTarget(
        name: "DesktopRobovac",
        dependencies: ["RobovacCore"],
        path: "Sources/DesktopRobovac",
        linkerSettings: [
            .linkedFramework("AppKit"),
            .linkedFramework("SwiftUI"),
            .linkedFramework("AVFoundation"),
            .linkedFramework("ServiceManagement"),
        ]
    )
)
products.append(.executable(name: "DesktopRobovac", targets: ["DesktopRobovac"]))
#endif

let package = Package(
    name: "DesktopRobovac",
    platforms: [.macOS(.v14)],
    products: products,
    targets: targets
)
