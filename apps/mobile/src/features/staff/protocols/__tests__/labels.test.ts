import { describe, expect, it } from 'vitest';
import {
  GENERIC_STEP_FORM,
  PRICE_CHANGE_KINDS,
  PROTOCOL_KINDS,
  STEP_KEYS,
  TOURNAMENT_VARIANTS,
  stepForm,
  type FieldDef,
} from '@touch/core';
import { catalogs, type MessageKey } from '@touch/i18n';
import { IDEA_FIELDS } from '../../ideas/logic';
import { WEEKDAY_KEYS, fieldLabelKey, optionLabelKey } from '../labels';

/**
 * Every field and option any protocol form can show has a label in both
 * catalogs (build-contracts-2026-09-23 §4): the field lists come from
 * `@touch/core` with no labels, so a field added there with none here would
 * render as its raw name. Walks every step of every kind, variant and change.
 */

function lookup(locale: 'en' | 'ar', key: MessageKey): unknown {
  let node: unknown = catalogs[locale];
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return node;
}

function walk(fields: readonly FieldDef[], prefix: string, out: Map<string, FieldDef>): void {
  for (const f of fields) {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    out.set(path, f);
    if (f.fields) walk(f.fields, path, out);
  }
}

const every = new Map<string, FieldDef>();
for (const kind of PROTOCOL_KINDS) {
  for (const key of STEP_KEYS[kind]) {
    for (const variant of kind === 'tournament' ? TOURNAMENT_VARIANTS : [null]) {
      for (const change of kind === 'price_promo' ? PRICE_CHANGE_KINDS : [null]) {
        const form = stepForm(kind, key, { variant, change });
        if (form) walk(form.fields, '', every);
      }
    }
  }
}
walk(GENERIC_STEP_FORM.fields, '', every);
walk(IDEA_FIELDS, '', every);

describe('protocol form labels', () => {
  it('found the fields it means to check', () => {
    expect(every.size).toBeGreaterThan(100);
  });

  it.each([...every.keys()])('labels %s in English and Arabic', (path) => {
    const key = fieldLabelKey(path);
    expect(key, path).not.toBeNull();
    expect(typeof lookup('en', key!), `${path} → ${key} (en)`).toBe('string');
    expect(typeof lookup('ar', key!), `${path} → ${key} (ar)`).toBe('string');
  });

  it('labels every option of every choice field in both languages', () => {
    const missing: string[] = [];
    for (const [path, def] of every) {
      if (def.type !== 'enum') continue;
      for (const option of def.options ?? []) {
        const key = optionLabelKey(path, option);
        if (!key || typeof lookup('en', key) !== 'string' || typeof lookup('ar', key) !== 'string') {
          missing.push(`${path}=${option}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('names the seven weekdays from Sunday, as 0067 and 0071 count them', () => {
    expect(WEEKDAY_KEYS).toHaveLength(7);
    expect(lookup('en', WEEKDAY_KEYS[0])).toBe('Sun');
    for (const key of WEEKDAY_KEYS) expect(typeof lookup('ar', key)).toBe('string');
  });
});
