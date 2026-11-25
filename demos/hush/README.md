# Hush: the tour, in clips

A series for someone who already writes in a plain Markdown editor and is
meeting Hush for the first time. It starts with the ways Hush helps you concentrate, moves on to
the ways it lets you rearrange text, and finally the tools for catching and keeping ideas.
Every clip uses the `pequod` pack, laid out as a writer's desk with the
sidebar open: an Inbox of notes (a reading log, seminar questions, a
whaling glossary, the opening of chapter 1) and a project, "The Crew as a
Machine", holding the chapter being written in five short sections and a
notebook of research. The proofreading clip also seeds `moby-dick/loomings-proof`,
a proofread notebook baked from `content/moby-dick/loomings.pdf`.

| # | File | What it shows | Keys on screen |
|---|------|---------------|----------------|
| 1 | `01-focus-modes.yml` | Focus Mode lights only the current sentence; Zen Focus keeps the line you write mid-screen | ⌘S, ⌘⇧S |
| 2 | `02-campfire.yml` | Campfire Cursor: a glow around the caret | Command × 3 |
| 3 | `03-typewriter.yml` | Typewriter scrolling in a pane over the crew notebook: stretch the pane (⌘-double-click its title bar), turn it on, drag the typewriter line lower | ⌘ double-click, ⌘⇧T |
| 4 | `04-private.yml` | Private Mode blacks out every word, for writing in public | ⌘⇧P |
| 5 | `05-writing-shortcuts.yml` | Writing shortcuts: jump and select by sentence, move a sentence through its paragraph, move lines, select a word and jump to its next use, fold sections | ⌘→ ⌘← ⌘L ⌥⌘→ ⌥⌘←, ⌥↑, ⌘D, ⌘P |
| 6 | `06-shuffle.yml` | The Shuffle Editor: sentences as cards, reorder, compare, keep | ⌘⇧↓, ⌘⇧E |
| 7 | `07-cards.yml` | Make margin cards, drag one onto another section and one onto the Inbox (a CARDS notebook appears), then drag it from the sidebar into a new document | ⌘L, ⌘⇧,, ⌘N |
| 8 | `08-courier.yml` | Courier: send a note to the end of another document | Shift × 3, ⌘↩ |
| 9 | `09-write-now.yml` | Write Now: a blank page from anywhere | Option × 3 |
| 10 | `10-panes.yml` | Panes: drag a section and the notebook out of the sidebar, dock them, drag a note into the text | ⌘ held while dragging |
| 11 | `11-proofreading.yml` | A proofread notebook made from four pages of Moby-Dick: strike words with the red pen, split the page open and write the fix in the gap, grab a sentence and place it elsewhere | S, T, G |

Record one with `node src/cli.mjs record demos/hush/06-shuffle.yml`, or
all of them with a loop over `demos/hush/*.yml`. Each writes
`out/hush-<feature>.mp4`.

Not in the series, because the browser can't show them: the menu-bar
popover, global hotkeys, extra native windows and iCloud sync.
