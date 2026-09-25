/**
 * The protocol forms both apps render (docs/design/protocols/build-contracts-2026-09-23.md
 * §2.8, §7.2): the built-in steps of each kind, and the field list of every
 * step's record, the start forms and the owner-added step included. The
 * operator's step sheets and the phone's step pages build their form from the
 * same list for a `step_key` (plan #38), so the two apps cannot ask for
 * different things.
 *
 * Labels are not here: each app keeps its own catalog. The server's check hooks
 * stay the authority; `validate.ts` walks these lists so a form marks a field
 * before the round trip, with the hint name the server would use.
 */
import { HIREABLE_ROLES, type StaffRole } from '../staff/roles';
import {
  PRICE_CHANGE_KINDS,
  STEP_KEYS,
  type PhotoFolder,
  type PriceChangeKind,
  type ProtocolKind,
  type TournamentVariant,
} from './types';

// ── Caps ────────────────────────────────────────────────────────────────────

/**
 * The text caps every protocol, checklist and note write enforces (§2.1):
 * titles 120, names 80, checklist items 200, decision notes 1000, and 2000 for
 * notes and the free text of records, release notes included. Over a cap the
 * server raises TEXT_TOO_LONG with the field as its hint.
 */
export const TEXT_CAPS = {
  title: 120,
  name: 80,
  checklistItem: 200,
  decisionNote: 1000,
  freeText: 2000,
} as const;

/** The tighter caps a few records set for themselves (§2.8). */
export const RECORD_CAPS = {
  /** A new item's name, in the proposal and at the price step. */
  itemName: 60,
  /** Release `propose.link` (https only). */
  link: 300,
  /** `highlights_en` / `highlights_ar` of a marketing step. */
  highlights: 300,
  heroLine: 80,
  tickerLine: 120,
  /** Hiring `open_position.hours`. */
  hours: 300,
  /** A scheduled launch is at most this many days ahead. */
  launchDaysAhead: 90,
} as const;

// ── Role groups (§2.1) ──────────────────────────────────────────────────────

const MGMT: readonly StaffRole[] = ['manager', 'owner'];
const HEADS: readonly StaffRole[] = ['head_barista', 'head_chef'];

/**
 * The kinds a role may start (§2.7 `start_protocol`): a product release the
 * head roles and management; a tournament management and the court desk
 * (tournament_desk_start, #67); a hiring run management; a price or promotion
 * change a manager, marketing or the owner.
 */
export function startableKinds(role: StaffRole | null | undefined): ProtocolKind[] {
  if (!role) return [];
  const kinds: ProtocolKind[] = [];
  if (HEADS.includes(role) || MGMT.includes(role)) kinds.push('product_release');
  if (role === 'court_desk' || MGMT.includes(role)) kinds.push('tournament');
  if (MGMT.includes(role)) kinds.push('hiring');
  if (role === 'marketing' || MGMT.includes(role)) kinds.push('price_promo');
  return kinds;
}

/**
 * The change kinds a starter may pick for a price or promotion change: every
 * one for a manager and the owner; every one but `shop_launch` for marketing,
 * because hidden products are offered on no screen marketing sees (§2.8). Used
 * by the phone's start form and by `/tasks` on the operator.
 */
export function priceChangeKinds(role: StaffRole | null | undefined): PriceChangeKind[] {
  if (!role) return [];
  if (MGMT.includes(role)) return [...PRICE_CHANGE_KINDS];
  if (role === 'marketing') return PRICE_CHANGE_KINDS.filter((k) => k !== 'shop_launch');
  return [];
}

// ── Built-in steps (§2.8; mirrors app.protocol_step_defs) ────────────────────

