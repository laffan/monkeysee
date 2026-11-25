# Writing demo clips in this repo

When asked for a clip of an app feature:

1. Read `docs/SCRIPT.md` (format) and the app's adapter in `src/apps/`
   (its `guide` lists selectors and shortcuts).
2. Run `node src/cli.mjs inspect --app <app> [--content pack/item]` and look
   at the screenshot it writes to `out/`. Use only selectors you saw there
   or in the guide.
3. Write `demos/<app>-<feature>.yaml`. One feature per clip, 8 to 25
   seconds. Label every shortcut with the feature's name. Wait 800 to 2000
   ms after anything changes on screen. Use content packs for text.
4. Run `node src/cli.mjs check demos/<file>.yaml` until it passes. `check`
   only proves the steps ran; it doesn't prove the feature appeared.
5. Run `node src/cli.mjs record demos/<file>.yaml`, then pull a few frames
   (`ffmpeg -i out/x.mp4 -vf fps=1/2 frame%02d.png`) and look at them before
   calling the clip done. Typing that lands nowhere and modes that don't
   open are the usual failures, and only the frames show them.

Adding an app: copy `src/apps/hush.mjs`, register it in
`src/apps/index.mjs`. For a Tauri app whose frontend needs the bridge, give
the adapter a `tauri: { handlers: { command_name: (args, data) => … }, data }`
and its commands will be answered by those handlers.

Adding content: a folder in `content/` with `pack.yaml` listing items. Use
public-domain or original text only.
