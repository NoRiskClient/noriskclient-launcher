import { loaderLabel } from "../../../lib/loader-icons";
import type { PreparedItem } from "../../../types/support-request";

export function previewText(item: PreparedItem): string {
  return typeof item.preview === "string" ? item.preview : "";
}

export function itemData(item: PreparedItem): Record<string, unknown> | null {
  const text = previewText(item).trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : null;

export const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

export const joinParts = (parts: (string | null | undefined)[], separator = " · "): string | null =>
  parts.filter(Boolean).join(separator) || null;

export const loaderName = (loader: string | null | undefined) => (loader ? loaderLabel(loader) : "");

export const loaderText = (d: Record<string, unknown>) =>
  joinParts([loaderName(str(d.loader)), str(d.loaderVersion)], " ");

export const javaText = (d: Record<string, unknown>) => joinParts([str(d.javaVersion), str(d.javaVendor)]);

export function formatMb(mb: number | null): string | null {
  if (mb == null || mb <= 0) return null;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

export function optionValue(item: PreparedItem, key: string): string | null {
  const prefix = `${key}:`;
  const line = previewText(item).split("\n").find((l) => l.startsWith(prefix));
  return line ? str(line.slice(prefix.length).trim()) : null;
}

export function countNrcModules(item: PreparedItem): { count: number; on: number } | null {
  const modules = itemData(item)?.modules;
  if (!Array.isArray(modules)) return null;
  const on = modules.filter((entry) => {
    const values = entry && typeof entry === "object" ? (entry as Record<string, unknown>).values : null;
    return Array.isArray(values) && values.some((v) => v && v.name === "isEnabled" && v.value === true);
  }).length;
  return { count: modules.length, on };
}

export const LOG_RENDER_CAP = 2000;

export const REDACTION_RE = /<(?:PLAYER_UUID|PLAYER|IP|USER|HOST|REDACTED[A-Z_]*)>|\*{3,}/g;

export function lineLevel(line: string): "error" | "warn" | null {
  if (/\b(ERROR|FATAL)\b/.test(line)) return "error";
  if (/\bWARN(ING)?\b/.test(line)) return "warn";
  return null;
}

interface LogStats {
  lines: string[];
  errors: number;
  firstErrors: number[];
}

const logCache = new WeakMap<PreparedItem, LogStats>();

export function analyzeLog(item: PreparedItem): LogStats {
  const cached = logCache.get(item);
  if (cached) return cached;
  const lines = previewText(item).split(/\r?\n/);
  let errors = 0;
  const firstErrors: number[] = [];
  lines.forEach((line, i) => {
    if (lineLevel(line) !== "error") return;
    errors++;
    if (firstErrors.length < 5) firstErrors.push(i);
  });
  const stats = { lines, errors, firstErrors };
  logCache.set(item, stats);
  return stats;
}

export function parseCrashReport(text: string) {
  const info = { description: null as string | null, exception: null as string | null, suspectedMods: [] as string[] };
  try {
    const lines = text.split(/\r?\n/);
    info.description = text.match(/^Description:\s*(.+)$/m)?.[1]?.trim() ?? null;
    info.exception = lines.find((l) => /^[\w.$]+(Exception|Error)\b/.test(l.trim()))?.trim() ?? null;
    const susIndex = lines.findIndex((l) => /^\s*Suspected Mods?:/i.test(l));
    if (susIndex >= 0) {
      const rest = lines[susIndex].replace(/^\s*Suspected Mods?:/i, "").trim();
      if (rest && !/^none$/i.test(rest)) info.suspectedMods.push(rest);
      for (let i = susIndex + 1; i < lines.length; i++) {
        if (!/^\s+\S/.test(lines[i])) break;
        info.suspectedMods.push(lines[i].trim());
      }
    }
  } catch {}
  return info;
}

export type JvmCulprit = "java" | "amd" | "nvidia" | "intel" | "graphics";

const CULPRITS: [RegExp, JvmCulprit][] = [
  [/^(jvm\.dll|libjvm)/i, "java"],
  [/^(atio6axx|amdxc64|atig)/i, "amd"],
  [/^(nvoglv|nvwgf2um)/i, "nvidia"],
  [/^ig\w*icd/i, "intel"],
  [/(lwjgl|glfw)/i, "graphics"],
];

export function parseJvmCrash(text: string) {
  const info = { exception: null as string | null, module: null as string | null, culprit: null as JvmCulprit | null };
  try {
    info.exception = text.match(/#\s+((?:EXCEPTION_\w+|SIG[A-Z]+)(?:\s*\([^)]*\))?)/)?.[1]?.trim() ?? null;
    const frame = text.match(/#\s*Problematic frame:\s*\r?\n#\s*(.+)/)?.[1]?.trim();
    info.module = frame?.match(/\[([^\]+]+)\+0x/)?.[1] ?? frame?.match(/\[([^\]\s]+)/)?.[1] ?? null;
    const module = info.module;
    if (module) info.culprit = CULPRITS.find(([re]) => re.test(module))?.[1] ?? null;
  } catch {}
  return info;
}

interface ModEntry {
  name: string;
  version: string | null;
  source: string | null;
  enabled: boolean;
}

export function parseModList(item: PreparedItem): ModEntry[] | null {
  const mods = itemData(item)?.mods;
  if (!Array.isArray(mods)) return null;
  return mods
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((m) => ({
      name: str(m.name) ?? str(m.id) ?? str(m.fileName) ?? "?",
      version: str(m.version),
      source: str(m.source),
      enabled: m.enabled !== false,
    }));
}
