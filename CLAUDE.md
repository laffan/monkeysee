# monkeysee

Two tools in one repo:

- `agent-mode/`: the scripted Chromium recorder (Node). Its instructions
  for writing and checking clips are in `agent-mode/CLAUDE.md`; read that
  before scripting a clip. The npm package is the repo root (`package.json`
  points into `agent-mode/src`), so keep `bin`, `exports` and `files` in
  step if files move.
- `manual-mode/`: the Mac app (Swift, Xcode 16 project with a synchronized
  `MonkeySee/` folder, macOS 14+). It can only be built on a Mac.
