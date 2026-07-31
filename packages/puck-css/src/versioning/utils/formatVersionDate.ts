/**
 * Formats a DocumentVersion createdAt date string for display in the editor UI.
 * Returns an empty string for invalid/missing dates (safe to use as a falsy guard).
 */
export function formatVersionDate(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Returns a human-readable day-group label for a version timestamp:
 * 'Today', 'Yesterday', or a short date like 'Jul 15'.
 *
 * Day boundaries use local browser time. API timestamps are UTC ISO strings,
 * so users near midnight in timezones ahead of UTC may see a version group
 * under a different day than expected — this is intentional local-time behaviour.
 */
export function dayLabel(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';

  const ref = new Date();

  const startOfToday = new Date(ref);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const startOfDate = new Date(date);
  startOfDate.setHours(0, 0, 0, 0);

  if (startOfDate.getTime() === startOfToday.getTime()) return 'Today';
  if (startOfDate.getTime() === startOfYesterday.getTime()) return 'Yesterday';

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
