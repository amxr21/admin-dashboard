/**
 * Up to two initials for an avatar circle — "Sara Khalid" → "SK",
 * "owner@example.test" → "OE". Works for any script, Arabic names included
 * (first letter of each of the first two words). Empty input gives "".
 */
export function initialsOf(name: string): string {
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
