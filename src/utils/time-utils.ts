import i18n from '../i18n/i18n';

/**
 * Converts an epoch millisecond timestamp into a relative time string (e.g., "5 minutes ago").
 * TODO: Consider using a library like date-fns for more robust formatting and localization.
 * @param timestamp The epoch timestamp in milliseconds.
 * @returns A relative time string.
 */
export function timeAgo(timestamp: number | null): string {
  if (timestamp === null) {
    return i18n.t('time.never');
  }

  const now = Date.now();
  const secondsPast = (now - timestamp) / 1000;

  if (secondsPast < 60) {
    return i18n.t('time.seconds_ago', { count: Math.round(secondsPast) });
  }
  if (secondsPast < 3600) {
    return i18n.t('time.minutes_ago', { count: Math.round(secondsPast / 60) });
  }
  if (secondsPast <= 86400) {
    return i18n.t('time.hours_ago', { count: Math.round(secondsPast / 3600) });
  }

  const daysPast = Math.round(secondsPast / 86400);

  if (daysPast < 7) {
    return i18n.t('time.days_ago', { count: daysPast });
  }

  if (daysPast < 30) {
    const weeks = Math.round(daysPast / 7);
    return i18n.t('time.weeks_ago', { count: weeks });
  }

  if (daysPast < 365) {
    const months = Math.round(daysPast / 30);
    return i18n.t('time.months_ago', { count: months });
  }

  const years = Math.round(daysPast / 365);
  return i18n.t('time.years_ago', { count: years });
}

/**
 * Replaces raw timestamps embedded in a string with a human-readable, localized form.
 * Detects Unix-ms (13-14 digits), Unix-s (10 digits) and ISO 8601 timestamps and renders
 * them as e.g. "until Jul 15, 2026, 12:34 PM (2h 30m left)". Past timestamps older than a
 * year and non-timestamp numbers are left untouched. Reusable for any backend message that
 * embeds a deadline/expiry timestamp (bans, cooldowns, trials, ...).
 */
export function humanizeTimestamps(message: string): string {
  const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})|\b\d{13,14}\b|\b1\d{9}\b/g;

  return message.replace(TIMESTAMP, (match) => {
    let date: Date;
    if (/^\d{13,14}$/.test(match))   date = new Date(Number(match));
    else if (/^\d{10}$/.test(match)) date = new Date(Number(match) * 1000);
    else                             date = new Date(match);

    if (isNaN(date.getTime())) return match;

    const now = Date.now();
    const diff = date.getTime() - now;

    // Reject numbers that resolve to more than 1 year in the past (not a timestamp).
    if (diff < -365 * 86_400_000) return match;

    if (diff > 100 * 365 * 86_400_000) return i18n.t('time.permanent');

    const dateStr = date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    if (diff <= 0) return i18n.t('time.until_expired', { date: dateStr });

    const days    = Math.floor(diff / 86_400_000);
    const hours   = Math.floor((diff % 86_400_000) / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000)  / 60_000);

    const remaining = days > 0
      ? i18n.t('time.remaining_days_hours', { days, hours })
      : hours > 0
        ? i18n.t('time.remaining_hours_minutes', { hours, minutes })
        : i18n.t('time.remaining_minutes', { minutes });
    return i18n.t('time.until_remaining', { date: dateStr, remaining });
  });
}