export interface BuiltInStep {
  kind: ProtocolKind;
  stepKey: string;
  actorRoles: readonly StaffRole[];
  /** The run's starter is the assignee (release `test`). */
  assignToStarter: boolean;
  /** The default of "Needs my OK". */
  needsOwnerOk: boolean;
  /** "Needs my OK" cannot be changed, so the editor hides the switch (plan #58). */
  okFixed: boolean;
  optional: boolean;
  after: readonly string[];
  fixed: 'first' | 'last' | null;
  photoFolder: PhotoFolder | null;
  photosMin: number;
  photosMax: number;
  /** `mgmt`: only managers and the owner see the record; the involved see the step only. */
  recordVisibility: 'run' | 'mgmt';
}

type StepSeed = Omit<BuiltInStep, 'kind' | 'assignToStarter' | 'okFixed' | 'photoFolder' | 'photosMin' | 'photosMax'> &
  Partial<Pick<BuiltInStep, 'assignToStarter' | 'okFixed' | 'photoFolder' | 'photosMin' | 'photosMax'>>;

function seed(kind: ProtocolKind, steps: StepSeed[]): BuiltInStep[] {
  return steps.map((s) => ({
    kind,
    assignToStarter: false,
    okFixed: false,
    photoFolder: null,
    photosMin: 0,
    photosMax: 0,
    ...s,
  }));
}

const RELEASE_STEPS = seed('product_release', [
  { stepKey: 'propose', actorRoles: HEADS, needsOwnerOk: false, optional: false, after: [], fixed: 'first', photoFolder: 'proposals', photosMax: 6, recordVisibility: 'run' },
  { stepKey: 'test', actorRoles: HEADS, assignToStarter: true, needsOwnerOk: false, optional: false, after: ['propose'], fixed: null, photoFolder: 'tests', photosMin: 1, photosMax: 6, recordVisibility: 'run' },
  { stepKey: 'analysis', actorRoles: ['manager'], needsOwnerOk: true, okFixed: true, optional: false, after: ['test'], fixed: null, recordVisibility: 'mgmt' },
  { stepKey: 'marketing', actorRoles: ['marketing'], needsOwnerOk: true, optional: false, after: ['test'], fixed: null, photoFolder: 'marketing', photosMax: 6, recordVisibility: 'run' },
  { stepKey: 'launch', actorRoles: ['owner'], needsOwnerOk: false, okFixed: true, optional: false, after: ['analysis', 'marketing'], fixed: 'last', recordVisibility: 'run' },
]);

// The plan is the manager's or the court desk's, assigned to the starter so a
// reopened plan goes back to them and not to every desk (#67).
const TOURNAMENT_STEPS = seed('tournament', [
  { stepKey: 'plan', actorRoles: ['manager', 'court_desk'], assignToStarter: true, needsOwnerOk: false, optional: false, after: [], fixed: 'first', recordVisibility: 'mgmt' },
  { stepKey: 'feasibility', actorRoles: ['manager'], needsOwnerOk: true, optional: false, after: ['plan'], fixed: null, recordVisibility: 'mgmt' },
  { stepKey: 'marketing', actorRoles: ['marketing'], needsOwnerOk: false, optional: true, after: ['feasibility'], fixed: null, photoFolder: 'marketing', photosMax: 6, recordVisibility: 'run' },
  { stepKey: 'courts', actorRoles: ['court_desk'], needsOwnerOk: false, optional: false, after: ['feasibility'], fixed: null, recordVisibility: 'run' },
  { stepKey: 'ready', actorRoles: ['manager'], needsOwnerOk: false, optional: false, after: ['courts', 'marketing'], fixed: 'last', photoFolder: 'steps', photosMax: 6, recordVisibility: 'run' },
]);

const HIRING_STEPS = seed('hiring', [
  { stepKey: 'open_position', actorRoles: ['manager'], needsOwnerOk: true, optional: false, after: [], fixed: 'first', recordVisibility: 'mgmt' },
  { stepKey: 'interviews', actorRoles: ['manager'], needsOwnerOk: true, optional: false, after: ['open_position'], fixed: null, recordVisibility: 'mgmt' },
  { stepKey: 'add_staff', actorRoles: ['owner'], needsOwnerOk: false, okFixed: true, optional: false, after: ['interviews'], fixed: 'last', recordVisibility: 'mgmt' },
]);

