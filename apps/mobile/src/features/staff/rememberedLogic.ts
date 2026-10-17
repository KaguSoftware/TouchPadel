/**
 * Which choice a staff page opens on (Sait, 2026-10-17: "one row of filters,
 * remembered"): what the link asked for, else what was picked last time on
 * this phone, else the page's own default. A remembered value the page no
 * longer offers (a role change, a filter that went) is ignored.
 *
 * PURE (vitest).
 */
export function openingChoice<T extends string>(
  allowed: readonly T[],
  fallback: T,
  remembered: string | undefined,
  fromLink?: string | null,
): T {
  const ok = (v: string | null | undefined): v is T =>
    v != null && (allowed as readonly string[]).includes(v);
  if (ok(fromLink)) return fromLink;
  if (ok(remembered)) return remembered;
  return fallback;
}

/** The stored map, read leniently: anything that is not a string map is an empty one. */
export function parseChoices(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}
