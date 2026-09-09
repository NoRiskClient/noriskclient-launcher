import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ENGINE_SHIPPED_NAME,
  ENGINE_STAGED_NAME,
  FFMPEG_DLLS,
  HOOK_FILES,
  LEGAL_FILES,
  RUNTIME_ASSET_NAME,
} from "./native-deps-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binaries = path.join(repoRoot, "src-tauri", "binaries");

if (process.platform !== "win32") {
  console.error("The capture runtime is Windows-only; nothing to pack.");
  process.exit(1);
}

const outArg = process.argv.indexOf("--out");
const outDir = outArg >= 0 ? path.resolve(process.argv[outArg + 1]) : path.join(repoRoot, "src-tauri", "target", "capture-runtime");
fs.mkdirSync(outDir, { recursive: true });

const staging = fs.mkdtempSync(path.join(os.tmpdir(), "nrc-capture-runtime-"));
fs.mkdirSync(path.join(staging, "licenses"));

copy(path.join(binaries, ENGINE_STAGED_NAME), path.join(staging, ENGINE_SHIPPED_NAME));
for (const dll of [...FFMPEG_DLLS, ...HOOK_FILES]) copy(path.join(binaries, dll), path.join(staging, dll));
for (const file of LEGAL_FILES) copy(path.join(binaries, file.as), path.join(staging, "licenses", file.as));

const zip = path.join(outDir, RUNTIME_ASSET_NAME);
fs.rmSync(zip, { force: true });
execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${staging}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal -Force`,
  ],
  { stdio: "inherit" },
);
fs.rmSync(staging, { recursive: true, force: true });

const sha256 = createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
fs.writeFileSync(`${zip}.sha256`, `${sha256}\n`);

const mb = (fs.statSync(zip).size / 1048576).toFixed(1);
console.log(`\n  ${RUNTIME_ASSET_NAME}  ${mb} MB`);
console.log(`  sha256  ${sha256}`);
console.log(`  written ${zip}\n`);
console.log("To test the download path locally, serve the zip over HTTP and build with:");
console.log(`  NRC_CAPTURE_RUNTIME_SHA256=${sha256}`);
console.log(`  NRC_CAPTURE_RUNTIME_URL=http://localhost:8000/${RUNTIME_ASSET_NAME}`);

function copy(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`${path.basename(from)} is missing from ${binaries}. Run: yarn native-deps && yarn stage-native`);
  }
  fs.copyFileSync(from, to);
}