const PRICE_PROMO_STEPS = seed('price_promo', [
  { stepKey: 'propose', actorRoles: ['manager', 'marketing'], needsOwnerOk: false, optional: false, after: [], fixed: 'first', recordVisibility: 'run' },
  { stepKey: 'numbers', actorRoles: ['manager'], needsOwnerOk: true, okFixed: true, optional: false, after: ['propose'], fixed: null, recordVisibility: 'mgmt' },
  { stepKey: 'announce', actorRoles: ['marketing'], needsOwnerOk: false, optional: true, after: ['numbers'], fixed: null, photoFolder: 'marketing', photosMax: 6, recordVisibility: 'run' },
  { stepKey: 'apply', actorRoles: ['manager'], needsOwnerOk: false, optional: false, after: ['numbers', 'announce'], fixed: 'last', recordVisibility: 'run' },
]);

/**
 * The default template of a kind. A type 2 tournament drops `feasibility`, its
 * `marketing` and `courts` come straight after `plan`, and every OK is off (Q3:
 * the manager decides).
 */
export function builtInSteps(kind: ProtocolKind, variant?: TournamentVariant | null): BuiltInStep[] {
  switch (kind) {
    case 'product_release':
      return RELEASE_STEPS.map((s) => ({ ...s }));
    case 'hiring':
      return HIRING_STEPS.map((s) => ({ ...s }));
    case 'price_promo':
      return PRICE_PROMO_STEPS.map((s) => ({ ...s }));
    case 'tournament':
      if (variant !== 'type2') return TOURNAMENT_STEPS.map((s) => ({ ...s }));
      return TOURNAMENT_STEPS.filter((s) => s.stepKey !== 'feasibility').map((s) => ({
        ...s,
        needsOwnerOk: false,
        after: s.after.map((a) => (a === 'feasibility' ? 'plan' : a)),
      }));
  }
}

export function builtInStep(
  kind: ProtocolKind,
  stepKey: string,
  variant?: TournamentVariant | null,
): BuiltInStep | null {
  return builtInSteps(kind, variant).find((s) => s.stepKey === stepKey) ?? null;
}

/** The step a run of this kind is started by submitting (`p_first_record`). */
export function firstStepKey(kind: ProtocolKind): string {
  return STEP_KEYS[kind][0];
}

// ── Field lists ─────────────────────────────────────────────────────────────

export type FieldType =
  /** One line, in the writer's language. */
  | 'text'
  /** Free text: notes, briefs, reasons. */
  | 'longText'
  /** An https link. */
  | 'url'
  | 'enum'
  /** A whole number. */
  | 'int'
  /** Whole IQD, never negative unless `min` says otherwise. */
  | 'iqd'
  /** A decimal quantity. */
  | 'number'
  | 'uuid'
  /** A list of distinct ids. */
  | 'uuids'
  /** A list of distinct whole numbers (weekdays). */
  | 'ints'
  /** `YYYY-MM-DD`. */
  | 'date'
  /** An ISO instant. */
  | 'datetime'
  /** `HH:MM` or `HH:MM:SS`. */
  | 'time'
  | 'bool'
  /** A list of objects, each described by `fields`. */
  | 'list'
  /** An object described by `fields`. */
  | 'object'
  /** `{"<duration_min>": price_iqd}`. */
  | 'priceMap';

