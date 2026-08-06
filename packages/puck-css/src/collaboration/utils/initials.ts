/**
 * Derives up to two uppercase initials from a display name, using the first and
 * last word ("Ana Maria Reyes" → "AR") to match the editor prototype's
 * collaborator avatars.
  *
 * Returns '' when the name has no usable characters, which callers treat as
 * "render the icon fallback instead" rather than drawing an empty circle.
 */
/**
 * A word can only contribute an initial if it starts with a letter or an emoji.
 * Filtering per word rather than validating the finished pair matters: testing the
 * concatenation let one bad word discard the other's initial too, so "Alice Smith
 * (Contractor)" produced "A(" and fell all the way back to the generic icon.
 */
const STARTS_WITH_LABEL_CHAR = /^[\p{L}\p{Extended_Pictographic}]/u;

export function getInitials(name: string | undefined | null): string {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => STARTS_WITH_LABEL_CHAR.test(word));
  if (words.length === 0) return '';

  const first = Array.from(words[0] ?? '')[0] ?? '';
  const last =
    words.length > 1 ? (Array.from(words[words.length - 1] ?? '')[0] ?? '') : '';

  return (first + last).toUpperCase();
}
