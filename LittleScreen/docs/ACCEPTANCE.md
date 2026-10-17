# Acceptance criteria → implementation

PRD §7, with where each criterion is met and how to verify it on a device.

## Library

| Criterion | Where | Verify |
|---|---|---|
| Parent can import a supported local video | `VideoImporter`, `ParentDashboardView` (Add) | Add an H.264 MP4 from Files; it appears in the list |
| A thumbnail is displayed | `ThumbnailGenerator`, `ThumbnailImage` | Imported row and child tile show a frame |
| Child sees only the approved library | `LibraryStore.childVisibleItems`, `ChildLibraryView` | No other content, buttons or links in child mode |
| Library survives restart | `LibraryStore.save/load` (`library.json`) | Force-quit, relaunch |
| Parent can remove a video | swipe or `VideoDetailView` → Delete | Entry and file gone, storage summary drops |

## Playback

| Criterion | Where | Verify |
|---|---|---|
| Selecting a thumbnail starts the correct video | `ChildRootView` → `ChildPlayerView` | Tap tile |
| Plays full-screen | `PlayerLayerView`, status bar + home indicator hidden | — |
| No seek/skip controls | bare `AVPlayerLayer`, `PlayerController` has no seek API | — |
| Tapping does not reveal controls | touch shield in `ChildPlayerView` | Tap, double-tap, swipe during playback |
| Finishing does not start another video (default) | `actionAtItemEnd = .pause`, `CompletionView`; replay/next only if the parent enables them | Let a video end |
| Daily limit stops playback | `UsageTracker`, `TimeUpView` | Set a 15-minute limit, watch past it |
| Works in Airplane Mode | local files only | Enable Airplane Mode, play |

## Parent mode

| Criterion | Where | Verify |
|---|---|---|
| Gesture opens verification | `ParentGestureRecognizer` → `PINEntryView` | Hold 3 fingers ~1 s, in library and during playback |
| Wrong PIN does not grant access | `PINManager.verify`, lockout | 5 wrong entries → 30 s lock |
| Parent can manage library after verification | `ParentDashboardView` | — |
| Parent can return to child mode | "Child Mode" toolbar button; 2-min background timeout | — |

## Reliability

| Criterion | Where | Verify |
|---|---|---|
| Missing/corrupted media → recoverable error | `MediaAvailability`, `ChildErrorView`, `PlayerController.fail` | Delete the file via "Remove video file"; entry hidden from child, flagged for parent |
| Unsupported files rejected with a message | `ImportError` cases | Import a PDF renamed `.mp4`, a VP9 `.mp4` |
| Low storage handled | `VideoImporter.checkStorage`, `LibraryError.saveFailed` | Fill the device, import |
| No browser / feed from child mode | no WebKit, no `openURL`, no share sheet in child views | Code review |

## Device-level protection

| Criterion | Where |
|---|---|
| Limitations documented | `docs/DEVICE_PROTECTION.md`, onboarding, Settings → Device protection |
| Guided Access evaluated | same |
| App does not claim to prevent system exits | copy in `GuidedAccessHelpView` and onboarding |

## Automated tests

`LittleScreenTests` covers the library store (round-trip, availability,
delete/keep-entry/re-attach, corrupt file handling, reorder, thumbnails),
PIN hashing and verification, lockout escalation and persistence, importer
helpers, and that failed imports leave no files behind.

## On-device checklist before calling Phase 1 done

- [ ] Gesture reliability with one hand holding the phone (small and large iPhones)
- [ ] Gesture does not fire from a toddler's palm or two-finger grab
- [ ] Guided Access session + gesture + PIN flow
- [ ] Incoming call during playback: pauses, resumes correctly
- [ ] Backgrounding during playback: pauses, resumes on return
- [ ] Airplane Mode playback
- [ ] 1 GB+ file import: UI stays responsive, memory flat
- [ ] 100+ entries: library scroll smooth, thumbnails cached
- [ ] VoiceOver on child tiles and PIN pad
