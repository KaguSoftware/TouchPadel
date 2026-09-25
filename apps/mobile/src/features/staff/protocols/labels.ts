/**
 * The catalog key of every field and option a protocol form can show
 * (build-contracts-2026-09-23 §4, §7.2). `@touch/core` carries the field lists
 * without labels, so each app keeps its own; these maps are typed against the
 * assembled catalog, and __tests__/labels.test.ts walks every step form of
 * every kind and change so a field can never render as a raw name.
 *
 * PURE (vitest).
 */
import type { MessageKey } from '@touch/i18n';

/** Labels by the last segment of a field's template path (`lines.qty` → `qty`). */
const BY_NAME = {
  name_en: 'staff.protocols.field.nameEn',
  name_ar: 'staff.protocols.field.nameAr',
  item_kind: 'staff.protocols.field.itemKind',
  lines: 'staff.protocols.field.lines',
  ingredient_id: 'staff.protocols.field.ingredientId',
  label: 'staff.protocols.field.label',
  qty: 'staff.protocols.field.qty',
  unit: 'staff.protocols.field.unit',
  sizes: 'staff.protocols.field.sizes',
  audience: 'staff.protocols.field.audience',
  inspiration: 'staff.protocols.field.inspiration',
  link: 'staff.protocols.field.link',
  notes: 'staff.protocols.field.notes',
  note: 'staff.protocols.field.note',
  category_id: 'staff.protocols.field.categoryId',
  servings: 'staff.protocols.field.servings',
  variant_id: 'staff.protocols.field.variantId',
  prices: 'staff.protocols.field.prices',
  price_iqd: 'staff.protocols.field.priceIqd',
  highlights_en: 'staff.protocols.field.highlightsEn',
  highlights_ar: 'staff.protocols.field.highlightsAr',
  hero: 'staff.protocols.field.hero',
  ticker: 'staff.protocols.field.ticker',
  en: 'staff.protocols.field.en',
  ar: 'staff.protocols.field.ar',
  campaign_id: 'staff.protocols.field.campaignId',
  when: 'staff.protocols.field.when',
  at: 'staff.protocols.field.at',
  photo_path: 'staff.protocols.field.photoPath',
  class: 'staff.protocols.field.class',
  format: 'staff.protocols.field.format',
  ranges: 'staff.protocols.field.ranges',
  court_ids: 'staff.protocols.field.courtIds',
  from: 'staff.protocols.field.rangeFrom',
  to: 'staff.protocols.field.rangeTo',
  capacity: 'staff.protocols.field.capacity',
  entry_fee_iqd: 'staff.protocols.field.entryFeeIqd',
  prize: 'staff.protocols.field.prize',
  text: 'staff.protocols.field.prizeText',
  iqd: 'staff.protocols.field.prizeIqd',
  budget_iqd: 'staff.protocols.field.budgetIqd',
  expected_entries: 'staff.protocols.field.expectedEntries',
  risks: 'staff.protocols.field.risks',
  sponsor: 'staff.protocols.field.sponsor',
  contact: 'staff.protocols.field.contact',
  contribution_iqd: 'staff.protocols.field.contributionIqd',
  branding: 'staff.protocols.field.branding',
  invoice: 'staff.protocols.field.invoice',
  staffing: 'staff.protocols.field.staffing',
  income_iqd: 'staff.protocols.field.incomeIqd',
  cost_iqd: 'staff.protocols.field.costIqd',
  reservation_ids: 'staff.protocols.field.reservationIds',
  moved_note: 'staff.protocols.field.movedNote',
  role: 'staff.protocols.field.role',
  why: 'staff.protocols.field.why',
  hours: 'staff.protocols.field.hours',
  start_date: 'staff.protocols.field.startDate',
  pay_min_iqd: 'staff.protocols.field.payMinIqd',
  pay_max_iqd: 'staff.protocols.field.payMaxIqd',
  candidate_ids: 'staff.protocols.field.candidateIds',
  picked_id: 'staff.protocols.field.pickedId',
  staff_id: 'staff.protocols.field.staffId',
  change: 'staff.protocols.field.change',
  reason: 'staff.protocols.field.reason',
  expected_effect: 'staff.protocols.field.expectedEffect',
  menu_item_id: 'staff.protocols.field.menuItemId',
  new_sizes: 'staff.protocols.field.newSizes',
  addons: 'staff.protocols.field.addons',
  modifier_id: 'staff.protocols.field.modifierId',
  price_delta_iqd: 'staff.protocols.field.priceDeltaIqd',
  promotion: 'staff.protocols.field.promotion',
  type: 'staff.protocols.field.promoType',
  value: 'staff.protocols.field.promoValue',
  starts_at: 'staff.protocols.field.startsAt',
  ends_at: 'staff.protocols.field.endsAt',
  weekdays: 'staff.protocols.field.weekdays',
  hour_from: 'staff.protocols.field.hourFrom',
  hour_to: 'staff.protocols.field.hourTo',
  scope: 'staff.protocols.field.scope',
  courtIds: 'staff.protocols.field.scopeCourts',
  categoryIds: 'staff.protocols.field.scopeCategories',
  itemIds: 'staff.protocols.field.scopeItems',
  limits: 'staff.protocols.field.limits',
  total: 'staff.protocols.field.limitTotal',
  perCustomer: 'staff.protocols.field.limitPerCustomer',
  minSpendIqd: 'staff.protocols.field.limitMinSpend',
  auto: 'staff.protocols.field.auto',
  public_code: 'staff.protocols.field.publicCode',
  code_single_use: 'staff.protocols.field.codeSingleUse',
  promotion_id: 'staff.protocols.field.promotionId',
  rule_id: 'staff.protocols.field.ruleId',
  rule: 'staff.protocols.field.rule',
  court_id: 'staff.protocols.field.courtId',
  days_of_week: 'staff.protocols.field.daysOfWeek',
  start_time: 'staff.protocols.field.startTime',
  end_time: 'staff.protocols.field.endTime',
  priority: 'staff.protocols.field.priority',
  valid_from: 'staff.protocols.field.validFrom',
  valid_to: 'staff.protocols.field.validTo',
  is_active: 'staff.protocols.field.isActive',
  discount_pct: 'staff.protocols.field.discountPct',
  recommendation: 'staff.protocols.field.recommendation',
  rule_prices: 'staff.protocols.field.finalRulePrices',
  promotion_value: 'staff.protocols.field.promotionValue',
} as const satisfies Record<string, MessageKey>;

