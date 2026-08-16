import DOMPurify, { type Config } from "dompurify";

/**
 * Shared HTML sanitization for anything that ends up in `dangerouslySetInnerHTML`.
 * All input here is remote/attacker-controlled (server MOTDs, CurseForge changelogs
 * and mod descriptions), so it must never be trusted.
 */

/**
 * MOTD parser output is only `<span style>`/`<br>`. Even so, the parser copies the
 * JSON `color` field verbatim into the style attribute, which lets a malicious server
 * inject arbitrary CSS (fixed-position overlays, `background:url(...)` beacons, etc.).
 * We therefore strip the style down to the handful of properties the parser is
 * actually allowed to emit, with validated values.
 */
const MOTD_STYLE_ALLOWLIST: Record<string, RegExp> = {
  color: /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^[a-z]+$/i,
  "font-weight": /^(?:normal|bold|bolder|lighter|[1-9]00)$/i,
  "font-style": /^(?:normal|italic|oblique)$/i,
  "text-decoration": /^(?:none|underline|overline|line-through|\s)+$/i,
};

function filterMotdStyle(style: string): string {
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const sep = decl.indexOf(":");
    if (sep === -1) continue;
    const prop = decl.slice(0, sep).trim().toLowerCase();
    const value = decl.slice(sep + 1).trim();
    const validator = MOTD_STYLE_ALLOWLIST[prop];
    if (validator && validator.test(value)) kept.push(`${prop}: ${value}`);
  }
  return kept.join("; ");
}

const MOTD_SANITIZE_CONFIG: Config = {
  ALLOWED_TAGS: ["span", "br"],
  ALLOWED_ATTR: ["style", "class"],
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

/** Sanitize Minecraft MOTD HTML: span/br only, with a CSS-property allowlist on `style`. */
export function sanitizeMotdHtml(html: string): string {
  const hook = (_node: Element, data: { attrName: string; attrValue: string }) => {
    if (data.attrName === "style") data.attrValue = filterMotdStyle(data.attrValue);
  };
  DOMPurify.addHook("uponSanitizeAttribute", hook);
  try {
    return DOMPurify.sanitize(html, MOTD_SANITIZE_CONFIG) as string;
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute");
  }
}

const RICH_SANITIZE_CONFIG: Config = {
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ADD_ATTR: ["target", "rel"],
};

/**
 * Sanitize rich HTML content (CurseForge changelogs / mod descriptions) before it is
 * rendered. Keeps DOMPurify's safe default tag set, drops scripts/event handlers/
 * dangerous protocols, and forces external links to open safely.
 */
export function sanitizeRichHtml(html: string): string {
  const hook = (node: Element) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  };
  DOMPurify.addHook("afterSanitizeAttributes", hook);
  try {
    return DOMPurify.sanitize(html, RICH_SANITIZE_CONFIG) as string;
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes");
  }
}
