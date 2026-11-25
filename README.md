# monkeysee

Short, scripted feature clips of web and Tauri app frontends, with visible
keyboard shortcuts and themed demo content. Write a small YAML script (or
ask a model to), and monkeysee records it to mp4, webm or gif.

```yaml
app: hush
output: [out/hush-moby-dick.mp4, out/hush-moby-dick.gif]
content: [moby-dick/chapter-1]
steps:
  - card: { title: Hush, subtitle: A quiet place to write }
  - type: "\n\nWhenever it is a damp, drizzly November in my soul, I write."
  - press: { keys: Meta+S, label: Focus Mode }
  - wait: 2200
```

## Setup

Needs Node 20+ and ffmpeg.

```sh
npm install
npx playwright install chromium     # or set MONKEYSEE_CHROME to a Chrome binary
```

Adapters start the app's dev server from a sibling checkout (`../hush`),
from `MONKEYSEE_HUSH_DIR`, or from `--app-dir`. If the server is already
running at the adapter's URL, it is reused.

## Commands

```sh
monkeysee record demos/hush-moby-dick.yaml   # render the clip
monkeysee check  demos/hush-moby-dick.yaml   # run every step fast, no video
monkeysee inspect --app hush                 # screenshot + selectors of the starting screen
monkeysee plan "show Zen Focus" --app hush --record   # needs ANTHROPIC_API_KEY
monkeysee fetch-content                      # full public-domain texts for the packs
monkeysee apps | packs
```

(`npx monkeysee …` or `node src/cli.mjs …` from the repo.)

## Docs

- [docs/SCRIPT.md](docs/SCRIPT.md): the script format
- [docs/DESIGN.md](docs/DESIGN.md): how it works, limits, open questions
- [CLAUDE.md](CLAUDE.md): how a model should write and check clips here