/** Where one name means two things, the whole template path decides. */
const BY_PATH = {
  'capacity.count': 'staff.protocols.field.capacityCount',
  'capacity.unit': 'staff.protocols.field.capacityUnit',
  'servings.count': 'staff.protocols.field.servingsCount',
  'sponsor.name': 'staff.protocols.field.sponsorName',
  'rule.name': 'staff.protocols.field.ruleName',
  'rule.prices': 'staff.protocols.field.rulePrices',
} as const satisfies Record<string, MessageKey>;

function lastSegment(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? path : path.slice(i + 1);
}

/** The label of a field by its template path, or null when none is written (a test fails on that). */
export function fieldLabelKey(templatePath: string): MessageKey | null {
  const byPath = (BY_PATH as Record<string, MessageKey>)[templatePath];
  if (byPath) return byPath;
  return (BY_NAME as Record<string, MessageKey>)[lastSegment(templatePath)] ?? null;
}

/** Enum options, by the field's template path. */
const OPTIONS = {
  item_kind: {
    drink: 'work.item.kind.drink',
    dessert: 'work.item.kind.dessert',
    food: 'work.item.kind.food',
  },
  'lines.unit': {
    g: 'staff.protocols.option.unit.g',
    ml: 'staff.protocols.option.unit.ml',
    pc: 'staff.protocols.option.unit.pc',
  },
  class: {
    A: 'staff.protocols.option.class.A',
    B: 'staff.protocols.option.class.B',
    C: 'staff.protocols.option.class.C',
  },
  format: {
    americano: 'staff.protocols.option.format.americano',
    mexicano: 'staff.protocols.option.format.mexicano',
    knockout: 'staff.protocols.option.format.knockout',
    league: 'staff.protocols.option.format.league',
  },
  'capacity.unit': {
    players: 'staff.protocols.option.capacityUnit.players',
    pairs: 'staff.protocols.option.capacityUnit.pairs',
  },
  when: {
    now: 'staff.protocols.option.when.now',
    date: 'staff.protocols.option.when.date',
  },
  role: {
    cashier: 'op.roles.cashier',
    prep: 'op.roles.prep',
    court_desk: 'op.roles.court_desk',
    manager: 'op.roles.manager',
    owner: 'op.roles.owner',
    head_barista: 'op.roles.head_barista',
    barista: 'op.roles.barista',
    head_chef: 'op.roles.head_chef',
    chef: 'op.roles.chef',
    driver: 'op.roles.driver',
    marketing: 'op.roles.marketing',
  },
  recommendation: {
    go: 'staff.protocols.option.recommendation.go',
    change: 'staff.protocols.option.recommendation.change',
    drop: 'staff.protocols.option.recommendation.drop',
  },
  'promotion.type': {
    percent: 'staff.protocols.option.promoType.percent',
    amount: 'staff.protocols.option.promoType.amount',
  },
  change: {
    price: 'work.protocol.change.price',
    shop_launch: 'work.protocol.change.shop_launch',
    addon_price: 'work.protocol.change.addon_price',
    promotion: 'work.protocol.change.promotion',
    promotion_edit: 'work.protocol.change.promotion_edit',
    promotion_enable: 'work.protocol.change.promotion_enable',
    rate: 'work.protocol.change.rate',
    featured_discount: 'work.protocol.change.featured_discount',
  },
} as const satisfies Record<string, Record<string, MessageKey>>;

/** The label of one enum option, or null. */
export function optionLabelKey(templatePath: string, option: string): MessageKey | null {
  const table = (OPTIONS as Record<string, Record<string, MessageKey>>)[templatePath];
  return table?.[option] ?? null;
}

/** Weekday chips, 0 = Sunday … 6 = Saturday (0067, 0071). */
export const WEEKDAY_KEYS = [
  'staff.protocols.option.weekday.sun',
  'staff.protocols.option.weekday.mon',
  'staff.protocols.option.weekday.tue',
  'staff.protocols.option.weekday.wed',
  'staff.protocols.option.weekday.thu',
  'staff.protocols.option.weekday.fri',
  'staff.protocols.option.weekday.sat',
] as const satisfies readonly MessageKey[];