export interface FieldDef {
  /** The record key, and the hint the server names in RECORD_INVALID / TEXT_TOO_LONG. */
  readonly name: string;
  readonly type: FieldType;
  readonly required: boolean;
  /** Text: the character cap. Numbers: the largest value allowed. */
  readonly max?: number;
  /** Numbers: the smallest value allowed. */
  readonly min?: number;
  /** Numbers: `min` itself is refused (`qty > 0`). */
  readonly exclusiveMin?: boolean;
  readonly options?: readonly string[];
  /** Lists, id lists, number lists and price maps. */
  readonly minItems?: number;
  readonly maxItems?: number;
  /** The members of each list element, or of the object. */
  readonly fields?: readonly FieldDef[];
  /** Of these members at least one must be filled (a size's EN or AR name). */
  readonly oneOf?: readonly string[];
  /** Filled when the submitter is one of the step's deciders (release `propose.category_id`). */
  readonly deciderOnly?: boolean;
}

export interface StepForm {
  kind: ProtocolKind | null;
  /** Null for an owner-added step. */
  stepKey: string | null;
  fields: readonly FieldDef[];
  /** Top-level groups of which at least one member must be filled. */
  oneOf: readonly (readonly string[])[];
  photoFolder: PhotoFolder | null;
  photosMin: number;
  photosMax: number;
}

const f = {
  text: (name: string, required: boolean, max: number = TEXT_CAPS.name): FieldDef => ({ name, type: 'text', required, max }),
  long: (name: string, required = false, max: number = TEXT_CAPS.freeText): FieldDef => ({ name, type: 'longText', required, max }),
  enumOf: (name: string, options: readonly string[], required = true): FieldDef => ({ name, type: 'enum', required, options }),
  uuid: (name: string, required = true): FieldDef => ({ name, type: 'uuid', required }),
  iqd: (name: string, required: boolean, min = 0, exclusiveMin = false): FieldDef => ({ name, type: 'iqd', required, min, exclusiveMin }),
  int: (name: string, required: boolean, min?: number, max?: number): FieldDef => ({ name, type: 'int', required, min, max }),
  line: (name: string, max: number): FieldDef => ({
    name,
    type: 'object',
    required: false,
    fields: [
      { name: 'en', type: 'text', required: true, max },
      { name: 'ar', type: 'text', required: true, max },
    ],
  }),
};

const NOTES = f.long('notes');

const SIZE_PRICES: FieldDef = {
  name: 'prices',
  type: 'list',
  required: true,
  maxItems: 12,
  fields: [f.uuid('variant_id'), f.iqd('price_iqd', true, 0, true)],
};

const NEW_SIZES: FieldDef = {
  name: 'new_sizes',
  type: 'list',
  required: false,
  maxItems: 4,
  oneOf: ['name_en', 'name_ar'],
  fields: [f.text('name_en', false), f.text('name_ar', false), f.iqd('price_iqd', true, 0, true)],
};

const ADDONS: FieldDef = {
  name: 'addons',
  type: 'list',
  required: true,
  minItems: 1,
  maxItems: 30,
  fields: [f.uuid('modifier_id'), f.iqd('price_delta_iqd', true)],
};

/** The promotion a `promotion` or `promotion_edit` change proposes (0067's arguments). */
export const PROMOTION_FIELDS: readonly FieldDef[] = [
  f.text('name_en', true),
  f.text('name_ar', true),
  f.enumOf('type', ['percent', 'amount']),
  f.int('value', true, 1),
  { name: 'starts_at', type: 'datetime', required: false },
  { name: 'ends_at', type: 'datetime', required: false },
  { name: 'weekdays', type: 'ints', required: true, min: 0, max: 6, maxItems: 7 },
  { name: 'hour_from', type: 'time', required: false },
  { name: 'hour_to', type: 'time', required: false },
  {
    name: 'scope',
    type: 'object',
    required: true,
    fields: [
      { name: 'courtIds', type: 'uuids', required: false },
      { name: 'categoryIds', type: 'uuids', required: false },
      { name: 'itemIds', type: 'uuids', required: false },
    ],
  },
  {
    name: 'limits',
    type: 'object',
    required: false,
    fields: [f.int('total', false, 1), f.int('perCustomer', false, 1), f.iqd('minSpendIqd', false)],
  },
  { name: 'auto', type: 'bool', required: false },
  { name: 'public_code', type: 'text', required: false, max: 16 },
  { name: 'code_single_use', type: 'bool', required: false },
];

