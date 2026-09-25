/**
 * The words of a step form's fields and choices. The forms are walked from the
 * shared field lists (`@touch/core/protocols`), so a label is looked up by the
 * field's path (formModel `labelIds`): `ws.protocols.fields.<id>`, most
 * specific first. `labels.test.ts` walks every form of every kind and fails on
 * a field or a choice with no words, in either language.
 */
import { catalogs, type MessageKey } from '@touch/i18n';
import { labelIds } from './formModel';

function has(key: string): boolean {
  let node: unknown = catalogs.en;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

export function fieldLabelKey(path: readonly (string | number)[]): MessageKey | null {
  for (const id of labelIds(path)) {
    const key = `ws.protocols.fields.${id}`;
    if (has(key)) return key as MessageKey;
  }
  return null;
}

/** An optional line under a field (what a link must start with, who reads a note). */
export function fieldHintKey(path: readonly (string | number)[]): MessageKey | null {
  for (const id of labelIds(path)) {
    const key = `ws.protocols.hints.${id}`;
    if (has(key)) return key as MessageKey;
  }
  return null;
}

/** Choices whose words already exist elsewhere: a role, an item kind, a change kind. */
const SHARED_OPTIONS: Record<string, string> = {
  role: 'op.roles',
  item_kind: 'work.item.kind',
  change: 'work.protocol.change',
};

export function optionLabelKey(path: readonly (string | number)[], value: string): MessageKey | null {
  const ids = labelIds(path);
  const leaf = ids[ids.length - 1] ?? '';
  const shared = SHARED_OPTIONS[leaf];
  if (shared && has(`${shared}.${value}`)) return `${shared}.${value}` as MessageKey;
  for (const id of ids) {
    const key = `ws.protocols.options.${id}.${value}`;
    if (has(key)) return key as MessageKey;
  }
  return null;
}
