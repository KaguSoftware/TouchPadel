/**
 * The customer ban and customer tags with a rule (0449), as the record reads
 * them: app.customer_ban_and_tags, app.set_customer_ban, app.set_customer_tags,
 * app.save_customer_tag, app.delete_customer_tag.
 *
 * The ban is a customer_flags row of type 'ban' (its label is the reason), so
 * every screen that already draws flags shows it; isBanned() reads it off any
 * flag list. A tag carries a percent off café and shop goods and/or the court
 * fee; percents travel as basis points (the 0342 convention), and the screen
 * only ever shows what the server says the bills will get (`effective`).
 * A server without 0449 answers RPC_MISSING and the record shows none of it.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, type Locale, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';

export type TagRule = { id: string; name: string; cafe_bp: number | null; court_bp: number | null };
export type CatalogTag = TagRule & { members: number };
export type CarriedTag = TagRule & { set_by: { id: string; name: string } | null; set_at: string };
export type EffectivePart = {
  kind: 'percent' | 'amount';
  value: number;
  tag: string | null;
} | null;
export type CustomerBan = {
  reason: string | null;
  by: { id: string; name: string } | null;
  at: string;
};

export interface CustomerRules {
  ban: CustomerBan | null;
  tags: CarriedTag[];
  effective: { cafe: EffectivePart; court: EffectivePart; reason: string } | null;
  coming: { bookings: number; seats: number };
  isStaff: boolean;
  catalog: CatalogTag[];
  canManage: boolean;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function readTag(raw: unknown): TagRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const name = str(r.name);
  if (!id || !name) return null;
  return { id, name, cafe_bp: num(r.cafe_bp), court_bp: num(r.court_bp) };
}

function readWho(raw: unknown): { id: string; name: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return str(r.id) ? { id: str(r.id)!, name: str(r.name) ?? '' } : null;
}

function readPart(raw: unknown): EffectivePart {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const value = num(r.value);
  if ((r.kind !== 'percent' && r.kind !== 'amount') || value === null) return null;
  return { kind: r.kind, value, tag: str(r.tag) };
}

/** app.customer_ban_and_tags, defensively: anything malformed reads as absent. */
export function parseCustomerRules(raw: unknown): CustomerRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const banRaw = r.ban && typeof r.ban === 'object' ? (r.ban as Record<string, unknown>) : null;
  const eff =
    r.effective && typeof r.effective === 'object'
      ? (r.effective as Record<string, unknown>)
      : null;
  const coming = (r.coming && typeof r.coming === 'object' ? r.coming : {}) as Record<
    string,
    unknown
  >;
  return {
    ban: banRaw
      ? { reason: str(banRaw.reason), by: readWho(banRaw.by), at: str(banRaw.at) ?? '' }
      : null,
    tags: (Array.isArray(r.tags) ? r.tags : []).flatMap((t) => {
      const tag = readTag(t);
      if (!tag) return [];
      const o = t as Record<string, unknown>;
      return [{ ...tag, set_by: readWho(o.set_by), set_at: str(o.set_at) ?? '' }];
    }),
    effective: eff
      ? { cafe: readPart(eff.cafe), court: readPart(eff.court), reason: str(eff.reason) ?? '' }
      : null,
    coming: { bookings: num(coming.bookings) ?? 0, seats: num(coming.seats) ?? 0 },
    isStaff: r.is_staff === true,
    catalog: (Array.isArray(r.catalog) ? r.catalog : []).flatMap((t) => {
      const tag = readTag(t);
      return tag ? [{ ...tag, members: num((t as Record<string, unknown>).members) ?? 0 }] : [];
    }),
    canManage: r.can_manage === true,
  };
}

/** True when any flag list (search row, record, booking, roster) carries the full ban. */
export function isBanned(flags: readonly { type: string }[] | null | undefined): boolean {
  return (flags ?? []).some((f) => f.type === 'ban');
}

/** Basis points as the percent people type and read: 1500 → "15", 1250 → "12.5". */
export function bpToPercentText(bp: number | null, locale: Locale = 'en'): string {
  if (bp === null) return '';
  return formatNumber(bp / 100, locale);
}

/**
 * What a person typed into a percent box, as basis points. '' is no discount
 * (null); anything outside 0.01..100 or not a number is 'invalid'. At most two
 * decimals are kept (basis points are whole).
 */
export function percentTextToBp(text: string): number | null | 'invalid' {
  const t = text.trim().replace(',', '.').replace('%', '');
  if (t === '') return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return 'invalid';
  const bp = Math.round(Number(t) * 100);
  return bp >= 1 && bp <= 10_000 ? bp : 'invalid';
}

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

/** One tag's rule in words: "15% off everything", "30% off court fee", "No discount". */
export function ruleWords(
  tag: Pick<TagRule, 'cafe_bp' | 'court_bp'>,
  t: Tr,
  locale: Locale,
): string {
  const { cafe_bp: cafe, court_bp: court } = tag;
  if (cafe !== null && cafe === court)
    return t('ws.customerRules.tags.both', { pct: bpToPercentText(cafe, locale) });
  const parts: string[] = [];
  if (cafe !== null)
    parts.push(t('ws.customerRules.tags.cafe', { pct: bpToPercentText(cafe, locale) }));
  if (court !== null)
    parts.push(t('ws.customerRules.tags.court', { pct: bpToPercentText(court, locale) }));
  return parts.length ? parts.join(' · ') : t('ws.customerRules.tags.none');
}

export const RULES_KEY = (customerId: string | null) =>
  ['customerRules', customerId ?? 'catalog'] as const;

/** The record's read. `enabled` false for a role that may not read it. */
export function useCustomerRules(customerId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: RULES_KEY(customerId),
    queryFn: async () =>
      parseCustomerRules(
        await appRpc<unknown>('customer_ban_and_tags', { p_customer_id: customerId }),
      ),
    enabled,
  });
}

/** After any write: the rules, the record (flags), the searches that draw flags, the discount reads. */
export function useInvalidateCustomerRules() {
  const qc = useQueryClient();
  return (customerId: string) => {
    void qc.invalidateQueries({ queryKey: ['customerRules'] });
    void qc.invalidateQueries({ queryKey: ['customer', customerId] });
    void qc.invalidateQueries({ queryKey: ['customerSearch'] });
    void qc.invalidateQueries({ queryKey: ['customerDirectory'] });
  };
}

export const setCustomerBan = (customerId: string, banned: boolean, reason: string | null) =>
  appRpc('set_customer_ban', { p_customer_id: customerId, p_banned: banned, p_reason: reason });

export const setCustomerTags = (customerId: string, tagIds: readonly string[]) =>
  appRpc('set_customer_tags', { p_customer_id: customerId, p_tag_ids: [...tagIds] });

export const saveCustomerTag = (tag: {
  id: string | null;
  name: string;
  cafe_bp: number | null;
  court_bp: number | null;
}) =>
  appRpc<TagRule>('save_customer_tag', {
    p_tag_id: tag.id,
    p_name: tag.name,
    p_cafe_bp: tag.cafe_bp,
    p_court_bp: tag.court_bp,
  });

export const deleteCustomerTag = (tagId: string) =>
  appRpc<{ id: string; members: number }>('delete_customer_tag', { p_tag_id: tagId });
