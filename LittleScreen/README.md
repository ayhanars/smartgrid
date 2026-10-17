# LittleScreen

A parent-controlled video player for iPhone. Parents import videos from the
Files app; children get a grid of big pictures, tap one, and watch it
full-screen with no controls, no autoplay, no recommendations and no links.
Everything works offline.

This directory is a self-contained native iOS project (Swift 5.9, SwiftUI,
AVFoundation, iOS 17+). It implements **Phase 1 — Local-Only MVP** of the
product requirements document.

## Build and run

The Xcode project is generated from `project.yml` with
[XcodeGen](https://github.com/yonaskolb/XcodeGen), so there is no `.xcodeproj`
to keep in sync.

```bash
brew install xcodegen
cd LittleScreen
xcodegen generate
open LittleScreen.xcodeproj
```

Then in Xcode: pick your team under *Signing & Capabilities* (change the
bundle identifier `com.example.littlescreen` to your own), choose a simulator
or a connected iPhone, and run. Unit tests run with ⌘U or:

```bash
xcodebuild -project LittleScreen.xcodeproj -scheme LittleScreen \
  -destination 'platform=iOS Simulator,name=iPhone 16' test
```

CI (`.github/workflows/littlescreen-ios.yml`) does exactly this on a macOS
runner whenever files under `LittleScreen/` change.

Testing on a **physical iPhone** matters for this app: the three-finger
gesture, Guided Access and Airplane-Mode playback cannot be judged in the
simulator.

## How it works

### Two modes, one gate

| | Child mode (default) | Parent area |
|---|---|---|
| Entered by | app launch, "Child Mode" button, inactivity | three-finger hold → PIN (or Face ID) |
| Can see | approved videos whose file is present | every entry, availability, storage |
| Can do | tap a tile, watch, go back | import, rename, re-thumbnail, delete, settings |

- **Parent gesture**: hold three fingers anywhere for about a second
  (`ParentGesture` in `Features/Shared/ParentGestureRecognizer.swift`). It is a
  window-level `UILongPressGestureRecognizer`, so it works on every screen,
  including during playback, without stealing normal taps.
- **The gesture only opens the PIN screen.** The PIN screen cancels itself
  back to child mode after 45 s without input, so an accidental trigger does
  nothing. Five wrong PINs lock the pad for 30 s, doubling each time
  (`LockoutPolicy`).
- **PIN storage**: salted, iterated SHA-256 in the Keychain
  (`PINManager`, `KeychainStore`). The PIN is never stored. Face ID / Touch ID
  is an optional convenience toggle; the PIN always remains the fallback.
- The parent area returns to child mode by itself if the app sits in the
  background for more than two minutes.

### Playback with nothing to fiddle with

`ChildPlayerView` draws a bare `AVPlayerLayer` (not `VideoPlayer` or
`AVPlayerViewController`), so there are no controls to hide and nothing a tap
can reveal. `PlayerController` has no seek API at all. `actionAtItemEnd` is
`.pause`; nothing ever autoplays. The screen stays awake during playback.

Ways out of a video, all deliberate:

1. the video ends → an "All done" screen with one big button (or, by setting,
   straight back to the library);
2. a one-finger hold of 1.5 s reveals a single Back button for 4 s (parents
   can turn this off in Settings);
3. the parent gesture.

Interruptions (calls, Siri), backgrounding and playback failures are handled;
the child sees at worst a friendly "Oops" screen with a Back button.

### Import and storage

- `VideoImporter` validates before copying: file type, iCloud download
  (coordinated read), free space with a 200 MB headroom, then AVFoundation
  inspection (has a video track, codec is H.264 or HEVC, `isPlayable`).
  Unsupported or damaged files are rejected with a message that says what to
  do instead.
- Files are copied with `FileManager.copyItem` (streams in the kernel; clones
  on APFS), so large files never enter memory.
- Thumbnails are generated from the app's own copy; a parent can later pick a
  different frame or a photo.
- Data lives under *Application Support/LittleScreen*: `library.json`
  (metadata, atomic writes), `Media/` (excluded from backup; re-importable)
  and `Thumbnails/`. A damaged `library.json` is set aside, never overwritten.
- A library **record** and its **media file** are distinct. Missing or
  unreadable files are hidden from the child, flagged for the parent, and can
  be re-attached with "Import the video file again" without losing the title
  or thumbnail.

### Layout

```
LittleScreen/
  App/              LittleScreenApp, AppModel (mode machine), AppSettings, RootView
  Models/           VideoItem, MediaAvailability, ImportError, LibraryError
  Services/
    Storage/        AppPaths, MediaStore (files), LibraryStore (library.json)
    Import/         VideoImporter, ThumbnailGenerator, ImportSession
    Security/       PINManager + PINHasher + LockoutPolicy, SecretStore/Keychain, BiometricAuth
    Playback/       PlayerController (AVPlayer state machine)
  Features/
    Child/          ChildRootView, ChildLibraryView, ChildPlayerView, PlayerLayerView
    Parent/         OnboardingView, PINEntryView, PINSetupView, ParentDashboardView,
                    VideoDetailView (+ FramePickerView), SettingsView (+ Guided Access help)
    Shared/         ParentGestureRecognizer, ThumbnailImage/Cache, PINPadView, BigChildButton, ChildTheme
LittleScreenTests/  LibraryStore, PIN/lockout, importer helpers
docs/               DECISIONS.md, DEVICE_PROTECTION.md, ACCEPTANCE.md
```

## Documents

- [docs/DECISIONS.md](docs/DECISIONS.md) — answers to the PRD's open questions and why.
- [docs/DEVICE_PROTECTION.md](docs/DEVICE_PROTECTION.md) — what the app can and cannot block, Guided Access.
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) — PRD acceptance criteria mapped to code, and the on-device checklist.

## Not in this phase

Remote URLs, streaming, downloads with progress, cloud sync, playlists and
YouTube are out of scope for Phase 1 by design (PRD §1.4, §6, §8). The
record/file split, `MediaAvailability` and `ImportSession` are the seams
where Phase 2 downloads plug in.
