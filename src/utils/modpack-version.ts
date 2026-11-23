export function shortModpackVersion(versionNumber: string): string {
  return versionNumber.replace(/^[^\p{L}\p{N}[(]+/u, "").replace(/\s+for\s+(?:MC\s*)?\d[\d.]*$/i, "") || versionNumber;
}
