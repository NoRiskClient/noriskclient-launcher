export function withoutStableTag(version: string): string {
  return version.replace(/\s*\(stable\)\s*$/i, "");
}
