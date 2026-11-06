/**
 * The name in Today's greeting: the first name and the first letter of the
 * surname ("Sait.A"), so it stays on one line and the grid keeps its four rows.
 * One word is left as written.
 */
export function greetingName(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words[0] ?? '';
  const surname = words[words.length - 1]!;
  // Capitals in Latin script; Arabic has none, so those pass through unchanged.
  const [first, ...rest] = Array.from(words[0]!);
  return `${first!.toUpperCase()}${rest.join('').toLowerCase()}.${Array.from(surname)[0]!.toUpperCase()}`;
}
