import motdParser from "@sfirew/minecraft-motd-parser";

/**
 * Parses Minecraft MOTD (Message of the Day) or similar formatted text to HTML.
 * Can be used for server MOTDs, resource pack names, shader pack names, etc.
 * 
 * @param motd - The MOTD data (can be string, object, or null)
 * @returns HTML string with formatted text
 */
export function parseMotdToHtml(motd: any): string {
  if (!motd) return '<span class="text-white/50">No description</span>';
  try {
    const html = motdParser.autoToHTML(motd);
    return html || '<span class="text-white/50">No description</span>';
  } catch (err) {
    console.error("Failed to parse MOTD:", err);
    if (typeof motd === "string") {
      const cleaned = motdParser.cleanCodes(motd);
      // Basic HTML escape
      return cleaned
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
    try {
      return JSON.stringify(motd);
    } catch (e) {}
    return '<span class="text-red-400">Invalid MOTD format</span>';
  }
}

