export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

// Whole calendar days between a moment and now (local time), so "yesterday"
// means the previous date rather than 24+ hours ago.
function calendarDaysSince(iso: string): number {
  const then = new Date(iso);
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((startOf(now) - startOf(then)) / 86400000));
}

// How long something's been going: "today", "3 days", "1 week", "9 weeks",
// "4 months", "1 year". Weeks run up to three months so an overdue loan
// still reads precisely ("9 weeks", not "2 months").
export function duration(iso: string): string {
  const days = calendarDaysSince(iso);
  if (days < 1) return 'today';
  if (days < 7) return days === 1 ? '1 day' : `${days} days`;
  if (days < 91) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? '1 week' : `${weeks} weeks`;
  }
  if (days < 365) return `${Math.floor(days / 30)} months`;
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year' : `${years} years`;
}

// A spelled-out "ago": "today", "yesterday", "2 days ago", "3 weeks ago".
export function durationAgo(iso: string): string {
  const days = calendarDaysSince(iso);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  return `${duration(iso)} ago`;
}

// A day in the recent past: "today", "yesterday", "Tue" within the week,
// otherwise "12 Sep" (plus the year if it's not this one).
export function dayLabel(iso: string): string {
  const days = calendarDaysSince(iso);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  const date = new Date(iso);
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'short' });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
