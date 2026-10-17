# Device-level protection: limits and Guided Access

## What the app controls

Inside LittleScreen, child mode has:

- no seeking, skipping, speed or volume UI (there is no player chrome at all);
- no autoplay of a next video;
- no recommendations, search, links, browser or share sheet;
- no way into the parent area without the three-finger gesture **and** the
  PIN (or an explicitly enabled Face ID / Touch ID);
- only the videos a parent imported, and only those whose file is present.

## What no normal iOS app can control

A regular App Store app cannot prevent a child from:

- swiping up (or pressing Home) to leave the app;
- opening Control Center or Notification Center;
- pressing the side / volume buttons, or triggering Siri;
- answering an incoming call or tapping a notification banner;
- turning the phone off.

LittleScreen does not claim otherwise, in the app or in this repository. The
three-finger gesture protects the app's *own* settings; it is not a kiosk
mode.

## Guided Access: the supported way to pin the phone to one app

Guided Access is Apple's built-in single-app mode. With it on, the Home
gesture and hardware buttons are ignored until a Guided Access passcode
(or Face ID) ends the session.

Set-up (iOS 17; menu names may differ slightly between versions):

1. Settings → Accessibility → Guided Access → on.
2. Passcode Settings → set a Guided Access passcode; optionally allow Face ID.
3. Open LittleScreen in child mode.
4. Triple-click the side button (Home button on older models) → Start.
5. To end: triple-click again → enter the passcode.

Useful options inside the Guided Access start screen: disable the volume
buttons, disable motion, set a time limit. Touch can be left enabled; the
app's own child mode handles what touches may do.

These instructions are shown in the app under Settings → Device protection
and summarised during onboarding.

## Evaluation notes

- The three-finger gesture still works inside a Guided Access session, so a
  parent can manage the library without ending Guided Access. Verify on the
  target device: Guided Access can be configured to ignore touch entirely.
- Screen Time's "Always Allowed" / app limits are not a substitute: they
  limit apps over time, they do not pin the phone to one app.
- Simulator testing is insufficient for this topic. Test the gesture,
  Guided Access, Airplane Mode playback, incoming-call interruption and
  low-storage behaviour on physical iPhones (small and large screens).