/** The court rate a `rate` change proposes (0071's arguments). */
export const RATE_RULE_FIELDS: readonly FieldDef[] = [
  f.text('name', true),
  f.uuid('court_id', false),
  { name: 'days_of_week', type: 'ints', required: true, min: 0, max: 6, minItems: 1, maxItems: 7 },
  { name: 'start_time', type: 'time', required: true },
  { name: 'end_time', type: 'time', required: true },
  { name: 'prices', type: 'priceMap', required: true, minItems: 1, maxItems: 12 },
  f.int('priority', false),
  { name: 'valid_from', type: 'date', required: false },
  { name: 'valid_to', type: 'date', required: false },
  { name: 'is_active', type: 'bool', required: true },
];

const MARKETING_FIELDS: readonly FieldDef[] = [
  f.long('highlights_en', true, RECORD_CAPS.highlights),
  f.long('highlights_ar', true, RECORD_CAPS.highlights),
  f.line('hero', RECORD_CAPS.heroLine),
  f.line('ticker', RECORD_CAPS.tickerLine),
  f.uuid('campaign_id', false),
  NOTES,
];

const SCHEDULE_FIELDS: readonly FieldDef[] = [
  f.enumOf('when', ['now', 'date']),
  { name: 'at', type: 'datetime', required: false },
];

const RELEASE_FORMS: Record<string, readonly FieldDef[]> = {
  propose: [
    f.text('name_en', false, RECORD_CAPS.itemName),
    f.text('name_ar', false, RECORD_CAPS.itemName),
    f.enumOf('item_kind', ['drink', 'dessert', 'food']),
    {
      name: 'lines',
      type: 'list',
      required: true,
      minItems: 1,
      maxItems: 30,
      oneOf: ['ingredient_id', 'label'],
      fields: [
        f.uuid('ingredient_id', false),
        f.text('label', false),
        { name: 'qty', type: 'number', required: true, min: 0, exclusiveMin: true },
        f.enumOf('unit', ['g', 'ml', 'pc']),
      ],
    },
    {
      name: 'sizes',
      type: 'list',
      required: true,
      minItems: 1,
      maxItems: 4,
      oneOf: ['name_en', 'name_ar'],
      fields: [f.text('name_en', false), f.text('name_ar', false)],
    },
    f.long('audience'),
    f.long('inspiration'),
    { name: 'link', type: 'url', required: false, max: RECORD_CAPS.link },
    NOTES,
    { name: 'category_id', type: 'uuid', required: false, deciderOnly: true },
  ],
  test: [
    {
      name: 'servings',
      type: 'list',
      required: true,
      minItems: 1,
      fields: [f.uuid('variant_id'), f.int('count', true, 1, 50)],
    },
    NOTES,
  ],
  analysis: [
    { ...SIZE_PRICES, minItems: 1 },
    f.text('name_en', true, RECORD_CAPS.itemName),
    f.text('name_ar', true, RECORD_CAPS.itemName),
    NOTES,
  ],
  marketing: MARKETING_FIELDS,
  launch: [...SCHEDULE_FIELDS, f.text('photo_path', true, 200)],
};

const TOURNAMENT_PLAN_SHORT: readonly FieldDef[] = [
  f.enumOf('class', ['A', 'B', 'C']),
  f.text('name_en', true),
  f.text('name_ar', true),
  {
    name: 'ranges',
    type: 'list',
    required: true,
    minItems: 1,
    maxItems: 14,
    fields: [
      { name: 'court_ids', type: 'uuids', required: true, minItems: 1 },
      { name: 'from', type: 'datetime', required: true },
      { name: 'to', type: 'datetime', required: true },
    ],
  },
  {
    name: 'capacity',
    type: 'object',
    required: true,
    fields: [f.enumOf('unit', ['players', 'pairs']), f.int('count', true, 2, 512)],
  },
  NOTES,
];

