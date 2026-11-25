# Capturing a UI: screenshots and videos over CDP

Works for anything that speaks the Chrome DevTools Protocol (CDP): Chrome, Edge, Electron, and Tauri or
other WebView2 apps on Windows. A script attaches to the running page, drives it and captures it.

## Security first

An open debugging port gives full control over the app to every process on the machine: it can read the page,
its cookies and storage, and run any script in it. Therefore:

- Use it only on development builds and test instances, never on an app holding real accounts you care about.
- Give a browser its own throwaway profile (`--user-data-dir`), never your everyday profile.
- Keep the port on `127.0.0.1` (the default). Never forward it, expose it in a container or open it in a
  firewall.
- Close the app when you are done; the port closes with it.
- Screenshots and videos show whatever is on screen. Check them for tokens, e-mail addresses and other personal
  data before you share them.

## 1. Expose CDP

Pick a free port (for example with `netstat -ano`) and start the app with remote debugging on:

| App | How |
| --- | --- |
| WebView2 (Tauri, WinUI, ...) | env `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=<cdpPort>"` |
| Electron | `<app> --remote-debugging-port=<cdpPort>` |
| Chrome / Edge | `chrome --remote-debugging-port=<cdpPort> --user-data-dir=<throwaway-dir>` |

Set the WebView2 variable only for the one process you start; every WebView2 app launched with it inherits the
port. Some Electron apps disable the switch in production builds.

Ready when `http://127.0.0.1:<cdpPort>/json` lists the page. Every window is its own target, including hidden
ones such as overlays; pick the one you want by a URL prefix that only it has (for example
`http://localhost:1420/#` rather than `http://localhost:1420`, when an overlay is served from
`http://localhost:1420/overlay.html`).

The scripts below need Node.js, `playwright-core` (`npm i playwright-core`, no browser download needed
because it attaches to the running one) and, for videos, `ffmpeg` on the `PATH`.

## 2. Connect

```js
import { chromium } from "playwright-core";

export async function attach(cdpPort, urlPrefix) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(urlPrefix));
  if (!page) throw new Error(`no page starting with ${urlPrefix}`);
  return { browser, page };
}
```

Drive the page with the usual Playwright calls: `page.goto`, `page.click`, `page.evaluate(...)` (for example
setting `location.hash` in a hash-routed app), `page.waitForTimeout`.

## 3. Screenshots

```js
const { browser, page } = await attach(cdpPort, urlPrefix);
await page.setViewportSize({ width: 1280, height: 800 });
await page.screenshot({ path: "shot-desktop.png" });
await page.setViewportSize({ width: 393, height: 852 });
await page.screenshot({ path: "shot-phone.png" });
await browser.close();
```

`browser.close()` on a CDP connection only disconnects; the app keeps running.

## 4. Videos

Playwright's `recordVideo` does not work when attaching over CDP: it only records contexts Playwright creates
itself. Use the CDP screencast and assemble the frames with ffmpeg instead.

```js
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export async function record(page, outDir, drive) {
  mkdirSync(join(outDir, "frames"), { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = `frame-${String(frames.length).padStart(5, "0")}.jpg`;
    writeFileSync(join(outDir, "frames", file), Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId });
  });

  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 });
  await drive(page);
  const stoppedAt = Date.now() / 1000;
  await cdp.send("Page.stopScreencast");
  await cdp.detach();
  if (!frames.length) throw new Error("no frames: the page did not change while recording");

  const end = Math.max(stoppedAt, frames.at(-1).t + 0.04);
  const list = frames
    .map((f, i) => `file 'frames/${f.file}'\nduration ${((frames[i + 1]?.t ?? end) - f.t).toFixed(3)}`)
    .join("\n");
  writeFileSync(join(outDir, "frames.txt"), `${list}\nfile 'frames/${frames.at(-1).file}'\n`);

  execFileSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", join(outDir, "frames.txt"),
    "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    "-c:v", "libx264", "-movflags", "+faststart", join(outDir, "capture.mp4"),
  ]);
}
```

Usage:

```js
const { browser, page } = await attach(cdpPort, urlPrefix);
await record(page, "out", async (p) => {
  await p.click("text=Settings");
  await p.waitForTimeout(3000);
});
await browser.close();
```

Things to know:

- Acknowledge every frame with `Page.screencastFrameAck`, or the stream stops after a few frames.
- Frames only arrive when the page changes. Each frame is shown until the next one (its timestamp is in
  seconds), and the last one until recording stopped; without these durations the video plays too fast.
- The last frame is listed twice in `frames.txt` on purpose: ffmpeg's concat format ignores the duration of
  the final entry otherwise.
- Only the page content is recorded: no window frame, no native dialogs. The window may be covered.
- Set the viewport size and wait about a second before starting the screencast. The video takes the size of
  the first frame; frames captured while the page is still resizing come out distorted.
- `scale=trunc(...)` keeps width and height even, which libx264 requires.
- For a GIF instead of MP4: `ffmpeg -i capture.mp4 -vf "fps=15,scale=800:-1" capture.gif`.

### Showing a mouse cursor

The screencast never contains the system cursor. To show one, inject a cursor element that follows the mouse
events Playwright sends, and move the mouse in steps so the motion is visible:

```js
export async function showCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById("__capture-cursor")) return;
    const c = document.createElement("div");
    c.id = "__capture-cursor";
    c.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {
      position: "fixed", left: "0", top: "0", zIndex: "2147483647",
      pointerEvents: "none", transform: "translate(-100px,-100px)",
    });
    const ring = document.createElement("div");
    Object.assign(ring.style, {
      position: "absolute", left: "-12px", top: "-12px", width: "26px", height: "26px",
      borderRadius: "50%", background: "rgba(255,200,0,.5)", opacity: "0",
    });
    c.prepend(ring);
    document.documentElement.append(c);
    addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`), true);
    addEventListener("mousedown", () => { ring.style.transition = "none"; ring.style.opacity = "1"; }, true);
    addEventListener("mouseup", () => { ring.style.transition = "opacity .3s"; ring.style.opacity = "0"; }, true);
  });
}

export async function clickVisibly(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
}
```

Call `showCursor(page)` before recording, then use `clickVisibly` instead of `page.click`. The cursor is part
of the page: a full reload removes it (call `showCursor` again), and it also appears in screenshots taken
while it is there. With a plain `page.click` the cursor jumps to the target instead of moving there.

### Alternative: grab the window

When the window frame or native dialogs must be in the video:

```bash
ffmpeg -f gdigrab -framerate 30 -i title="<exact window title>" -c:v libx264 -pix_fmt yuv420p capture.mp4
```

The window must stay visible and unminimised, and the title must be unique, or ffmpeg grabs the wrong window.
On macOS use `-f avfoundation`, on Linux `-f x11grab`.

## 5. Housekeeping

- Write screenshots, frames and videos to a scratch folder outside the repository.
- In Git Bash set `MSYS_NO_PATHCONV=1` when passing arguments like `#/route`, or they get turned into paths.
- Stop any app instance you started yourself; never attach to or stop one you did not start.
