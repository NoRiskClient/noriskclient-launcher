export const ENGINE_STAGED_NAME = "norisk-capture-x86_64-pc-windows-msvc.exe";
export const ENGINE_SHIPPED_NAME = "norisk-capture.exe";

export const FFMPEG_DLLS = [
  "avcodec-62.dll",
  "avformat-62.dll",
  "avutil-60.dll",
  "swresample-6.dll",
];

export const HOOK_FILES = ["graphics-hook64.dll", "graphics-hook32.dll"];

export const LEGAL_FILES = [
  { dir: "graphics-hook", name: "NOTICE.txt", as: "graphics-hook-NOTICE.txt" },
  { dir: "ffmpeg", name: "NOTICE.txt", as: "ffmpeg-NOTICE.txt" },
  { dir: "ffmpeg", name: "LICENSE.txt", as: "ffmpeg-LICENSE.txt" },
];

export const RUNTIME_ASSET_NAME = "NoRiskClient-Windows-capture-runtime.zip";
