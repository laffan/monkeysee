# Hush: the tour, in clips

A series for someone who already writes in a plain Markdown editor and is
meeting Hush for the first time. It starts with the ways Hush helps you concentrate, moves on to
the ways it lets you rearrange text, and finally the tools for catching and keeping ideas.
Every clip uses the `pequod` pack, laid out as a writer's desk with the
sidebar open: an Inbox of notes (a reading log, seminar questions, a
whaling glossary, the opening of chapter 1) and a project, "The Crew as a
Machine", holding the chapter being written in five short sections and a
notebook of research.

| # | File | What it shows | Keys on screen |
|---|------|---------------|----------------|
| 1 | `01-focus-modes.yml` | Focus Mode lights only the current sentence; Zen Focus keeps the line you write mid-screen | ⌘S, ⌘⇧S |
| 2 | `02-campfire.yml` | Campfire Cursor: a glow around the caret | Command × 3 |
| 3 | `03-typewriter.yml` | Typewriter scrolling on the opening of Moby-Dick | ⌘⇧T |
| 4 | `04-private.yml` | Private Mode blacks out every word, for writing in public | ⌘⇧P |
| 5 | `05-sentences.yml` | Jump, select and move by sentence | ⌘→ ⌘← ⌘L ⌥⌘→ ⌥⌘← |
| 6 | `06-shuffle.yml` | The Shuffle Editor: sentences as cards, reorder, compare, keep | ⌘⇧↓, ⌘⇧E |
| 7 | `07-lines.yml` | Move lines with the keyboard; bold and highlight | ⌥↑, ⌘B, ⌘= |
| 8 | `08-folding.yml` | Fold every section into an outline, open one | ⌘P |
| 9 | `09-cards.yml` | Make margin cards, drag one onto another section and one onto the Inbox (a CARDS notebook appears), then drag it from the sidebar into a new document | ⌘L, ⌘⇧,, ⌘N |
| 10 | `10-courier.yml` | Courier: send a note to the end of another document | Shift × 3, ⌘↩ |
| 11 | `11-write-now.yml` | Write Now: a blank page from anywhere | Option × 3 |
| 12 | `12-panes.yml` | Panes: drag a section and the notebook out of the sidebar, dock them, drag a note into the text | ⌘ held while dragging |

Record one with `node src/cli.mjs record demos/hush/06-shuffle.yml`, or
all of them with a loop over `demos/hush/*.yml`. Each writes
`out/hush-<feature>.mp4`.

Not in the series, because the browser can't show them: the menu-bar
popover, global hotkeys, extra native windows and iCloud sync.
