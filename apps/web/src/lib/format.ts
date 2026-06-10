const pad = (n: number): string => String(n).padStart(2, '0');

/** "14:07", always zero-padded, 24 hour clock. */
export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-06-10 14:07:03", for hover titles. */
export function exactTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Relative when recent, clock time today, date beyond. */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  if (sameDay(new Date(iso), new Date(now))) return timeOfDay(iso);
  return dayLabel(iso, now);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "Today", "Yesterday", or "March 4, 2026" for day separator rows. */
export function dayLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const today = new Date(now);
  if (sameDay(d, today)) return 'Today';
  const yesterday = new Date(now - 86_400_000);
  if (sameDay(d, yesterday)) return 'Yesterday';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
