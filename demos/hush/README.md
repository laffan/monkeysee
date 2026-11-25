# Hush: the tour, in clips

A series for someone who already writes in a plain Markdown editor and is
meeting Hush for the first time. It starts with the command palette,
then moves through the ways Hush helps you concentrate, the ways it lets
you rearrange text, and finally the tools for catching and keeping ideas.
Every clip uses the `pequod` pack, laid out as a writer's desk with the
sidebar open: an Inbox of notes (a reading log, seminar questions, a
whaling glossary, the opening of chapter 1) and a project, "The Crew as a
Machine", holding the chapter being written in five short sections and a
notebook of research.

| # | File | What it shows | Keys on screen |
|---|------|---------------|----------------|
| 2 | `02-palette.yml` | The command palette: browse it, switch style, turn on Midnight | ⌘P |
| 3 | `03-focus.yml` | Focus Mode lights only the current sentence; word count | ⌘S, ⌘⇧W |
| 4 | `04-zen.yml` | Zen Focus keeps the line you write mid-screen | ⌘⇧S |
| 5 | `05-typewriter.yml` | Typewriter scrolling on the opening of Moby-Dick | ⌘⇧T |
| 6 | `06-private.yml` | Private Mode blacks out every word, for writing in public | ⌘⇧P |
| 7 | `07-sentences.yml` | Jump, select and move by sentence | ⌘→ ⌘← ⌘L ⌥⌘→ ⌥⌘← |
| 8 | `08-shuffle.yml` | The Shuffle Editor: sentences as cards, reorder, compare, keep | ⌘⇧↓, ⌘⇧E |
| 9 | `09-lines.yml` | Move lines with the keyboard; bold and highlight | ⌥↑, ⌘B, ⌘= |
| 10 | `10-folding.yml` | Fold every section into an outline, open one | ⌘P |
| 11 | `11-cards.yml` | Turn a sentence into a margin card that rides with its line | ⌘L, ⌘⇧, |
| 12 | `12-courier.yml` | Courier: send a note to the end of another document | ⇧⇧⇧, ⌘↩ |
| 13 | `13-campfire.yml` | Campfire Cursor: a glow around the caret | ⌘⌘⌘ |
| 14 | `14-write-now.yml` | Write Now: a blank page from anywhere | ⌥⌥⌥ |
| 15 | `15-panes.yml` | Panes: drag a section and the notebook out of the sidebar, dock them, drag a note into the text | ⌘ held while dragging |

Record one with `node src/cli.mjs record demos/hush/08-shuffle.yml`, or
all of them with a loop over `demos/hush/*.yml`. Each writes
`out/hush-<feature>.mp4`.

Not in the series, because the browser can't show them: the menu-bar
popover, global hotkeys, extra native windows and iCloud sync.
