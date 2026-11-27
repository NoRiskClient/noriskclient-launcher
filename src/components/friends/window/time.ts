const DAY = 24 * 60 * 60 * 1000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatClock(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** Day heading between messages: Today, Yesterday, or a full date. */
export function formatDayLabel(ts: number, t: (key: string) => string): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  if (day === today) return t("chat.today");
  if (day === today - DAY) return t("chat.yesterday");
  const sameYear = new Date(ts).getFullYear() === new Date().getFullYear();
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: sameYear ? undefined : "numeric",
  });
}

/** Short stamp for the chat list: a time today, a weekday this week, a date otherwise. */
export function formatListStamp(ts: number, t: (key: string) => string): string {
  if (!ts) return "";
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  if (day === today) return formatClock(ts);
  if (day === today - DAY) return t("chat.yesterday");
  if (today - day < 7 * DAY) return new Date(ts).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
