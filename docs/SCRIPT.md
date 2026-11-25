# Demo script format

A demo script is a YAML file that describes one clip. monkeysee opens the
app in Chromium with the script's content seeded, starts recording, plays
the steps, and writes the video.

```yaml
app: hush                      # an adapter in src/apps/ (hush, fixture)
title: Focus Mode in Hush      # for your own reference
output: out/hush-focus.mp4     # .mp4, .webm or .gif; a list renders several
content:                       # seeded into the app before recording
  - moby-dick/chapter-1        # "pack/item" from content/
viewport: { width: 1280, height: 800 }   # CSS pixels (default 1280x800)
scale: 2                       # device pixel ratio; 2 gives a 2560x1600 video
typing: { wpm: 80 }            # typing speed for type steps
overlay: { hudTheme: dark }    # keystroke HUD: dark or light; cursor: false hides the cursor
steps:
  - caption: Hush keeps you in the sentence you're writing
  - click: .cm-content
  - press: { keys: Meta+End, label: End of document }
  - type: " A new sentence, typed at a human pace."
  - wait: 600
  - press: { keys: Meta+S, label: Focus Mode }
  - wait: 2000
  - caption: null
```

Optional top-level keys: `platform` (`mac`, the default, makes the page
report macOS so apps show ⌘ and `Meta` shortcuts work; `linux` turns that
off), `colorScheme` (`light` or `dark`), `fps` (30), `lead` and `tail`
(milliseconds held before the first and after the last step),
`appOptions` (passed to the adapter, e.g. `settings` for Hush).

## Steps

Each step is a mapping with exactly one action. Any step may also carry a
`note:` for humans; it is printed while recording and otherwise ignored.

| Step | Short form | Long form | What it does |
|---|---|---|---|
| `card` | `card: Hush` | `{title, subtitle, duration: 2200, background: "#101014"}` | Full-screen title card that fades in, holds, fades out |
| `caption` | `caption: Text` or `caption: null` | `{text, position: bottom \| top, duration}` | Shows a caption until the next caption (or for `duration` ms) |
| `wait` | `wait: 800` | | Pause, in milliseconds |
| `click` | `click: <selector>` | `{selector, double: true, label}` | Cursor glides to the element and clicks it |
| `move` | `move: <selector>` | | Cursor glides to the element |
| `type` | `type: "text"` | `{text \| content, paragraph, words, into, wpm}` | Types at a human pace (rhythm is the same on every render) |
| `paste` | `paste: "text"` | `{text \| content, paragraph, words, into}` | Inserts text at once; the HUD shows ⌘V |
| `press` | `press: Meta+S` | `{keys, label, times, hold, silent}` | Shows the keys in the HUD, then presses them; `silent: true` presses without showing (for setup) |
| `highlight` | `highlight: <selector>` | `{selector, duration: 1600}` | Draws a ring around an element and dims the rest |
| `scroll` | `scroll: 400` | `{by, selector, duration: 900}` | Smooth scroll of the page or an element |
| `waitFor` | `waitFor: <selector>` | `{selector, state, timeout}` | Waits for an element without showing anything |
| `eval` | `eval: "js"` | | Runs JavaScript in the page; hand-written scripts only |

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
