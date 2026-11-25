// Hush (laffan/hush): a Markdown writing app with notebooks and panes.
// Its frontend runs in Chromium against an in-memory stand-in for the
// Rust side (hush-backend.mjs), so the whole app works: desks, the
// sidebar, notebooks, floating panes. Content items become files: kind
// "document" (Markdown) or "notebook" (a hushnote JSON envelope).
import path from "node:path";
import { hushBackend } from "./hush-backend.mjs";

export default {
  name: "hush",
  title: "Hush",
  url: "http://localhost:5173/",
  platform: "mac",
  server: {
    // Run from a hush checkout (--app-dir, MONKEYSEE_HUSH_DIR, or ../hush).
    command: ["npx", "vite", "--port", "5173", "--strictPort"],
    cwd: path.resolve(process.cwd(), "..", "hush"),
  },
  defaultContent: ["moby-dick/chapter-1"],
  // options.settings is merged into Hush's settings (theme, font, ...).
  tauri: { backend: hushBackend },

  async ready(page) {
    // The editor mounts even when no file is open (it stays hidden then).
    await page.waitForSelector(".cm-content", { state: "attached", timeout: 20_000 });
    // The boot splash fades out on its own; give it a moment.
    await page.waitForTimeout(1200);
  },

  // Read by the planner (and by you). Keep it to what a demo needs.
  guide: `
Hush is a distraction-free Markdown writing app (macOS menu-bar app and iPad).
At launch the sidebar is closed and no document may be showing: open one first, in
setup, by toggling the sidebar (Meta+Backslash) and clicking its title
("text=The Crew as a Machine"). Toggle the sidebar again if the state wants it closed.
Seeded items appear in the sidebar by title, in pack order; notebooks too.

Selectors:
- Editor text area: ".cm-content" (CodeMirror 6). The editor has focus at start.
  To click into it, click a body line such as ".cm-line:has-text(\"Call me Ishmael\")";
  clicking the "# Title" line at the top takes focus away from the editor.
- A line of text: ".cm-line" (use :has-text("...") or :nth-match to pick one).
- Sidebar entries: "text=<title>" (documents and notebooks).
- Floating pane: ".floating-pane"; its title bar ".floating-pane-titlebar". Docked panes
  also carry ".docked" and ".docked-right" / ".docked-left".
- Notebook cards (notes) inside a pane: ".hush-card-nb"; drag one by its header,
  ".hush-card-nb:has-text(\"...\") .hush-card-header".
- Command palette input (after Meta+P): "input[placeholder='Type a command…']".
  Type a command name, then press Enter to run the top match.

Default shortcuts (Mod = Meta on macOS; write them as Meta+... in press steps):
- Meta+P            command palette (almost every feature is here)
- Meta+S            Focus Mode: dims everything but the current sentence
- Meta+Shift+S      Zen Focus: fullscreen overlay, current line centred, edges blurred (Meta+Shift+S again exits)
- Meta+Shift+P      Private Mode: blacks out every word on screen
- Meta+Shift+W      word count pill above the text
- Meta+Backslash     toggle the sidebar (file list)
- Meta+Shift+Backslash  toggle the Overview
- Meta+Shift+T      typewriter scrolling
- Meta+Shift+E      Shuffle Editor: explode the selection into draggable sentences
- Meta+L            select the current sentence; Meta+Shift+L shrinks it
- Meta+ArrowRight / Meta+ArrowLeft            jump to next / previous sentence
- Alt+Meta+ArrowRight / Alt+Meta+ArrowLeft    move the current sentence forward / back
- Alt+ArrowUp / Alt+ArrowDown                 move the current line up / down
- Meta+Backspace    delete the sentence the caret is in
- Meta+B / Meta+I / Meta+=    bold / italic / highlight the selection
- Meta+.            blockquote the selected lines
- Meta+F            quick find; Meta+Shift+F find and replace
- Meta+End          caret to end of document (handy before typing new text; the
                    documents end with a newline, so a silent Backspace after it
                    keeps typing on the last line)
- Meta+Shift+O      open a file as a floating pane: type part of its title, press Enter

Panes and notebooks:
- A pane opens floating near the top left and shows the middle of the notebook's
  canvas; the pequod pack's notebook is laid out to fit it.
- Dock a pane by dragging its title bar to the window edge:
  {drag: {from: .floating-pane-titlebar, to: [1255, 400]}} docks it right.
  The editor narrows; the canvas does not recentre.
- Dragging a notebook card into the editor and dropping it on a line attaches it to
  the document as a margin note beside that paragraph. Holding Meta through the drop
  (drag keys: Meta) inserts it as text instead.
- The wheel pans a notebook canvas: {scroll: {at: .floating-pane, by: [dx, dy]}}.

Good demo moves: start with the caret at the end of a paragraph, type a sentence
at a natural pace, then show a mode with its shortcut. Focus Mode and Zen Focus
read best after the caret is inside a paragraph of real text.
`,
};
