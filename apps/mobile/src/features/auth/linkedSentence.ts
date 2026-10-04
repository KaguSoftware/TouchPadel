/**
 * Splits a catalog sentence around its `{placeholder}` slots, so a screen can
 * render the slots as links inside one line of text (sign-up's "I agree to the
 * {terms} and have read the {privacy}."). The word order is the catalog's, so
 * Arabic places its links where Arabic puts them.
 *
 * Pure: no React Native imports (vitest runs it in node).
 */
export type SentencePart = { kind: 'text'; text: string } | { kind: 'slot'; name: string };

export function splitSentence(template: string): SentencePart[] {
  const parts: SentencePart[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  for (let m = re.exec(template); m !== null; m = re.exec(template)) {
    if (m.index > last) parts.push({ kind: 'text', text: template.slice(last, m.index) });
    parts.push({ kind: 'slot', name: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ kind: 'text', text: template.slice(last) });
  return parts;
}
