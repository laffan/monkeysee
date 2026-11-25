# monkeysee

Short feature clips of web and Tauri app frontends, with visible keyboard
shortcuts and themed demo content. Describe a clip in a small YAML file,
have a model script it, and monkeysee records it to mp4, webm or gif.

```yaml
# hush/10-panes.yml, in a workspace
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

## This repo is the tool; clips live in a workspace

monkeysee holds the recorder only, with one built-in app (a notepad
fixture) and a small Moby-Dick sample pack to try it on. The clips for
real apps, their adapters and their content live in a **workspace**: a
folder with a `monkeysee.json`, usually in the repo that publishes the
clips, with monkeysee as a dependency:

```
demos/
  monkeysee.json      {"adapters": "adapters", "content": "content",
                       "output": "../{app}/videos/{feature}.mp4"}
  package.json        "dependencies": {"monkeysee": "github:laffan/monkeysee"}
  adapters/<app>.mjs  how to start, seed and describe each app
  content/<pack>/     themed demo content
  <app>/*.yml         one clip per file
```

monkeysee finds the workspace by walking up from the clip file (or the
current folder); `--workspace DIR` or `MONKEYSEE_WORKSPACE` set it
outright. Workspace packs shadow built-in packs of the same name.
Adapters import helpers with `import { readPack } from "monkeysee"`.
The clips for tools.natelaffan.com are in that repo's `demos/` folder.

## Setup

Needs Node 20+ and ffmpeg.

```sh
npm install
npx playwright install chromium     # or set MONKEYSEE_CHROME to a Chrome binary
```

Adapters start the app's dev server from `--app-dir`, from
`MONKEYSEE_<APP>_DIR`, or from a sibling checkout. If the server is
already running at the adapter's URL, it is reused.

## Commands

```sh
monkeysee plan   hush/10-panes.yml     # script a spec (needs ANTHROPIC_API_KEY)
monkeysee check  hush/10-panes.yml     # run setup and steps fast, no video
monkeysee record hush/10-panes.yml     # render the clip (workspace "output", else out/<app>-<feature>.mp4)
monkeysee inspect --app hush           # screenshot + selectors of the starting screen
monkeysee fetch-content                # full public-domain texts for the packs
monkeysee apps | packs
```

Try it here with the fixture: `node src/cli.mjs record demos/fixture/smoke.yml`.

## Docs

- [docs/SCRIPT.md](docs/SCRIPT.md): the file format
- [docs/DESIGN.md](docs/DESIGN.md): how it works, limits, open questions
- [CLAUDE.md](CLAUDE.md): how a model should write and check clips
