/**
 * Converts an epoch millisecond timestamp into a relative time string (e.g., "5 minutes ago").
 * TODO: Consider using a library like date-fns for more robust formatting and localization.
 * @param timestamp The epoch timestamp in milliseconds.
 * @returns A relative time string.
 */
export function timeAgo(timestamp: number | null): string {
  if (timestamp === null) {
    return 'never';
  }

  const now = Date.now();
  const secondsPast = (now - timestamp) / 1000;

  if (secondsPast < 60) {
    return `${Math.round(secondsPast)}s ago`;
  }
  if (secondsPast < 3600) {
    return `${Math.round(secondsPast / 60)}m ago`;
  }  if (secondsPast <= 86400) {
    return `${Math.round(secondsPast / 3600)}h ago`;
  }
  if (secondsPast <= 86400 * 7) {
    return `${Math.round(secondsPast / 86400)} days ago`;
  }
  if (secondsPast <= 86400 * 30) {
    const weeks = Math.round(secondsPast / (86400 * 7));
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  }
  if (secondsPast <= 86400 * 365) {
    const months = Math.round(secondsPast / (86400 * 30));
    return months === 1 ? '1 month ago' : `${months} months ago`;
  }
  
  // For dates over a year old, show the actual date
  const date = new Date(timestamp);
  const day = date.getDate();
  const month = date.toLocaleString('default', { month: 'short' });
  const year = date.getFullYear();
  
  return `${day} ${month} ${year}`;
} 