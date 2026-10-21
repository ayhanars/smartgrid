# Desktop Robovac

A playful macOS menu bar app that vacuums your desktop. A tiny animated robot
vacuum lives in the menu bar; when you start a cleaning it drives across the
desktop in a methodical sweep, "sucks up" eligible files and files them into a
folder of your choice. Files are only ever **moved**, never deleted, and every
run can be undone.

```
desktop-robovac/
  Package.swift                 Swift package (macOS 14+, Swift 5.9+)
  Sources/RobovacCore/          Platform-neutral cleaning engine (Foundation only)
    Models/                     FileCategory, CleaningMode, DesktopItem, Settings
    Engine/                     DesktopScanner, FileClassifier, CleaningPolicy,
                                DestinationRouter, FileOperationService,
                                CleaningHistoryStore, UndoService,
                                CleaningPlanner, CleaningCoordinator
    Navigation/                 NavigationPlanner, DesktopIconLayout
  Sources/DesktopRobovac/       The macOS app (SwiftUI + AppKit)
    App/                        App entry, AppLifecycleManager, AppState, menu bar icon
    Overlay/                    RobotOverlayController, RobotSessionDirector,
                                RobotMotionController, RobotAnimationView,
                                TrailRenderer, ParticleSystem
    Services/                   SettingsStore, BookmarkStore, SoundManager,
                                FolderPicker, LaunchAtLogin
    Views/                      PopoverView, PreviewView, SettingsView, Dock guide
  Tests/RobovacCoreTests/       XCTest suite for the engine
  Resources/                    Info.plist (LSUIElement) and sandbox entitlements
  Scripts/make-app.sh           Assembles DesktopRobovac.app from the package
```

## Running it

Requirements: macOS 14 Sonoma or later, Xcode 15 or later (or a matching
command line toolchain).

```bash
cd desktop-robovac
swift test                      # engine tests (also run on CI)
swift run DesktopRobovac        # run as a menu bar app straight from the package
Scripts/make-app.sh             # or build build/DesktopRobovac.app and `open` it
```

`swift run` has no `Info.plist`, so the app switches itself to the accessory
activation policy at launch (no Dock icon). The bundled app gets the same via
`LSUIElement`. Launch at login needs the bundled app.

The first time the app scans, macOS asks for permission to access the Desktop
folder. If it was denied, the popover explains how to grant it in
System Settings › Privacy & Security › Files and Folders.

`Scripts/make-app.sh --sandbox` signs the bundle with the App Sandbox
entitlements. In that configuration the app cannot see the Desktop until you
pick it in Settings › General › Choose Desktop Folder; the app keeps a
security-scoped bookmark for it, and for every destination and excluded folder
you choose.

Opening the package in Xcode (`open Package.swift`) works too: run the
`DesktopRobovac` scheme.

## How a cleaning works

1. `DesktopScanner` lists the top level of the Desktop (never recursing).
2. `FileClassifier` sorts each item into a category. Screenshots are detected
   from the `kMDItemIsScreenCapture` metadata macOS writes on screenshots plus
   the localized screenshot naming conventions, so a renamed screenshot and a
   screenshot from another tool are both caught.
3. `CleaningPolicy` applies the mode and every exclusion: excluded folders and
   files, extensions, categories, name patterns, folders and packages (off by
   default), symlinks and aliases (always skipped), partial downloads and files
   modified in the last two seconds, and anything outside the Desktop.
4. `DestinationRouter` picks a folder per category. The default is
   `~/Documents/Robovac Cleanups/<date time>/`; each category can have its own
   folder instead.
5. `CleaningCoordinator` runs the session. For every target it first awaits the
   observer (the robot drives there and plays the suction animation), then
   `FileOperationService` re-checks the file's identity (inode, size,
   modification date) and moves it, choosing a free name if the destination is
   taken. The move is authoritative: the desktop icon disappears when Finder
   sees the move, never before.
6. Every move is written to `~/Library/Application Support/Desktop Robovac/history.json`
   immediately, so a session cut short by a crash or quit is marked
   "interrupted" at next launch and still undoable.

Pause stops the robot and holds the next file operation; Stop ends the session
after the current animation. Undo puts files back and refuses to overwrite
anything; on a collision you can choose to restore under a new name.

## The robot and the desktop

The overlay is a borderless transparent `NSWindow` placed one level above the
desktop icons (`kCGDesktopIconWindowLevel + 1`) and below all normal windows.
It ignores mouse events, never becomes key, joins every Space and stays out of
full-screen apps. One window covers the display that holds the menu bar, which
is the one Finder puts desktop icons on.

macOS has no supported API for reading where Finder draws each icon, and the
PRD rules out private Finder APIs and AppleScript as the primary mechanism.
`DesktopIconLayout` therefore reproduces Finder's default grid: columns filled
from the top-right corner, top to bottom, ordered the way Finder sorts the
desktop (date added by default, configurable in Settings › Appearance together
with the grid spacing). The robot drives to those approximate cells. This is an
approximation by design, and the settings say so.

`NavigationPlanner` orders targets into a lane-by-lane sweep from the right
edge, alternating direction, and routes each leg on a grid with breadth-first
search plus line-of-sight simplification whenever an excluded folder's icon is
in the way. `RobotMotionController` adds acceleration, braking, pivot turns,
an approach phase and the suction animation; it runs on a 60 Hz timer only
while the overlay is visible, so idle CPU is nil.

Trails (damp, sheen, tire marks, plus turning marks), dust, suction swirls
and the completion burst are drawn in one SwiftUI `Canvas` and expire after
the configured fade time. Reduced motion disables them and shortens the
animation.

Sounds are synthesized at first use (`ProceduralSoundSynth`), so there are no
audio assets; each event can be toggled individually and nothing plays at launch.

## Dock integration

Files cannot be stored in the Dock itself. Settings › General › "Add to Dock…"
explains how to drag the destination folder to the Dock as a stack, so cleaned
files are one click away.

## Status against the PRD

All MVP must-haves are implemented: menu bar app, scanning, preview with
counts and exclusion reasons, robot overlay with movement/turning/suction,
systematic sweep, Smart Clean / Screenshot Sweep / Gentle Clean, configurable
destinations per category, folder/extension/file/pattern exclusions, safe
moves, progress, pause/stop, history, undo, trail effects, sounds, persisted
settings and permission guidance.

Not covered yet: robot skins, cleaning schedules, multi-display robots, and a
Finder-accurate icon position source (none exists publicly).
