import i18n from "../i18n/i18n";

/**
 * Formatiert einen ISO-Timestamp als menschenlesbaren relativen Zeitabstand.
 * Beispiele: "just now", "2h ago", "Yesterday", "3 days ago", "2 weeks ago",
 * "5 months ago", "Never". Uebersetzungen via profiles.v3.time.*.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  const t = i18n.t.bind(i18n);
  if (!iso) return t("profiles.v3.time.never");

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return t("profiles.v3.time.never");

  const diffMs = Date.now() - then;
  if (diffMs < 0) return t("profiles.v3.time.justNow");

  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return t("profiles.v3.time.justNow");

  const min = Math.floor(sec / 60);
  if (min < 60) return t("profiles.v3.time.minutesAgo", { count: min });

  const hr = Math.floor(min / 60);
  if (hr < 24) return t("profiles.v3.time.hoursAgo", { count: hr });

  const day = Math.floor(hr / 24);
  if (day === 1) return t("profiles.v3.time.yesterday");
  if (day < 7) return t("profiles.v3.time.daysAgo", { count: day });

  const week = Math.floor(day / 7);
  if (week === 1) return t("profiles.v3.time.lastWeek");
  if (week < 5) return t("profiles.v3.time.weeksAgo", { count: week });

  const month = Math.floor(day / 30);
  if (month === 1) return t("profiles.v3.time.monthAgo");
  if (month < 12) return t("profiles.v3.time.monthsAgo", { count: month });

  const year = Math.floor(day / 365);
  return year === 1
    ? t("profiles.v3.time.yearAgo")
    : t("profiles.v3.time.yearsAgo", { count: year });
}

/**
 * Formatiert Spielzeit (in Sekunden) als "12m" / "3h 47m" / "2d 4h".
 * < 1 min → "< 1m", 0/undefined → Placeholder ("—"). Einheiten (m/h/d) sind
 * bewusst nicht uebersetzt da sie in den meisten Sprachen so abgekuerzt werden.
 */
export function formatPlaytime(seconds: number | null | undefined): string {
  const t = i18n.t.bind(i18n);
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return t("profiles.v3.time.placeholder");
  if (seconds < 60) return t("profiles.v3.time.lessThanMinute");

  const totalMin = Math.floor(seconds / 60);
  if (totalMin < 60) return `${totalMin}m`;

  const totalHr = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  if (totalHr < 24) return remMin > 0 ? `${totalHr}h ${remMin}m` : `${totalHr}h`;

  const day = Math.floor(totalHr / 24);
  const remHr = totalHr % 24;
  return remHr > 0 ? `${day}d ${remHr}h` : `${day}d`;
}

/**
 * Formatiert eine Byte-Anzahl als "1.2 GB" / "340 MB" / "4.7 KB".
 * 0/undefined → Placeholder ("—"). Einheiten sind universell (SI-Praefixe),
 * brauchen keine Uebersetzung.
 */
export function formatBytes(bytes: number | null | undefined): string {
  const t = i18n.t.bind(i18n);
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return t("profiles.v3.time.placeholder");

  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  const rounded = value >= 100 ? Math.round(value) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${units[idx]}`;
}
