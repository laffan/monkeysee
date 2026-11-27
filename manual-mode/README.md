# monkeysee, manual mode

A Mac app for recording feature clips by hand. A frame sits on screen at
the size of the site's clips (1280 × 800 points, which is 2560 × 1600 on
a Retina screen) with a sidebar of feature buttons attached to it. Click a
feature, a countdown runs, and everything inside the frame is recorded
until you press Stop. Then you trim the clip and it's saved under the
feature's name.

Agent mode (scripted clips recorded in Chromium) is in `../agent-mode`.

> Not built or run yet: this was written without a Mac. Expect to fix a
> compile error or two on the first build.

## Build and run

Needs macOS 14 or later and Xcode 16 or later.

1. Open `manual-mode/MonkeySee.xcodeproj` in Xcode.
2. Select the MonkeySee target > Signing & Capabilities and pick your Team
   (a free personal team is fine). See "Permissions" for why.
3. Press Run (⌘R). The frame and sidebar appear on the main screen.

The app isn't sandboxed (it has to move other apps' windows) and uses the
hardened runtime.

## Permissions

macOS asks for two:

- **Screen Recording** (Privacy & Security > Screen & System Audio
  Recording). Asked the first time you click a feature. Turn monkeysee on,
  then quit and reopen it; macOS only applies this on relaunch.
- **Accessibility** (Privacy & Security > Accessibility). Asked the first
  time you click Target window. Needed to move and resize other apps'
  windows, and to let Esc cancel target mode.

The sidebar shows a warning with an Allow button while either is off.

macOS remembers these by the app's code signature. With "Sign to Run
Locally" (no Team) the signature changes on every build, and the switches
can look on but stop working. Picking a Team keeps it stable. If it
happens anyway, remove monkeysee from both lists with the minus button and
add it again.

## Using it

- **The frame.** Drag the blue strip on top to move it. Drag the thin
  borders, the strip's ends or the grip at the bottom right to resize it.
  The size shows in the strip and in the sidebar's Frame fields, where
  you can type one; Reset goes back to 1280 × 800. The frame is drawn
  just outside the recorded area, and the inside is left empty, so you
  can click and type in the app underneath.
- **Target window.** Click it, then click the app's window: that window is
  moved and resized to fill the frame exactly, title bar included. Esc or
  Cancel targeting stops. Some apps have a minimum or maximum window size;
  the sidebar says so when the window didn't fit. Windows in full screen
  can't be moved.
- **Projects.** One project per app you film, each with its own feature
  buttons. The ⋯ menu adds, renames and deletes projects and sets the
  output folder.
- **Features.** Type a name under the list and press Return. Click a
  feature to record it. Right-click for Rename, Move up, Move down and
  Delete; you can also drag to reorder.
- **Recording.** The countdown (3 seconds by default, 0 to 10) shows over
  the frame. The app you were using is brought forward first so its
  window looks active. The frame turns red while recording; press Stop in
  the sidebar. The frame can't be moved during a take.
- **Trimming.** A window opens with the clip and AVKit's trim bar. Drag
  the yellow handles and press Trim to save the trimmed clip, or Cancel
  and then Save to keep the whole clip. Discard deletes it.

## Defaults

- Clips go to `~/Movies/monkeysee/<project>/<feature>.mp4`, with names
  lowercased and dashed ("Focus Modes" becomes `focus-modes.mp4`). An
  older clip with the same name goes to the Trash.
- H.264 mp4, constant 30 fps, at the screen's pixel scale: 2560 × 1600 on
  Retina, 1280 × 800 on a 1x screen. This matches agent mode's clips.
- The cursor is recorded. monkeysee's own windows (frame, sidebar,
  countdown) are left out of the capture even if they overlap the frame.
- No audio.
- A trimmed clip is re-encoded at the highest quality preset so the cut
  lands on the exact frame; an untrimmed clip is saved as recorded.
- The frame must sit fully on one screen. If there's no room for the
  sidebar beside the frame, it's pinned to the screen's edge and may
  cover part of the frame; it still isn't in the clip.

Projects, features, the countdown, the output folder and the frame's
position are kept in the app's preferences.

## Code

```
MonkeySee/
  main.swift, AppDelegate.swift   start-up and the menu bar
  AppController.swift             ties the parts together; the sidebar calls it
  AppModel.swift                  projects, features, settings (saved in UserDefaults)
  SidebarView.swift               the sidebar (SwiftUI)
  BoundaryController.swift        the frame: edge windows, move and resize
  Panels.swift                    the floating, non-activating windows used for both
  Countdown.swift                 the 3, 2, 1 overlay
  Recorder.swift                  ScreenCaptureKit stream to AVAssetWriter
  TrimWindowController.swift      AVPlayerView trimming and saving
  WindowTargeter.swift            target mode (Accessibility API)
  Permissions.swift, Geometry.swift
  Assets.xcassets/AppIcon         the app icon, resized from ../app-icon.jpg
```

The project uses a synchronized folder (Xcode 16): any Swift file added to
`MonkeySee/` is part of the target without editing the project file.
