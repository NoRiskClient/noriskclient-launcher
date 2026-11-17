import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FFMPEG_DLLS, HOOK_FILES } from "./native-deps-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const thirdParty = path.join(repoRoot, "src-tauri", "third-party");
const force = process.argv.includes("--force");

const ARCHIVE = {
  label: "native capture dependencies",
  stampFile: ".norisk-native-deps-version",
  url:
    "https://github.com/NoRiskClient/noriskclient-launcher/releases/download/native-deps-v1/" +
    "norisk-native-deps-win64-v1.zip",
  sha256: "3c5ff4ed9e243a0b7374ac5b9c7342d9b2983098ed765c0ce6b95a7754ef8463",
  abi: [
    "src-tauri/crates/norisk-capture/src/encoder/d3d11_ffi.rs",
    "src-tauri/crates/norisk-capture/src/capture/hook/info.rs",
  ],
  expect: [
    ...FFMPEG_DLLS.map((dll) => `ffmpeg/bin/${dll}`),
    ...["avcodec", "avformat", "avutil", "swresample"].map((lib) => `ffmpeg/lib/${lib}.lib`),
    "ffmpeg/include/libavcodec/avcodec.h",
    "ffmpeg/LICENSE.txt",
    ...HOOK_FILES.map((dll) => `graphics-hook/${dll}`),
  ],
};

const DIRS = ["ffmpeg", "graphics-hook"];
const STAMP = ARCHIVE.url.split("/download/")[1];

const NOTICES = {
  ffmpeg: [
    "The FFmpeg DLLs in this directory are unmodified binaries from the BtbN",
    "FFmpeg-Builds project.",
    "",
    "  Project:  FFmpeg",
    "  Version:  n8.1.2 (win64-gpl-shared)",
    "  Build:    https://github.com/BtbN/FFmpeg-Builds",
    "  Source:   https://git.ffmpeg.org/ffmpeg.git",
    "  Licence:  GNU General Public License v3.0 - see LICENSE.txt",
    "",
    "They provide the video and audio encoding, decoding and MP4 muxing the clip",
    "system is built on.",
    "",
    "This launcher is licensed under GPL-3.0. Distributing these binaries carries",
    "the obligation to make the corresponding source available; it is published at",
    "the URLs above, and the scripts that produced this exact build are in the",
    "BtbN repository.",
    "",
    "Fetched by scripts/setup-native-deps.mjs - do not edit these files by hand.",
    "",
  ].join("\n"),
  "graphics-hook": [
    "The graphics-hook DLLs in this directory are unmodified binaries from OBS Studio.",
    "",
    "  Project:  OBS Studio",
    "  Version:  32.1.1",
    "  Source:   https://github.com/obsproject/obs-studio",
    "  Licence:  GNU General Public License v2.0 or later",
    "",
    "They are loaded into the game process to capture the rendered frame, which is the",
    "only way to record a game running in exclusive fullscreen.",
    "",
    "This launcher is licensed under GPL-3.0, which is compatible with GPL-2.0-or-later.",
    "Distributing these binaries carries the obligation to make the corresponding source",
    "available; it is published at the URL above.",
    "",
    "Fetched by scripts/setup-native-deps.mjs - do not edit these files by hand.",
    "",
  ].join("\n"),
};

const ok = (msg) => console.log(`  \x1b[32m+\x1b[0m ${msg}`);
const info = (msg) => console.log(`    ${msg}`);

if (process.platform !== "win32") {
  console.log("Native capture dependencies are Windows-only; nothing to do.");
  process.exit(0);
}

if (typeof fetch !== "function") {
  console.error("This needs Node 18 or newer (for a built-in fetch).");
  process.exit(1);
}

console.log("\nNative capture dependencies");

if (!force && isCurrent()) {
  writeNotices();
  ok(`${ARCHIVE.label} (already there)`);
} else {
  await install();
  ok(ARCHIVE.label);
}
console.log("");

async function install() {
  const cache = path.join(os.tmpdir(), "norisk-native-deps");
  fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, path.basename(new URL(ARCHIVE.url).pathname));

  if (!force && fs.existsSync(archive) && (await hashOf(archive)) === ARCHIVE.sha256) {
    info("using the cached download");
  } else {
    await download(ARCHIVE.url, archive);
    const actual = await hashOf(archive);
    if (actual !== ARCHIVE.sha256) {
      fs.rmSync(archive, { force: true });
      throw new Error(
        `${ARCHIVE.label}: SHA256 mismatch.\n` +
          `  expected ${ARCHIVE.sha256}\n` +
          `  got      ${actual}\n` +
          `The download was deleted; run again. If it keeps failing, the release asset\n` +
          `was replaced. Check the version and the ABI notes in:\n` +
          ARCHIVE.abi.map((file) => `  ${file}`).join("\n"),
      );
    }
    info("SHA256 verified");
  }

  const staging = path.join(cache, "staging");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  unzip(archive, staging);

  for (const dir of DIRS) {
    const from = path.join(staging, dir);
    if (!fs.existsSync(from)) {
      throw new Error(`${ARCHIVE.label}: ${dir}/ is not in the archive.`);
    }
    const to = path.join(thirdParty, dir);
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(to, { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  }
  fs.rmSync(staging, { recursive: true, force: true });

  for (const relative of ARCHIVE.expect) {
    if (!fs.existsSync(path.join(thirdParty, relative))) {
      throw new Error(`${ARCHIVE.label}: ${relative} is missing after unpacking.`);
    }
  }

  writeNotices();
  fs.writeFileSync(path.join(thirdParty, ARCHIVE.stampFile), STAMP, "utf8");
}

function writeNotices() {
  for (const dir of DIRS) {
    const at = path.join(thirdParty, dir, "NOTICE.txt");
    const notice = NOTICES[dir];
    if (!fs.existsSync(at) || fs.readFileSync(at, "utf8") !== notice) {
      fs.writeFileSync(at, notice, "utf8");
    }
  }
}

function isCurrent() {
  const stamp = path.join(thirdParty, ARCHIVE.stampFile);
  if (!fs.existsSync(stamp)) return false;
  if (fs.readFileSync(stamp, "utf8").trim() !== STAMP) return false;
  return ARCHIVE.expect.every((relative) => fs.existsSync(path.join(thirdParty, relative)));
}

async function download(url, dest) {
  info("downloading");
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${ARCHIVE.label}: ${response.status} ${response.statusText} from ${url}`);
  }

  const partial = `${dest}.partial`;
  const handle = fs.createWriteStream(partial);
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  await pipeline(Readable.fromWeb(response.body), handle);
  fs.renameSync(partial, dest);
}

async function hashOf(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function unzip(archive, dest) {
  try {
    execFileSync(bsdtar(), ["-xf", path.basename(archive), "-C", dest], {
      cwd: path.dirname(archive),
      stdio: "pipe",
    });
  } catch (e) {
    throw new Error(
      `Could not unpack ${path.basename(archive)}.\n${e.stderr?.toString() ?? e.message}`,
    );
  }
}

function bsdtar() {
  const bundled = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  if (fs.existsSync(bundled)) return bundled;
  throw new Error(
    `${bundled} is missing. It ships with Windows 10 1803 and newer; on an older\n` +
      `build it has to be installed.`,
  );
}
