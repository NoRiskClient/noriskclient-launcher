import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const thirdParty = path.join(repoRoot, "src-tauri", "third-party");
const force = process.argv.includes("--force");

const DEPENDENCIES = [
  {
    id: "ffmpeg",
    label: "FFmpeg n8.1.2",
    dir: path.join(thirdParty, "ffmpeg"),
    stampFile: ".norisk-ffmpeg-version",
    stamp: "autobuild-2026-08-17-13-05/ffmpeg-n8.1.2-44-g7c533d0f86-win64-gpl-shared-8.1.zip",
    url:
      "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-17-13-05/" +
      "ffmpeg-n8.1.2-44-g7c533d0f86-win64-gpl-shared-8.1.zip",
    sha256: "621d81bc8fb48efaef60ef51e51b365936852c2d34d1fb078b246dcec4bc77e4",
    abi: "src-tauri/crates/norisk-capture/src/encoder/d3d11_ffi.rs",
    take: { kind: "inner-directory" },
    expect: ["include/libavcodec/avcodec.h", "lib", "bin"],
  },
  {
    id: "graphics-hook",
    label: "OBS graphics hook 32.1.1",
    dir: path.join(thirdParty, "graphics-hook"),
    stampFile: ".norisk-hook-version",
    stamp: "OBS-Studio-32.1.1-Windows-x64.zip",
    url:
      "https://github.com/obsproject/obs-studio/releases/download/32.1.1/" +
      "OBS-Studio-32.1.1-Windows-x64.zip",
    sha256: "a4cc40a06d5a5dc158c792631b596a04b02d8fe99644a0f0bc3b12199dbce011",
    abi: "src-tauri/crates/norisk-capture/src/capture/hook/info.rs",
    take: { kind: "files", names: ["graphics-hook64.dll", "graphics-hook32.dll"] },
    expect: ["graphics-hook64.dll"],
    notice: [
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
  },
];

const ok = (msg) => console.log(`  \x1b[32m+\x1b[0m ${msg}`);
const info = (msg) => console.log(`    ${msg}`);
const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);

if (process.platform !== "win32") {
  console.log("Native capture dependencies are Windows-only; nothing to do.");
  process.exit(0);
}

if (typeof fetch !== "function") {
  console.error("This needs Node 18 or newer (for a built-in fetch).");
  process.exit(1);
}

console.log("\nNative capture dependencies");

let fetched = 0;
for (const dep of DEPENDENCIES) {
  if (await ensure(dep)) fetched++;
}

if (fetched === 0) {
  info("everything already in place");
}
console.log("");
async function ensure(dep) {
  if (!force && isCurrent(dep)) {
    ok(`${dep.label} (already there)`);
    return false;
  }

  const cache = path.join(os.tmpdir(), "norisk-native-deps");
  fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, path.basename(new URL(dep.url).pathname));

  if (!force && fs.existsSync(archive) && (await hashOf(archive)) === dep.sha256) {
    info(`${dep.label}: using the cached download`);
  } else {
    await download(dep.url, archive, dep.label);
    const actual = await hashOf(archive);
    if (actual !== dep.sha256) {
      fs.rmSync(archive, { force: true });
      throw new Error(
        `${dep.label}: SHA256 mismatch.\n` +
          `  expected ${dep.sha256}\n` +
          `  got      ${actual}\n` +
          `The download was deleted; run again. If it keeps failing, the pinned\n` +
          `release was replaced — check the version and the ABI note in ${dep.abi}.`,
      );
    }
    info("SHA256 verified");
  }

  const staging = path.join(cache, `${dep.id}-staging`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  unzip(archive, staging);
  install(dep, staging);
  fs.rmSync(staging, { recursive: true, force: true });

  for (const relative of dep.expect) {
    if (!fs.existsSync(path.join(dep.dir, relative))) {
      throw new Error(`${dep.label}: ${relative} is missing after unpacking.`);
    }
  }

  if (dep.notice) {
    fs.writeFileSync(path.join(dep.dir, "NOTICE.txt"), dep.notice, "utf8");
  }
  fs.writeFileSync(path.join(dep.dir, dep.stampFile), dep.stamp, "utf8");

  ok(`${dep.label}`);
  return true;
}

function isCurrent(dep) {
  const stamp = path.join(dep.dir, dep.stampFile);
  if (!fs.existsSync(stamp)) return false;
  if (fs.readFileSync(stamp, "utf8").trim() !== dep.stamp) return false;
  return dep.expect.every((relative) => fs.existsSync(path.join(dep.dir, relative)));
}

async function download(url, dest, label) {
  info(`${label}: downloading`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${label}: ${response.status} ${response.statusText} from ${url}`);
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

function install(dep, staging) {
  fs.rmSync(dep.dir, { recursive: true, force: true });
  fs.mkdirSync(dep.dir, { recursive: true });

  if (dep.take.kind === "inner-directory") {
    const entries = fs.readdirSync(staging, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (entries.length !== 1) {
      throw new Error(
        `${dep.label}: expected one directory inside the archive, found ${entries.length}.`,
      );
    }
    fs.cpSync(path.join(staging, entries[0].name), dep.dir, { recursive: true });
    return;
  }

  for (const name of dep.take.names) {
    const found = findFile(staging, name);
    if (!found) {
      throw new Error(`${dep.label}: ${name} is not in the archive.`);
    }
    fs.copyFileSync(found, path.join(dep.dir, name));
  }
}

function findFile(root, name) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}
