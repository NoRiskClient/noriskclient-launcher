export const WORLDCUP_END = "2026-07-20T00:00:00Z";

export function isWorldCupEventActive(at: Date = new Date()): boolean {
  return at.getTime() < new Date(WORLDCUP_END).getTime();
}
