# monkeysee: design note

monkeysee records short clips of app features for promotional sites. You
(or a language model) describe a clip as a small YAML script; monkeysee
opens the app's frontend in Chromium with themed demo content already in
it, plays the script with a visible cursor and an on-screen keystroke
display, and writes an mp4, webm or gif.

## Why drive the web frontend

Hush, Zotero Helper and Snorkle are Tauri apps: a web frontend in a native
shell. Recording the real native window would need a Mac, screen-capture
permissions and a way to script macOS input. Driving the frontend in
Chromium instead gives:

- deterministic, headless runs that work in CI or a cloud machine;
- exact control of window size and pixel ratio (2x by default, so clips
  are sharp on retina screens);
- a place to draw the cursor, keystrokes and captions on top of the page.

The cost is that anything the Rust side does (files, menus, native
windows, the menu-bar icon) has to be faked or left out. Hush is the easy
case: its frontend already falls back to `localStorage` when there is no
Tauri bridge. For apps that need the bridge, `src/tauri-mock.mjs` installs
a fake `window.__TAURI_INTERNALS__` whose `invoke` answers from handlers
the adapter supplies.

## Pieces

```
demos/*.yaml          what to show (one clip per file)
content/<pack>/       themed demo content (Moby-Dick, a whaling library)
src/apps/<app>.mjs    adapter: how to start, seed and describe an app
src/overlay.js        cursor, keystroke HUD, captions, title cards (injected)
src/runner.mjs        plays steps: cursor glides, human-paced typing, shortcuts
src/recorder.mjs      Chrome screencast frames -> ffmpeg
src/planner.mjs       plain-language request -> script, via the Claude API
src/cli.mjs           record | check | inspect | plan | fetch-content
```

**Adapters** hold everything app-specific: the dev-server command and URL,
a `seed` function that turns content items into the app's own storage
before the app boots, a `ready` check, optional Tauri IPC handlers, and a
`guide` (selectors and shortcuts) that is written for a model to read.
Adding Zotero Helper or Snorkle means writing one of these.

**Content packs** are folders with a `pack.yaml` and the files it lists:
Markdown for prose, JSON for structured data (the `library` pack is
CSL-JSON for Zotero demos). A pack item can carry a `fetch` recipe for the
full text; `monkeysee fetch-content` downloads it locally. Scripts refer to
items as `pack/item`, either to seed the app or as text to type
(`{content: moby-dick/chapter-1, paragraph: 2, words: 20}`).

**Keystrokes are visible** because every `press` step goes through the
overlay first: the HUD shows the keys in macOS order and symbols
(⌃⌥⇧⌘), with an optional label naming the feature, and only then is the
key pressed. The page is told it is on macOS (platform and user agent), so
apps show ⌘ and their `Mod-` shortcuts bind to Meta. The overlay lives in
a closed shadow root with pointer events off, so it never catches clicks.

**Recording** uses Chrome's screencast (frames are pushed as the page
repaints) rather than a screenshot loop, and a wall-clock ticker writes the
latest frame to ffmpeg at a fixed rate, so timing in the clip matches real
time. The window is launched at exactly the viewport size and pixel ratio,
because the screencast captures the window, not the emulated viewport.

**Typing** has a seeded rhythm (base rate from wpm, jitter, pauses after
punctuation), so a re-render looks the same and a diff in the script is
the only diff in the video.

## How a model writes clips

Two routes, both ending in a script file you can read and edit:

1. **In Claude Code (no API key).** Ask for a clip in this repo. Claude
   runs `monkeysee inspect --app hush` to get a screenshot, the
   accessibility tree and a list of clickable elements with selectors,
   writes `demos/<name>.yaml`, runs `monkeysee check` (all steps fast, no
   video) until it passes, then `monkeysee record`. CLAUDE.md tells it
   how.
2. **`monkeysee plan "<what to show>" --app hush`.** The same loop through
   the Claude API: the model gets the script format, the adapter's guide,
   the content packs, and a screenshot and element list of the app as it
   starts; it answers with YAML, which is validated and dry-run against
   the real app; failures (with a screenshot of the moment) go back to it
   for up to two fixes. Needs `ANTHROPIC_API_KEY`.

The dry run matters: a model's first guess at a selector is often wrong,
and `check` turns that into an error message in seconds instead of a
broken minute-long render.

## What's there and what isn't

Working: the Hush adapter, a fixture app for testing without any of your
repos, the overlay, recording to mp4/webm/gif at 2x, the `check` and
`inspect` commands, Moby-Dick and whaling-library packs, the sample clip
`demos/hush-moby-dick.yaml`.

Not yet tried: the `plan` command against the API (written to the current
SDK, never run here); adapters for Zotero Helper and Snorkle.

Known limits:

- macOS's own text-editing keys in plain `<textarea>`/`<input>` fields
  (⌘← to line start, ⌘↓ to the end) don't act, because the browser runs
  on Linux. App shortcuts and editors that bind keys themselves
  (CodeMirror) are fine. Use a `silent` press of the Linux key for setup.
- Native-only features can't be shown: menus, the menu-bar popover,
  global hotkeys, multiple native windows, iCloud sync.
- The prototype's Moby-Dick pack carries the opening three paragraphs of
  chapter 1; `fetch-content` pulls the full chapter from Project Gutenberg
  on a machine that can reach it.

## Open questions

- **Zotero Helper and Snorkle.** Both call many Tauri commands
  (`load_file`, `get_settings`, `list_files`, `update_zotero_item`, …).
  Each adapter needs handlers that return plausible data from a content
  pack. Is it better to mock at the IPC layer (current approach), or to
  add a small "demo mode" inside each app that the apps own?
- **Camera moves.** Zooming into the part of the screen that matters
  (common on product sites) could be a post-processing step driven by the
  same script, e.g. `zoom: .cm-line`.
- **Framing.** Clips are the bare app. A window frame (title bar, shadow)
  and a background could be composited by ffmpeg for site use.
- **Sound.** Key clicks or music would be a mixing step after recording.
- **Where clips live.** The promotional sites could build their clips from
  these scripts in CI, so clips stay current with the apps.
