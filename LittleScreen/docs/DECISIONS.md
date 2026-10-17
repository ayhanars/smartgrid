# Decisions for the Phase 1 MVP

The PRD (§9) lists five decisions to confirm before implementation. These are
the choices built into this codebase, each easy to revisit.

## 1. Local files only, or also direct streaming URLs?

**Local files only.** Phase 1 validates the viewing experience without a
network. The data model already separates a library record from its media
file (`VideoItem` + `MediaAvailability`), so a Phase 2 "remote source" is a
new way of producing a media file, not a redesign.

## 2. Import exclusively through the Files app, or also pasted media URLs?

**Files app only** (`.fileImporter`, `UTType.movie`). Pasting URLs invites
YouTube links, which the PRD rules out as generic media. URL import belongs
with Phase 2 download management (progress, retry, cancel, integrity).

## 3. PIN only, or Face ID too?

**PIN is required; Face ID / Touch ID is an optional shortcut.**
The PIN is the thing a child cannot have; biometrics are a convenience for
the parent. The system fallback to the device passcode is disabled
(`localizedFallbackTitle = ""`) because a toddler may well have watched that
passcode being typed. Biometric unlock is off by default and enabled in
Settings.

## 4. After a video ends: back to the library, or hold the last frame?

**Hold the last frame under an "All done" screen with one big button**
(default). Settings also offer: straight back to the library, replay the same
video, or play the next one. The automatic options exist because parents
asked for them; they are off by default, are never chosen by the child, and
stop when the daily limit is reached.

## Daily limit

Parents can cap how long videos play per day (off by default). Only actual
playback time counts, so browsing the grid does not eat the allowance. The
child sees a friendly "all done for today" screen; the parent can add 15
minutes for today or reset the day. The limit lives in the app, not in
Screen Time, so it works without any iOS configuration.

## 5. Is Guided Access acceptable as the optional system-level safeguard?

**Yes, and it is the only honest answer.** No third-party app can stop the
Home gesture, Control Center or the side button. The app documents this in
onboarding and in Settings → Device protection, with step-by-step Guided
Access instructions. See `DEVICE_PROTECTION.md`.

## Other choices worth knowing

- **Gesture**: three-finger hold, ~1 s, window-level recogniser. Two fingers
  are too easy for a child to land by accident; four are awkward to place on
  a phone. Must be validated on hardware with the parent's actual grip.
- **Accidental gesture is harmless**: it only opens the PIN screen, which
  returns to child mode after 45 s without input.
- **Lockout**: 5 free attempts, then 30 s, 60 s, 120 s … up to 15 min.
  State survives restarts (kept in the Keychain next to the PIN hash).
- **Codec whitelist**: H.264 and HEVC video. Anything else is rejected at
  import with a "re-export as H.264 MP4" message rather than failing later
  in front of the child. Audio is validated indirectly through
  `AVAsset.isPlayable`.
- **Storage headroom**: an import must leave 200 MB free.
- **Metadata store**: a single JSON file with atomic writes instead of
  SwiftData/Core Data. It is enough for hundreds of entries, trivially
  inspectable, and has no migration machinery to get wrong in an MVP.
- **Media excluded from backup**: videos are large and re-importable; the
  metadata file is small and stays backed up.
- **Minimum iOS 17**: for `@Observable`, `ContentUnavailableView`,
  two-parameter `onChange`, and the async `AVAssetImageGenerator` API.
- **No analytics, no network code, no URL schemes, no document sharing** are
  declared, so there is no in-app route to anything outside the library.
