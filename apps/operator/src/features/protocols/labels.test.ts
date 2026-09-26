import { describe, expect, it } from 'vitest';
import { catalogs } from '@touch/i18n';
import {
  GENERIC_STEP_FORM,
  PRICE_CHANGE_KINDS,
  STEP_KEYS,
  TOURNAMENT_VARIANTS,
  stepForm,
  type FieldDef,
  type ProtocolKind,
} from '@touch/core/protocols';
import { fieldLabelKey, optionLabelKey } from './labels';

// Every step form on the operator is walked from the shared field lists, so a
// field or a choice with no words would render as its raw name. This walks
// every form of every kind — each tournament type, each of the eight price or
// promo change kinds — and wants a label in both catalogs for each.

function lookup(locale: 'en' | 'ar', key: string): unknown {
  let node: unknown = catalogs[locale];
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return node;
}

/** Fields another screen writes, which the form never renders. */
const NOT_RENDERED = new Set(['variant_id', 'modifier_id']);

function walk(fields: readonly FieldDef[], path: string[], out: { path: string[]; def: FieldDef }[]) {
  for (const f of fields) {
    if (NOT_RENDERED.has(f.name)) continue;
    const p = [...path, f.name];
    out.push({ path: p, def: f });
    if (f.fields) walk(f.fields, p, out);
  }
}

function everyField(): { path: string[]; def: FieldDef }[] {
  const out: { path: string[]; def: FieldDef }[] = [];
  walk(GENERIC_STEP_FORM.fields, [], out);
  for (const kind of Object.keys(STEP_KEYS) as ProtocolKind[]) {
    for (const key of STEP_KEYS[kind]) {
      const variants = kind === 'tournament' ? TOURNAMENT_VARIANTS : [null];
      const changes = kind === 'price_promo' ? PRICE_CHANGE_KINDS : [null];
      for (const variant of variants) {
        for (const change of changes) {
          const form = stepForm(kind, key, { variant, change });
          if (form) walk(form.fields, [], out);
        }
      }
    }
  }
  return out;
}

describe('step form words', () => {
  const fields = everyField();

  it('walks a real number of fields', () => {
    expect(fields.length).toBeGreaterThan(100);
  });

  it('has a label for every field, in English and Arabic', () => {
    const missing = new Set<string>();
    for (const { path } of fields) {
      const key = fieldLabelKey(path);
      if (!key || typeof lookup('ar', key) !== 'string') missing.add(path.join('.'));
    }
    expect([...missing]).toEqual([]);
  });

  it('has words for every choice, in English and Arabic', () => {
    const missing = new Set<string>();
    for (const { path, def } of fields) {
      if (def.type !== 'enum') continue;
      for (const option of def.options ?? []) {
        const key = optionLabelKey(path, option);
        if (!key || typeof lookup('en', key) !== 'string' || typeof lookup('ar', key) !== 'string') missing.add(`${path.join('.')}=${option}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('names roles, item kinds and change kinds with the words the rest of the app uses', () => {
    expect(optionLabelKey(['role'], 'chef')).toBe('op.roles.chef');
    expect(optionLabelKey(['item_kind'], 'drink')).toBe('work.item.kind.drink');
    expect(optionLabelKey(['change'], 'rate')).toBe('work.protocol.change.rate');
    expect(optionLabelKey(['lines', 0, 'unit'], 'ml')).toBe('ws.protocols.options.unit.ml');
    expect(optionLabelKey(['capacity', 'unit'], 'pairs')).toBe('ws.protocols.options.capacity_unit.pairs');
  });
});

// The screens build some keys from a value (a kind, a filter, a decision, a
// readiness check), which typecheck cannot follow through a cast. Each family
// is listed here with every value the engine can send, in both catalogs.
describe('screen words built from a value', () => {
  const KINDS = ['product_release', 'tournament', 'hiring', 'price_promo'];
  const families: Record<string, readonly string[]> = {
    'ws.protocols.cards.lead': KINDS,
    'ws.protocols.start.firstStep': KINDS,
    'ws.protocols.start.variantLead': TOURNAMENT_VARIANTS,
    'ws.protocols.lists.filter': ['waiting', 'active', 'finished'],
    'ws.protocols.decision.send': ['approve', 'send_back', 'stop'],
    'ws.protocols.decision.explain': ['approve', 'send_back', 'stop'],
    'ws.protocols.decision.done': ['approve', 'send_back', 'stop'],
    'ws.protocols.how.problem': ['both', 'tooLong', 'actors'],
    'ws.protocols.how.fixed': ['first', 'last'],
    'ws.protocols.run.reviewStatus': ['thin', 'failed'],
    'ws.protocols.context.readiness': ['names', 'prices', 'photo', 'recipe', 'category', 'warn_allergens', 'warn_serve_temp'],
    'ws.protocols.context.numbers.cols': ['size', 'now', 'new', 'cost', 'marginNow', 'marginNew', 'sold'],
    'ws.protocols.context.tournament': ['capacity_players', 'capacity_pairs'],
    'ws.protocols.options.format': ['americano', 'mexicano', 'knockout', 'league'],
    'ws.protocols.elsewhere': ['courts.body', 'courts.go', 'courts.notYours', 'hire.body', 'hire.go', 'hire.notYours'],
    'ws.protocols.candidates': ['noneFirst', 'noPickFirst', 'ready'],
    'work.protocol.kind': KINDS,
    'work.protocol.variant': TOURNAMENT_VARIANTS,
    'work.protocol.change': PRICE_CHANGE_KINDS,
    'work.protocol.runStatus': ['active', 'scheduled', 'live', 'done', 'stopped', 'withdrawn'],
    'work.protocol.stepStatus': ['waiting', 'open', 'submitted', 'passed', 'skipped', 'stopped'],
    'work.protocol.decision': ['approve', 'auto', 'send_back', 'stop'],
    'work.team': ['bar', 'kitchen'],
  };

  it('has every value of every family, in English and Arabic', () => {
    const missing: string[] = [];
    for (const [prefix, values] of Object.entries(families)) {
      for (const v of values) {
        for (const locale of ['en', 'ar'] as const) {
          if (typeof lookup(locale, `${prefix}.${v}`) !== 'string') missing.push(`${locale}:${prefix}.${v}`);
        }
      }
      for (const suffix of prefix === 'ws.protocols.lists.filter' ? ['title', 'body'] : []) {
        for (const v of values) {
          for (const locale of ['en', 'ar'] as const) {
            if (typeof lookup(locale, `ws.protocols.lists.empty.${v}.${suffix}`) !== 'string') missing.push(`${locale}:lists.empty.${v}.${suffix}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