const TOURNAMENT_PLAN_FULL: readonly FieldDef[] = [
  ...TOURNAMENT_PLAN_SHORT.slice(0, 3),
  f.enumOf('format', ['americano', 'mexicano', 'knockout', 'league']),
  ...TOURNAMENT_PLAN_SHORT.slice(3, 5),
  f.iqd('entry_fee_iqd', false),
  {
    name: 'prize',
    type: 'object',
    required: false,
    fields: [f.long('text'), f.iqd('iqd', false)],
  },
  f.iqd('budget_iqd', false),
  f.int('expected_entries', false, 0),
  f.long('risks'),
  NOTES,
  {
    name: 'sponsor',
    type: 'object',
    required: false,
    fields: [
      f.text('name', true),
      f.text('contact', true),
      f.iqd('contribution_iqd', true),
      f.long('branding'),
      { name: 'invoice', type: 'bool', required: false },
    ],
  },
];

const TOURNAMENT_FORMS: Record<string, readonly FieldDef[]> = {
  feasibility: [f.long('staffing', true), f.iqd('income_iqd', true), f.iqd('cost_iqd', true), f.long('risks', true), NOTES],
  marketing: MARKETING_FIELDS,
  courts: [{ name: 'reservation_ids', type: 'uuids', required: true, minItems: 1 }, f.long('moved_note')],
  ready: [NOTES],
};

const HIRING_FORMS: Record<string, readonly FieldDef[]> = {
  open_position: [
    f.enumOf('role', HIREABLE_ROLES),
    f.long('why', true),
    f.long('hours', true, RECORD_CAPS.hours),
    { name: 'start_date', type: 'date', required: true },
    f.iqd('pay_min_iqd', false),
    f.iqd('pay_max_iqd', false),
  ],
  interviews: [
    { name: 'candidate_ids', type: 'uuids', required: true, minItems: 1 },
    f.uuid('picked_id'),
  ],
  add_staff: [f.uuid('staff_id')],
};

const PROPOSE_COMMON: readonly FieldDef[] = [
  f.enumOf('change', PRICE_CHANGE_KINDS),
  f.long('reason', true),
  f.long('expected_effect', true),
];

const PROPOSE_BY_CHANGE: Record<PriceChangeKind, readonly FieldDef[]> = {
  // `prices` may be empty when `new_sizes` is not (validate.ts checks the pair).
  price: [f.uuid('menu_item_id'), { ...SIZE_PRICES, required: false }, NEW_SIZES],
  shop_launch: [f.uuid('menu_item_id'), { ...SIZE_PRICES, minItems: 1 }],
  addon_price: [ADDONS],
  promotion: [{ name: 'promotion', type: 'object', required: true, fields: PROMOTION_FIELDS }],
  promotion_edit: [f.uuid('promotion_id'), { name: 'promotion', type: 'object', required: true, fields: PROMOTION_FIELDS }],
  promotion_enable: [f.uuid('promotion_id')],
  rate: [f.uuid('rule_id', false), { name: 'rule', type: 'object', required: true, fields: RATE_RULE_FIELDS }],
  featured_discount: [f.uuid('menu_item_id'), f.int('discount_pct', true, 0, 99)],
};

