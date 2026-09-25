/**
 * `/protocols` search params — hand parser (no zod in the operator app), the
 * shape in build-contracts-2026-09-23 §5.1.
 *   ?run=<uuid>&step=<uuid>   open a run's sheet, or one step of it
 *   ?start=<kind>             open the start form for that protocol
 *   ?variant=type1|type2|type3   the tournament type to start
 *   ?change=<kind>&item=|addon=|promotion=|rule=<uuid>
 *                             prefill a price or promo start from the menu
 *                             editor, Stock ▸ Products, Add-ons, Promotions,
 *                             Rates and the hero builder (§5.5)
 *   ?filter=waiting|active|finished   which list is showing
 * Each param is checked on its own and anything malformed is dropped, so a
 * mangled link lands on the plain page rather than an error.
 */
export const PROTOCOL_KINDS = ['product_release', 'tournament', 'hiring', 'price_promo'] as const;
export type ProtocolKind = (typeof PROTOCOL_KINDS)[number];

export const TOURNAMENT_VARIANTS = ['type1', 'type2', 'type3'] as const;
export type TournamentVariant = (typeof TOURNAMENT_VARIANTS)[number];

/** The eight price or promo change kinds (§2.8); `shop_launch` is never offered on /tasks. */
export const PRICE_CHANGE_KINDS = [
  'price',
  'shop_launch',
  'addon_price',
  'promotion',
  'promotion_edit',
  'promotion_enable',
  'rate',
  'featured_discount',
] as const;
export type PriceChangeKind = (typeof PRICE_CHANGE_KINDS)[number];

export const PROTOCOL_FILTERS = ['waiting', 'active', 'finished'] as const;
export type ProtocolFilter = (typeof PROTOCOL_FILTERS)[number];

export interface ProtocolsSearch {
  run?: string;
  step?: string;
  start?: ProtocolKind;
  variant?: TournamentVariant;
  change?: PriceChangeKind;
  item?: string;
  addon?: string;
  promotion?: string;
  rule?: string;
  filter?: ProtocolFilter;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(v: unknown): string | undefined {
  return typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : undefined;
}

function oneOf<T extends string>(list: readonly T[], v: unknown): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

const UUID_PARAMS = ['run', 'step', 'item', 'addon', 'promotion', 'rule'] as const;

export function validateProtocolsSearch(raw: Record<string, unknown>): ProtocolsSearch {
  const out: ProtocolsSearch = {};
  for (const key of UUID_PARAMS) {
    const id = uuid(raw[key]);
    if (id) out[key] = id;
  }
  const start = oneOf(PROTOCOL_KINDS, raw.start);
  const variant = oneOf(TOURNAMENT_VARIANTS, raw.variant);
  const change = oneOf(PRICE_CHANGE_KINDS, raw.change);
  const filter = oneOf(PROTOCOL_FILTERS, raw.filter);
  if (start) out.start = start;
  if (variant) out.variant = variant;
  if (change) out.change = change;
  if (filter) out.filter = filter;
  return out;
}
