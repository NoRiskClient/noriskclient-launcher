import motdParser from "@sfirew/minecraft-motd-parser";
import { sanitizeMotdHtml } from "./html-sanitize";

const EMPTY_MOTD_HTML = '<span class="text-white/50">No description</span>';
const INVALID_MOTD_HTML = '<span class="text-red-400">Invalid MOTD format</span>';

const SMALL_CAPS: Record<string, string> = {
  ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e", ꜰ: "f", ɢ: "g", ʜ: "h", ɪ: "i", ᴊ: "j", ᴋ: "k", ʟ: "l", ᴍ: "m",
  ɴ: "n", ᴏ: "o", ᴘ: "p", ǫ: "q", ʀ: "r", ꜱ: "s", ѕ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v", ᴡ: "w", ʏ: "y", ᴢ: "z",
};
const SMALL_CAPS_RUN = new RegExp(`[${Object.keys(SMALL_CAPS).join("")}]+`, "g");

function renderSmallCaps(html: string): string {
  return html
    .split(/(<[^>]*>)/)
    .map((part) =>
      part.startsWith("<")
        ? part
        : part.replace(SMALL_CAPS_RUN, (run) => `<span class="font-smallcaps">${[...run].map((c) => SMALL_CAPS[c]).join("")}</span>`),
    )
    .join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Harden MOTD JSON before handing it to the parser.
 * The library treats `typeof extra === "object"` as iterable, so `extra: null`
 * crashes instead of falling back gracefully.
 */
function normalizeMotdInput(motd: unknown): unknown {
  if (motd == null) return motd;
  if (typeof motd === "string" || typeof motd === "number" || typeof motd === "boolean") {
    return motd;
  }
  if (Array.isArray(motd)) {
    return motd.map(normalizeMotdInput).filter((item) => item != null);
  }
  if (typeof motd !== "object") return motd;

  const source = motd as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (key === "extra") {
      if (value == null) continue;
      if (!Array.isArray(value)) continue;
      const items = value.map(normalizeMotdInput).filter((item) => item != null);
      if (items.length > 0) normalized.extra = items;
      continue;
    }

    if (value != null) {
      normalized[key] =
        typeof value === "object" ? normalizeMotdInput(value) : value;
    }
  }

  return normalized;
}

function renderPlainTextFallback(motd: unknown, normalized: unknown): string | null {
  try {
    const plain = motdParser.autoCleanToText(normalized as string | object);
    if (!plain) return null;
    return escapeHtml(plain);
  } catch (err) {
    console.error("Failed to parse MOTD as plain text:", err);
    if (typeof motd === "string") {
      return escapeHtml(motdParser.cleanCodes(motd));
    }
    return null;
  }
}

/**
 * Parses Minecraft MOTD (Message of the Day) or similar formatted text to HTML.
 * Can be used for server MOTDs, resource pack names, shader pack names, etc.
 *
 * @param motd - The MOTD data (can be string, object, or null)
 * @returns HTML string with formatted text
 */
export function parseMotdToHtml(motd: any): string {
  if (!motd) return EMPTY_MOTD_HTML;

  const normalized =
    typeof motd === "object" && motd != null ? normalizeMotdInput(motd) : motd;

  try {
    const html = motdParser.autoToHTML(normalized as string | object);
    if (!html) return EMPTY_MOTD_HTML;
    return renderSmallCaps(sanitizeMotdHtml(html));
  } catch (err) {
    console.error("Failed to parse MOTD:", err);
    return renderPlainTextFallback(motd, normalized) ?? INVALID_MOTD_HTML;
  }
}
