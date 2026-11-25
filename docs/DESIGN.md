# monkeysee: design note

monkeysee records short clips of app features for promotional sites. You
describe a clip in plain words at the top of a YAML file (the feature, the
state the app starts in, the beats); a language model writes the steps
that play it under that; monkeysee opens the app's frontend in Chromium
with themed demo content already in it, brings it to the starting state
off camera, plays the steps with a visible cursor and an on-screen
keystroke display, and writes an mp4, webm or gif.

## Why drive the web frontend

Hush, Zotero Helper and Snorkle are Tauri apps: a web frontend in a native
shell. Recording the real native window would need a Mac, screen-capture
permissions and a way to script macOS input. Driving the frontend in
Chromium instead gives:

- deterministic, headless runs that work in CI or a cloud machine;
- exact control of window size and pixel ratio (2x by default, so clips
  are sharp on retina screens);
- a place to draw the cursor and keystrokes on top of the page.

The cost is that anything the Rust side does (files, menus, native
windows, the menu-bar icon) has to be faked or left out. `src/tauri-mock.mjs`
installs a fake `window.__TAURI_INTERNALS__`; its `invoke` calls go to a
backend object the adapter supplies, which runs in Node. For Hush that is
`adapters/hush-backend.mjs` in the tools.natelaffan.com workspace, an in-memory file store answering the ~20
commands the frontend uses (settings, the file tree, loading and saving
files, creating notebooks), so desks, the sidebar, notebooks and panes all
work. Hush's own `localStorage` fallback can't make notebooks, which is why
it isn't used.

## Pieces

In this repo (the tool):

```
src/workspace.mjs     finds the workspace (monkeysee.json) and its folders
src/apps/fixture.mjs  the built-in notepad adapter; other adapters load from the workspace
content/moby-dick/    sample pack for the fixture
src/overlay.js        cursor and keystroke HUD (injected)
src/runner.mjs        plays steps: cursor glides, drags, human-paced typing, shortcuts
src/recorder.mjs      Chrome screencast frames -> ffmpeg
src/planner.mjs       spec -> script, via the Claude API
src/cli.mjs           record | check | inspect | plan | fetch-content
```

In a workspace (for example `demos/` in tools.natelaffan.com):

```
monkeysee.json        marks the workspace; adapters, content and output paths
adapters/<app>.mjs    adapter: how to start, seed and describe an app
content/<pack>/       themed demo content (Moby-Dick, the Pequod, a whaling library, a shoreline web)
<app>/*.yml           one clip per file: spec on top, script below
```

**Adapters** hold everything app-specific: the dev-server command and URL,
a `ready` check, a Tauri backend (or a `seed` function for apps that keep
data in the browser), and a `guide` (selectors, shortcuts, how to reach
common states) that is written for a model to read.
Adding an app means writing one of these in the workspace.

**Content packs** are folders with a `pack.yaml` and the files it lists:
Markdown for prose, JSON for structured data (the `library` pack is
CSL-JSON for Zotero demos; the `pequod` pack is a Hush desk: four notes in
the Inbox and a chapter project with five section files and a notebook with
a crew flowchart and two notes). An item's `in:` puts it in Hush's Inbox or
in a project of that name. A pack item can carry a `fetch` recipe for the
full text; `monkeysee fetch-content` downloads it locally. Scripts refer to
items as `pack/item`, either to seed the app or as text to type
(`{content: moby-dick/chapter-1, paragraph: 2, words: 20}`).

**Keystrokes are visible** because every `press` step goes through the
overlay first: the HUD shows the keys in macOS order and symbols
(⌃⌥⇧⌘), and only then is the key pressed. Keys held through a drag
show the same way. Setup steps run before recording, so their keys
never show. The page is told it is on macOS (platform and user agent), so
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

The person writes the spec half of the file. The model writes `content`
and `setup` (to reach the stated state) and `steps` (one group per beat)
under it, and both routes end with the script in the same file, where it
can be read and edited:

1. **In Claude Code (no API key).** Ask for the spec to be scripted.
   Claude runs `monkeysee inspect --app hush` to get a screenshot, the
   accessibility tree and a list of clickable elements with selectors,
   writes the script, runs `monkeysee check` (setup and steps fast, no
   video) until it passes, then `monkeysee record` and looks at frames.
   CLAUDE.md tells it how.
2. **`monkeysee plan hush/10-panes.yml`.** The same loop through the
   Claude API: the model gets the file format, the adapter's guide, the
   content packs, a screenshot and element list of the app at launch, and
   the spec; it answers with YAML, which is validated and dry-run against
   the real app; failures (with a screenshot of the moment) go back to it
   for up to two fixes. The result is written under the spec. Needs
   `ANTHROPIC_API_KEY`.

The dry run matters: a model's first guess at a selector is often wrong,
and `check` turns that into an error message in seconds instead of a
broken minute-long render. It doesn't catch a step that runs but shows the
wrong thing (a pane showing an empty part of its canvas), so the frames
still need a look.

## What's there and what isn't

Working: workspaces (adapters, packs and clips kept outside this repo),
a fixture app for testing without any of your repos, the overlay,
recording to mp4/webm/gif at 2x, and the `check` and `inspect` commands.
The tools.natelaffan.com workspace has Hush and Snorkle adapters on fake
backends, their packs, and the Hush and Snorkle clip series.

Not yet tried: the `plan` command against the API (written to the current
SDK, never run here); an adapter for Zotero Helper.

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

- **Zotero Helper.** It calls many Tauri commands
  (`load_file`, `get_settings`, `list_files`, `update_zotero_item`, …).
  Its adapter needs handlers that return plausible data from a content
  pack. Is it better to mock at the IPC layer (current approach), or to
  add a small "demo mode" inside each app that the apps own?
- **Camera moves.** Zooming into the part of the screen that matters
  (common on product sites) could be a post-processing step driven by the
  same script, e.g. `zoom: .cm-line`.
- **Framing.** Clips are the bare app. A window frame (title bar, shadow)
  and a background could be composited by ffmpeg for site use.
- **Sound.** Key clicks or music would be a mixing step after recording.
- **Building clips in CI.** A workspace's site could re-record its clips
  in CI, so clips stay current with the apps.
