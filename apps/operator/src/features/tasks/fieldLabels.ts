/**
 * Labels for the protocol forms on /tasks. The field lists come from
 * `@touch/core/protocols`, which carries no words (§7.2: labels come from each
 * app's catalog), so each field's record key maps to a catalog key here.
 *
 * A label is looked up by the field's dotted path first (`prize.text`,
 * `rule.prices`), then by its own name, so a name that means one thing
 * everywhere (`name_en`, `notes`) is written once and a name that means two
 * things (`prices` as size prices or as a rate's price by length) is written
 * per path. The map is typed against the catalog, so a missing key fails
 * typecheck rather than printing its path on screen.
 */
import type { MessageKey } from '@touch/i18n';

const F = 'ws.team.tasks.form.field';

export const FIELD_LABELS = {
  // Shared names
  name_en: `${F}.name_en`,
  name_ar: `${F}.name_ar`,
  notes: `${F}.notes`,
  note: `${F}.note`,
  en: `${F}.en`,
  ar: `${F}.ar`,
  // Product release
  item_kind: `${F}.item_kind`,
  lines: `${F}.lines`,
  ingredient_id: `${F}.ingredient_id`,
  label: `${F}.label`,
  qty: `${F}.qty`,
  unit: `${F}.unit`,
  sizes: `${F}.sizes`,
  audience: `${F}.audience`,
  inspiration: `${F}.inspiration`,
  link: `${F}.link`,
  category_id: `${F}.category_id`,
  servings: `${F}.servings`,
  variant_id: `${F}.variant_id`,
  'servings.count': `${F}.servingsCount`,
  highlights_en: `${F}.highlights_en`,
  highlights_ar: `${F}.highlights_ar`,
  hero: `${F}.hero`,
  ticker: `${F}.ticker`,
  campaign_id: `${F}.campaign_id`,
  // Tournament plan
  class: `${F}.class`,
  format: `${F}.format`,
  ranges: `${F}.ranges`,
  court_ids: `${F}.court_ids`,
  from: `${F}.from`,
  to: `${F}.to`,
  capacity: `${F}.capacity`,
  'capacity.unit': `${F}.capacityUnit`,
  'capacity.count': `${F}.capacityCount`,
  entry_fee_iqd: `${F}.entry_fee_iqd`,
  prize: `${F}.prize`,
  'prize.text': `${F}.prizeText`,
  'prize.iqd': `${F}.prizeIqd`,
  budget_iqd: `${F}.budget_iqd`,
  expected_entries: `${F}.expected_entries`,
  risks: `${F}.risks`,
  sponsor: `${F}.sponsor`,
  'sponsor.name': `${F}.sponsorName`,
  contact: `${F}.contact`,
  contribution_iqd: `${F}.contribution_iqd`,
  branding: `${F}.branding`,
  invoice: `${F}.invoice`,
  // Price or promotion change
  change: `${F}.change`,
  reason: `${F}.reason`,
  expected_effect: `${F}.expected_effect`,
  menu_item_id: `${F}.menu_item_id`,
  prices: `${F}.prices`,
  price_iqd: `${F}.price_iqd`,
  new_sizes: `${F}.new_sizes`,
  addons: `${F}.addons`,
  modifier_id: `${F}.modifier_id`,
  price_delta_iqd: `${F}.price_delta_iqd`,
  promotion: `${F}.promotion`,
  type: `${F}.type`,
  value: `${F}.value`,
  starts_at: `${F}.starts_at`,
  ends_at: `${F}.ends_at`,
  weekdays: `${F}.weekdays`,
  hour_from: `${F}.hour_from`,
  hour_to: `${F}.hour_to`,
  scope: `${F}.scope`,
  courtIds: `${F}.courtIds`,
  categoryIds: `${F}.categoryIds`,
  itemIds: `${F}.itemIds`,
  limits: `${F}.limits`,
  total: `${F}.total`,
  perCustomer: `${F}.perCustomer`,
  minSpendIqd: `${F}.minSpendIqd`,
  auto: `${F}.auto`,
  public_code: `${F}.public_code`,
  code_single_use: `${F}.code_single_use`,
  promotion_id: `${F}.promotion_id`,
  rule_id: `${F}.rule_id`,
  rule: `${F}.rule`,
  'rule.name': `${F}.ruleName`,
  'rule.prices': `${F}.rulePrices`,
  court_id: `${F}.court_id`,
  days_of_week: `${F}.days_of_week`,
  start_time: `${F}.start_time`,
  end_time: `${F}.end_time`,
  priority: `${F}.priority`,
  valid_from: `${F}.valid_from`,
  valid_to: `${F}.valid_to`,
  is_active: `${F}.is_active`,
  discount_pct: `${F}.discount_pct`,
  reservation_ids: `${F}.reservation_ids`,
  moved_note: `${F}.moved_note`,
} as const satisfies Record<string, MessageKey>;

type LabelPath = keyof typeof FIELD_LABELS;

/** The catalog key for a field at `path` (record keys only, no list indexes), or null. */
export function fieldLabelKey(path: readonly string[]): MessageKey | null {
  const dotted = path.join('.');
  const leaf = path[path.length - 1] ?? '';
  // A path inside a list reads the list's own member path (`servings.count`),
  // which is also its last two names.
  const tail = path.slice(-2).join('.');
  for (const key of [dotted, tail, leaf]) {
    if (key in FIELD_LABELS) return FIELD_LABELS[key as LabelPath];
  }
  return null;
}

/** Option labels for the enums the /tasks forms offer, by field name. */
export const OPTION_LABELS: Record<string, Record<string, MessageKey>> = {
  item_kind: { drink: 'work.item.kind.drink', dessert: 'work.item.kind.dessert', food: 'work.item.kind.food' },
  unit: { g: 'op.stock.unit.g', ml: 'op.stock.unit.ml', pc: 'op.stock.unit.pc', players: 'ws.team.tasks.form.option.players', pairs: 'ws.team.tasks.form.option.pairs' },
  class: { A: 'ws.team.tasks.form.option.classA', B: 'ws.team.tasks.form.option.classB', C: 'ws.team.tasks.form.option.classC' },
  format: {
    americano: 'ws.team.tasks.form.option.americano',
    mexicano: 'ws.team.tasks.form.option.mexicano',
    knockout: 'ws.team.tasks.form.option.knockout',
    league: 'ws.team.tasks.form.option.league',
  },
  type: { percent: 'ws.team.tasks.form.option.percent', amount: 'ws.team.tasks.form.option.amount' },
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
};
