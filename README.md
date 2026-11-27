<img src="manual-mode/MonkeySee/Assets.xcassets/AppIcon.appiconset/icon_128x128@2x.png" width="128" alt="monkeysee icon">

# monkeysee

Short feature clips of apps, for their pages on tools.natelaffan.com.
Two ways to make them:

- **[agent-mode/](agent-mode/README.md)**: scripted clips. You describe a
  clip in a small YAML file, a model writes the steps, and monkeysee plays
  them in the app's web frontend in Chromium and records an mp4, with the
  keys pressed shown on screen. Runs anywhere, including a cloud machine.
- **[manual-mode/](manual-mode/README.md)**: a Mac app for recording by
  hand. A frame the size of the site's clips, a sidebar of feature
  buttons, a countdown, then a trim step. Records the real app with
  ScreenCaptureKit.

Both make 2560 × 1600, 30 fps H.264 mp4s by default.

## Agent mode as a dependency

The npm package is the repo root, and it ships only agent mode, so
workspaces keep depending on it as before:

```json
"dependencies": { "monkeysee": "github:laffan/monkeysee#main" }
```

From a checkout, run agent mode from the repo root:

```sh
npm install
node agent-mode/src/cli.mjs record agent-mode/demos/fixture/smoke.yml
```

`npm run record -- <clip.yml>` and the other scripts in `package.json`
do the same.
