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