# monkeysee

Short feature clips of web and Tauri app frontends, with visible keyboard
shortcuts and themed demo content. Describe a clip in a small YAML file,
have a model script it, and monkeysee records it to mp4, webm or gif.

```yaml
# demos/hush/15-panes.yml
feature: panes
state: left sidebar open, ten demo text and notebook files
description:
  - working on text document
  - open notebook with flowchart and notes as a pane
  - dock pane to right
  - drag a note from notebook into document

# Script (written from the spec above; edit freely) ------------------------
content: [pequod/*]
setup: [...]
steps: [...]
```

The top half is yours: what the clip shows, in plain words. The bottom half
is written from it by a model (`monkeysee plan`, or Claude Code with
CLAUDE.md) and checked against the running app. Clips show the app, the
cursor and the keys pressed; nothing else is drawn on top.

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
monkeysee plan   demos/hush/15-panes.yml       # script a spec (needs ANTHROPIC_API_KEY)
monkeysee check  demos/hush/15-panes.yml       # run setup and steps fast, no video
monkeysee record demos/hush/15-panes.yml       # render the clip to out/hush-panes.mp4
monkeysee inspect --app hush                # screenshot + selectors of the starting screen
monkeysee fetch-content                     # full public-domain texts for the packs
monkeysee apps | packs
```

(`npx monkeysee …` or `node src/cli.mjs …` from the repo.)

## Docs

- [docs/SCRIPT.md](docs/SCRIPT.md): the file format
- [docs/DESIGN.md](docs/DESIGN.md): how it works, limits, open questions
- [CLAUDE.md](CLAUDE.md): how a model should write and check clips here
