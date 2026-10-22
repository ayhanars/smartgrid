# Design brief: Desktop Robovac UI

You are designing the user interface of **Desktop Robovac**, a native macOS menu bar app. A small animated robot vacuum lives in the menu bar; when the user starts a cleaning it drives across the desktop, "vacuums" files and moves them into a folder (or the Trash). The interface exists today and works, but its text, casing, control styles and spacing grew piece by piece and are inconsistent. Your job is to produce one coherent design system and redesign the screens below, keeping every function that exists.

Deliver the result as Figma frames (or HTML mockups if Figma is unavailable) plus a written spec that a developer can implement in SwiftUI. Do not invent new features; do propose better wording, grouping and hierarchy.

## Product feel

Premium, playful, tactile. Think of a well-made gadget companion app (the Roborock app's mode tabs and pill-shaped option rows are the reference the owner likes), but it must still feel at home on macOS: system fonts, SF Symbols, native light and dark appearance, vibrancy behind the popover, 13 pt body text, restrained colour. One accent colour (system blue) for selection and primary actions; green only for "clean/done", orange for warnings, red for destructive.

## Constraints (hard)

- macOS 14, SwiftUI. Everything must be buildable with SwiftUI views; custom-drawn controls are fine, bitmaps are not.
- The popover is a menu bar panel, 340 pt wide, height grows with content. No scrolling of the whole popover; individual rows may scroll horizontally.
- Settings is a standard macOS Settings window, 560 × 520 pt, with tabs in the toolbar.
- Icons: SF Symbols only, except the five route glyphs and the four droplet glyphs, which are custom line icons (keep them, you may refine them).
- Must work in light and dark mode and with the system accent colour.
- All copy in sentence case except proper nouns. Define one rule for button labels and apply it everywhere.

## Screen 1: menu bar popover

Current structure, top to bottom. Keep every element; regroup and restyle as you see fit.

1. **Hero card** with the live robot (54 pt), app name, one status line, and a tiny build label. The card colour today encodes state: grey idle, green "spotless", orange "can't read the Desktop", blue while cleaning or on a test drive.
   Status line examples: "Spotless. Nothing to clean.", "6 items waiting · a little dusty", "Scanning the Desktop…", "Vacuuming · Screenshot 2026-10-21 at 14.02.11.png", "Test drive: driving".
2. **Three stat tiles**: To clean (count), Cleaned (count this run), Sessions (count).
3. **Progress** while cleaning: bar, "Collecting <file name>", "3/12".
4. **Notices** (shown only when relevant, each with small actions):
   - Can't read the Desktop → "Open Privacy Settings", "Try Again".
   - "The last cleaning was interrupted after moving N files." → "Undo It", "Dismiss".
   - "N restored, M could not go back." with up to three conflict lines → "Restore With New Names".
   - "New files spotted. Auto-cleaning in 8s…" → "Clean Now", "Not Now".
5. **Result line** after a run: "Done: 6 moved, 1 skipped", and "Left alone by your rules: 2 folders, 1 alias" with a "Why?" button that opens the preview.
6. **Mode tabs** (horizontal text tabs, selected one bold with a blue check): Smart Clean, Screenshot Sweep, Gentle Clean. Below: one-line description of the selected mode.
7. **Route row**: header "Route  Standard" (value in accent colour) and a pill control with five glyph buttons: Quick, Standard, Deep (serpentines of increasing density), Explore (zigzag), Direct (arrow).
8. **Mop trail row**: header "Mop trail  Medium", pill with four droplet glyphs: Off, Low, Medium, High.
9. **Destination row**: header "Destination  Robovac Cleanups" (or "Trash"), a small switch "Always send to Trash", and a button "Move All to Trash" (asks for confirmation).
10. **Primary actions**: idle → big "Start Cleaning" plus "Preview"; cleaning → "Pause"/"Resume" plus "Stop"; test drive → "Stop Test Drive".
11. **Footer** icon buttons: Undo Last Cleaning, Test Drive, Settings, Quit.

Known inconsistencies to resolve: three different selector styles (tabs, pills, segmented) with no rule for when each is used; mixed label casing ("Move All to Trash" vs "Always send to Trash" vs "Clean Now"); some rows have headers and some do not; stat tiles use a different surface than the option rows; icon-only footer next to fully labelled buttons; descriptions vary from one line to three.

## Screen 2: Settings window (5 tabs)

- **General**: Launch at login; Show the robot on the desktop; Desktop folder (path, Choose…, Use Default); Default cleaning destination (path, Choose…, Show in Finder, Add to Dock…); "Put each run in a dated session folder"; "Show a preview before every cleaning"; permissions note and "Open Files and Folders Privacy Settings".
- **Cleaning**: Cleaning mode picker with description; Destination: "Send collected files to the Trash instead of a folder"; Automatic cleaning: toggle + "Wait N s before starting" slider; File categories: eight rows (Screenshots, Images, PDFs, Documents, Videos, Audio, Archives, Other files), each with an on/off switch and a per-category folder ("Default destination" / Choose Folder… / Use Default); Excluded folders (list, Add Folder…, Remove); Excluded files (list, Add File…); Excluded extensions (chips, text field, Add); Excluded name patterns (chips, text field, Add); Folders and packages: "Also move folders", "Also move packages".
- **Appearance**: live robot preview with Test Drive, Copy Diagnostics and the build label; Colour (White / Graphite); Robot size slider; Movement speed slider; Movement: route picker (five options with description) and "Explore up to N s per file" slider; Robot layer (In front of windows / Behind windows, above desktop icons); Trail: style (Damp trail / Cleaned sheen / Tire marks / No trail), opacity, fade duration; Effects: particles, animation intensity, reduced motion; Finding the icons: "Ask Finder for exact icon positions"; Desktop icon grid (fallback): sort order, column width, row height.
- **Sound**: Enable sound; Volume; Continuous motor hum; Occasional wheel noise; Suction intensity; completion sound; eight sound events each with a switch and a Play button.
- **History**: list of sessions (date, mode, status, moved/skipped/failed counts, Undo button) expanding to the file list with original → destination paths; "Clear History…".

## Screen 3: Cleaning preview window (560 × 620)

Header with robot, title, "N items will be moved · M left alone · Smart Clean", and the safety line "Files are moved, never deleted. Every run can be undone." Then three sections: Will be moved (grouped by category, each row file name + destination folder), Destinations (folder paths with Show), Left alone (file + reason, e.g. "Folder (folders are left alone)", "Still being written"). Footer: "Show this preview before every run" checkbox, Cancel, Start Cleaning.

## Screen 4: Add to the Dock guide (460 wide)

Three numbered steps explaining how to drag the destination folder into the Dock as a stack, the folder path, and a "Reveal in Finder" button.

## Deliverables

1. **Tokens**: type scale (title, body 13 pt, caption, micro), spacing scale, corner radii, surface colours for light and dark, state colours, and the accent usage rule.
2. **Component library**: hero card (4 states), stat tile, notice (4 variants), text tab strip, pill picker (with the custom glyphs), option row header, primary/secondary/destructive buttons, footer icon button, settings row patterns (toggle row, path row with actions, slider row, chip list, category row).
3. **Copy table**: every label, header, description and button in the app, final wording, with the casing rule stated once.
4. **Screens**: the popover in idle, cleaning, paused, finished (with "left alone" line), error, and auto-clean countdown states; all five Settings tabs; the preview window; the Dock guide. Light and dark for the popover at least.
5. **Spec notes** for the developer: sizes in points, which SF Symbol each icon uses, and anything that differs from a stock macOS control.

Please keep the robot illustration and the desktop animation out of scope; they are drawn separately and are not part of this brief.
