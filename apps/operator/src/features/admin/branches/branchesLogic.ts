/**
 * Pure helpers for Setup › Branches (multi-venue slice 4, plan MV1).
 * Server truth lives in app.create_branch / app.branch_readiness /
 * app.open_branch (0223); these only shape the form and the checklist.
 */

export type ReadinessKey =
  | 'courts_and_rates'
  | 'opening_hours'
  | 'manager'
  | 'till'
  | 'menu'
  | 'telegram'
  | 'opening_stock';

export interface ReadinessRow {
  key: ReadinessKey;
  required: boolean;
  ok: boolean;
}

export interface NewBranchDraft {
  sourceVenueId: string;
  nameEn: string;
  nameAr: string;
  slug: string;
  phone: string;
  addressEn: string;
  addressAr: string;
  timezone: string;
}

/** The server's rule (0223): 2–32 lowercase letters, digits and dashes, starting with a letter or digit. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** A slug suggestion from the English name: "Touch Mansour" -> "touch-mansour". */
export function suggestSlug(nameEn: string): string {
  return nameEn
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
}

export type DraftProblem = 'nameEn' | 'nameAr' | 'slug' | 'source' | 'phone';

/** What the form must fix before Create is offered (the server checks again). */
export function draftProblems(d: NewBranchDraft): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (!d.sourceVenueId) out.push('source');
  if (d.nameEn.trim().length < 2 || d.nameEn.trim().length > 80) out.push('nameEn');
  if (d.nameAr.trim().length < 2 || d.nameAr.trim().length > 80) out.push('nameAr');
  if (!SLUG_RE.test(d.slug.trim())) out.push('slug');
  if (d.phone.trim() && !/^\+?[0-9 ()-]{6,20}$/.test(d.phone.trim())) out.push('phone');
  return out;
}

/** The arguments app.create_branch takes, blanks as null. */
export function createBranchArgs(d: NewBranchDraft): Record<string, string | null> {
  const blank = (s: string) => (s.trim() ? s.trim() : null);
  return {
    p_source_venue: d.sourceVenueId,
    p_slug: d.slug.trim(),
    p_name_en: d.nameEn.trim(),
    p_name_ar: d.nameAr.trim(),
    p_phone: blank(d.phone),
    p_timezone: blank(d.timezone),
    p_address_en: blank(d.addressEn),
    p_address_ar: blank(d.addressAr),
  };
}

/** Required rows first, then warnings; stable within each group (the server's order). */
export function sortReadiness(rows: readonly ReadinessRow[]): ReadinessRow[] {
  return [...rows.filter((r) => r.required), ...rows.filter((r) => !r.required)];
}

/** True when "Open to guests" may be pressed: every required row is done. */
export function readyToOpen(rows: readonly ReadinessRow[]): boolean {
  return rows.length > 0 && rows.every((r) => !r.required || r.ok);
}