/** Final figures at `numbers`: exactly the proposal's targets, same shapes. */
const NUMBERS_BY_CHANGE: Record<PriceChangeKind, readonly FieldDef[]> = {
  price: [{ ...SIZE_PRICES, required: false }, NEW_SIZES],
  shop_launch: [{ ...SIZE_PRICES, required: false }],
  addon_price: [{ ...ADDONS, required: false }],
  promotion: [f.int('promotion_value', false, 1)],
  promotion_edit: [f.int('promotion_value', false, 1)],
  promotion_enable: [],
  rate: [{ name: 'rule_prices', type: 'priceMap', required: false, minItems: 1, maxItems: 12 }],
  featured_discount: [f.int('discount_pct', false, 0, 99)],
};

/** The owner's own steps: a note and 0 to 6 photos in `steps` (§2.7). */
export const GENERIC_STEP_FORM: StepForm = {
  kind: null,
  stepKey: null,
  fields: [f.long('note')],
  oneOf: [],
  photoFolder: 'steps',
  photosMin: 0,
  photosMax: 6,
};

export interface StepFormOptions {
  variant?: TournamentVariant | null;
  /** Price or promotion change: which of the eight kinds this run carries. */
  change?: PriceChangeKind | null;
}

function fieldsFor(kind: ProtocolKind, stepKey: string, opts: StepFormOptions): readonly FieldDef[] | null {
  switch (kind) {
    case 'product_release':
      return RELEASE_FORMS[stepKey] ?? null;
    case 'tournament':
      if (stepKey === 'plan') return opts.variant === 'type2' ? TOURNAMENT_PLAN_SHORT : TOURNAMENT_PLAN_FULL;
      return TOURNAMENT_FORMS[stepKey] ?? null;
    case 'hiring':
      return HIRING_FORMS[stepKey] ?? null;
    case 'price_promo':
      switch (stepKey) {
        case 'propose':
          return [...PROPOSE_COMMON, ...(opts.change ? PROPOSE_BY_CHANGE[opts.change] : [])];
        case 'numbers':
          return [
            f.enumOf('recommendation', ['go', 'change', 'drop']),
            ...(opts.change ? NUMBERS_BY_CHANGE[opts.change] : []),
            f.long('note'),
          ];
        case 'announce':
          return [f.uuid('campaign_id', false), f.line('hero', RECORD_CAPS.heroLine), f.line('ticker', RECORD_CAPS.tickerLine), NOTES];
        case 'apply':
          return SCHEDULE_FIELDS;
        default:
          return null;
      }
  }
}

/**
 * The form of one built-in step, or null for a key the kind does not have. An
 * owner-added step (`stepKey` null) is GENERIC_STEP_FORM. A type 2 tournament's
 * `plan` is the short form (class, names, ranges, capacity, notes).
 */
export function stepForm(
  kind: ProtocolKind,
  stepKey: string | null,
  opts: StepFormOptions = {},
): StepForm | null {
  if (stepKey === null) return GENERIC_STEP_FORM;
  const step = builtInStep(kind, stepKey, opts.variant);
  const fields = step ? fieldsFor(kind, stepKey, opts) : null;
  if (!step || !fields) return null;
  const oneOf = kind === 'product_release' && stepKey === 'propose' ? [['name_en', 'name_ar']] : [];
  return {
    kind,
    stepKey,
    fields,
    oneOf,
    photoFolder: step.photoFolder,
    photosMin: step.photosMin,
    photosMax: step.photosMax,
  };
}

/** A start form is its kind's first step, submitted as `p_first_record` with the run's title. */
export function startForm(kind: ProtocolKind, opts: StepFormOptions = {}): StepForm {
  const form = stepForm(kind, firstStepKey(kind), opts);
  // Every kind has a first step with a form; a null here is a broken table above.
  if (!form) throw new Error(`no start form for ${kind}`);
  return form;
}

/**
 * The decision data an approval must carry: only a release proposal, whose
 * decider picks the cafe category the draft item is filed in.
 */
export function decisionFields(kind: ProtocolKind, stepKey: string | null): readonly FieldDef[] {
  if (kind === 'product_release' && stepKey === 'propose') return [f.uuid('category_id')];
  return [];
}
