# Demo file format

One YAML file per clip, in `demos/<app>/<feature>.yml`. The top half is a
spec a person writes: what the clip is about, the state the app starts in,
and the beats in order. The bottom half is the script that plays it, written
from the spec by a model (`monkeysee plan`, or Claude Code following
CLAUDE.md) and editable by hand.

```yaml
feature: panes                 # what the clip is about; names the output file
state: left sidebar open, ten demo text and notebook files
description:                   # the beats, in order
  - working on text document
  - open notebook with flowchart and notes as a pane
  - dock pane to right
  - drag a note from notebook into document

# Script (written from the spec above; edit freely) ------------------------
content: [pequod/*]            # what the app is seeded with
setup:                         # brings the app to `state`; runs fast, not recorded
  - press: Meta+Backslash
  - click: "text=\"Ishmael outside\""
steps:                         # recorded, one group per beat
  - type: " He is also the only one left to tell it."
    note: working on text document
  - press: Meta+Shift+O
    note: open notebook as a pane
  ...
```

A file with only the top half is a spec waiting to be scripted: `record`
and `check` refuse it and say so.

**Spec keys.** `feature` (defaults to the file name), `state`,
`description` (a list of beats), and `app`, which can be left out when the
file sits in `demos/<app>/`.

**Script keys.** `content` (pack items to seed; `pack/*` seeds a whole
pack), `setup` and `steps` (lists of steps, below), and optionally:
`output` (default `out/<app>-<feature>.mp4`; `.mp4`, `.webm` or `.gif`, or
a list to render several), `viewport` (CSS pixels, default
`{width: 1280, height: 800}`), `scale` (device pixel ratio, default 2, so
2560x1600 video), `typing` (`{wpm: 80}` by default), `overlay`
(`{hudTheme: dark | light, cursor: true | false}`), `platform` (`mac`, the
default, makes the page report macOS so apps show ⌘ and `Meta` shortcuts
work; `linux` turns that off), `colorScheme` (`light` or `dark`), `fps`
(30), `lead` and `tail` (milliseconds held before the first and after the
last step), `appOptions` (passed to the adapter, e.g. `settings` for Hush).

The clip shows only the app, the cursor and the keystroke HUD. There are no
captions, title cards or labels.

## Steps

Each step is a mapping with exactly one action. Any step may also carry a
`note:`; it is printed while recording and otherwise ignored. Planned
scripts put the beat's words in the note of its first step.

| Step | Short form | Long form | What it does |
|---|---|---|---|
| `wait` | `wait: 800` | | Pause, in milliseconds |
| `click` | `click: <selector>` or `click: [x, y]` | `{selector, double: true}` | Cursor glides to the element (or to that point in the 1280×800 viewport) and clicks. A point is for spots no element marks, like the end of a line |
| `move` | `move: <selector>` or `move: [x, y]` | | Cursor glides to the element or point |
| `drag` | | `{from, to, keys, duration: 900}` | Presses on `from`, glides to `to`, releases; each is a selector or `[x, y]`. `keys` (e.g. `Meta`) are held through the drop and shown in the HUD |
| `type` | `type: "text"` | `{text \| content, paragraph, words, into, wpm}` | Types at a human pace (rhythm is the same on every render) |
| `paste` | `paste: "text"` | `{text \| content, paragraph, words, into}` | Inserts text at once; the HUD shows ⌘V |
| `press` | `press: Meta+S` | `{keys, times, hold, silent}` | Shows the keys in the HUD, then presses them; `silent: true` presses without showing (presses in `setup` never show). With `times`, repeats are quick taps, so `{keys: Shift, times: 3}` works as a triple tap |
| `scroll` | `scroll: 400` | `{by: px or [dx, dy], at, selector, duration: 900}` | Smooth mouse-wheel scroll with the cursor over `at` (or where it is); `selector` sets that element's scrollTop instead |
| `waitFor` | `waitFor: <selector>` | `{selector, state, timeout}` | Waits for an element without showing anything |
| `eval` | `eval: "js"` | | Runs JavaScript in the page; hand-written scripts only |

Setup steps run at full speed before recording starts, so nothing they do
is seen; keys pressed there don't show.

**Selectors** are Playwright selectors: CSS (`.cm-content`,
`input[placeholder='Type a command…']`), text (`text=Focus mode`), or CSS
with `:has-text("…")`. The first visible match is used.

**Keys** use Playwright names joined by `+`: `Meta+S`, `Meta+Shift+W`,
`Alt+Meta+ArrowRight`, `Meta+Backslash`, `Escape`, `Enter`. `Meta` is ⌘
and shows as ⌘ in the HUD; `Alt` shows as ⌥, `Control` as ⌃, `Shift` as ⇧.

Shortcuts the app itself handles work as on a Mac. macOS's own text-editing
keys in plain text fields (⌘← to the start of a line, ⌘↓ to the end of a
textarea) do not, because the browser runs on Linux; editors that bind them
themselves, like CodeMirror, are fine. For a native field, move the caret
with `{keys: Control+End, silent: true}` instead.

**Content** in `type` and `paste` steps can come from a pack instead of
inline text: `{content: moby-dick/chapter-1, paragraph: 2, words: 30}`
takes the first 30 words of the second paragraph (the heading is not
counted). `paragraphs: 2` takes the first two paragraphs.

## Pacing

Typing is the slow part: 80 wpm is about 6–7 characters a second, so a
40-word sentence takes about 30 seconds. Type a sentence or two to show
that the editor is live, and seed or `paste` anything longer. After a step
that changes the screen, wait 800–2000 ms so a viewer can see the result.
