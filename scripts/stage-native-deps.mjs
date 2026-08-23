import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcTauri = path.join(repoRoot, "src-tauri");
const staging = path.join(srcTauri, "binaries");
const profile = process.argv.includes("--debug") ? "debug" : "release";
const fromDir = path.join(srcTauri, "target", profile);

const FFMPEG_DLLS = [
  "avcodec-62.dll",
  "avformat-62.dll",
  "avutil-60.dll",
  "swresample-6.dll",
];
const HOOK_FILES = ["graphics-hook64.dll", "graphics-hook32.dll", "NOTICE.txt"];

const ok = (msg) => console.log(`  \x1b[32m+\x1b[0m ${msg}`);
const step = (msg) => console.log(`    ${msg}`);
const mb = (bytes) => (bytes / 1048576).toFixed(1);

if (process.platform !== "win32") {
  console.log("The capture engine is Windows-only; nothing to stage.");
  process.exit(0);
}

console.log(`\nStaging capture binaries (${profile})`);

step("building norisk-capture");
execFileSync(
  "cargo",
  [
    "build",
    ...(profile === "release" ? ["--release"] : []),
    "-p",
    "norisk-capture",
    "--bin",
    "norisk-capture",
  ],
  { cwd: srcTauri, stdio: "inherit" },
);

freeLockedHooks();

const triple = readHostTriple();
fs.mkdirSync(staging, { recursive: true });

const daemon = path.join(fromDir, "norisk-capture.exe");
if (!fs.existsSync(daemon)) {
  throw new Error(`norisk-capture.exe is not in ${fromDir} even after building.`);
}
const daemonTarget = path.join(staging, `norisk-capture-${triple}.exe`);
fs.copyFileSync(daemon, daemonTarget);
ok(`norisk-capture-${triple}.exe  (${mb(fs.statSync(daemonTarget).size)} MB)`);

const ffmpegBin = path.join(srcTauri, "third-party", "ffmpeg", "bin");
const hookDir = path.join(srcTauri, "third-party", "graphics-hook");

let ffmpegBytes = 0;
for (const dll of FFMPEG_DLLS) {
  ffmpegBytes += copyIn(ffmpegBin, dll, "FFmpeg");
}
ok(`FFmpeg: ${FFMPEG_DLLS.length} DLLs (${mb(ffmpegBytes)} MB)`);

for (const file of HOOK_FILES) {
  copyIn(hookDir, file, "the graphics hook");
}
ok("graphics hook + NOTICE.txt");

const staged = fs
  .readdirSync(staging)
  .reduce((sum, name) => sum + fs.statSync(path.join(staging, name)).size, 0);
console.log(`\n  Staged ${mb(staged)} MB into src-tauri\\binaries\n`);

function copyIn(dir, name, what) {
  const from = path.join(dir, name);
  if (!fs.existsSync(from)) {
    throw new Error(
      `${name} is missing from ${dir}.\n` +
        `Fetch ${what} first:  node scripts/setup-native-deps.mjs`,
    );
  }
  fs.copyFileSync(from, path.join(staging, name));
  return fs.statSync(from).size;
}

function freeLockedHooks() {
  for (const name of ["graphics-hook64.dll", "graphics-hook32.dll"]) {
    const inUse = path.join(fromDir, name);
    if (!fs.existsSync(inUse)) continue;

    try {
      fs.closeSync(fs.openSync(inUse, "r+"));
      continue;
    } catch (e) {
      if (e.code !== "EBUSY" && e.code !== "EPERM" && e.code !== "EACCES") throw e;
    }

    const parked = `${inUse}.inuse-${Date.now()}`;
    try {
      fs.renameSync(inUse, parked);
      step(`${name} is loaded in another process; parked as ${path.basename(parked)}`);
    } catch (e) {
      throw new Error(
        `${name} is loaded in another process and could not be moved aside (${e.code}). ` +
          `Close whatever the launcher recorded and build again.`,
      );
    }
  }

  for (const name of fs.readdirSync(fromDir)) {
    if (!name.includes(".dll.inuse-")) continue;
    try {
      fs.unlinkSync(path.join(fromDir, name));
    } catch {
    }
  }
}

function readHostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const line = out.split(/\r?\n/).find((l) => l.startsWith("host:"));
  const triple = line?.slice("host:".length).trim();
  if (!triple) {
    throw new Error("Could not read the host triple from `rustc -vV`.");
  }
  step(`triple   ${triple}`);
  return triple;
}
