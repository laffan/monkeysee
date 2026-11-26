// Records a page to video with Chrome's screencast (CDP) piped into ffmpeg.
//
// Why not Playwright's recordVideo: it encodes VP8 at a fixed low bitrate
// and can't record at deviceScaleFactor 2, so text looks soft. Screencast
// gives us full-resolution JPEG frames whenever the page repaints; a
// wall-clock ticker repeats the latest frame so the output has a steady
// frame rate and real-time pacing.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export async function startRecording(page, { output, fps = 30, width, height, scale = 2, quality = 92 }) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const raw = output.replace(/\.[a-z0-9]+$/i, "") + ".raw.mp4";
  const W = even(width * scale);
  const H = even(height * scale);
  const ff = spawn("ffmpeg", [
    "-loglevel", "error", "-y",
    "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "-",
    // Never stretch: fit inside W×H and pad, in case a frame arrives at another size.
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-movflags", "+faststart",
    raw,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const ffDone = new Promise((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });

  const cdp = await page.context().newCDPSession(page);
  let latest = null;
  cdp.on("Page.screencastFrame", async ({ data, sessionId }) => {
    // A region picture the app asked for (browser.mjs, __monkeyseeShot)
    // can come through the screencast as a frame of its own: skip frames
    // while one is being taken.
    if (!page.__monkeyseeShooting) latest = Buffer.from(data, "base64");
    try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch { /* page closing */ }
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

  // Headless Chrome only emits a frame when something repaints, so the
  // first one may not come until the page changes. Grab one now.
  latest = await page.screenshot({ type: "jpeg", quality, scale: "device" });

  const start = Date.now();
  let written = 0;
  let stopped = false;
  const writeDue = () => {
    const due = Math.floor(((Date.now() - start) / 1000) * fps);
    while (written < due && latest) {
      ff.stdin.write(latest);
      written++;
    }
  };
  const timer = setInterval(writeDue, 1000 / fps / 2);

  return {
    elapsed: () => Date.now() - start,
    async stop() {
      if (stopped) return raw;
      stopped = true;
      writeDue();
      clearInterval(timer);
      try { await cdp.send("Page.stopScreencast"); } catch { /* ignore */ }
      ff.stdin.end();
      await ffDone;
      return raw;
    },
  };
}

// Converts the master recording into the formats asked for. The master is
// an H.264 MP4 at full resolution; .mp4 output is that file, .webm is VP9,
// .gif uses a two-pass palette at a smaller width.
export async function finish(raw, outputs, { gifWidth = 960, gifFps = 15 } = {}) {
  const done = [];
  for (const out of outputs) {
    const ext = path.extname(out).toLowerCase();
    if (ext === ".mp4") {
      fs.copyFileSync(raw, out);
    } else if (ext === ".webm") {
      await ffmpeg(["-i", raw, "-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-row-mt", "1", out]);
    } else if (ext === ".gif") {
      await ffmpeg(["-i", raw, "-vf", `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, out]);
    } else {
      throw new Error(`Unknown output format: ${out}`);
    }
    done.push(out);
  }
  fs.rmSync(raw, { force: true });
  return done;
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${c}`))));
  });
}

const even = (n) => Math.round(n / 2) * 2;
