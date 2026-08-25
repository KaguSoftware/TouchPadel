'use client';

import { useMemo } from 'react';
import { formatIQD, makeT, type Locale } from '@touch/i18n';
import type { MenuItem, MenuModifierGroup } from '@/lib/menu';
import { groupCount, groupSatisfied, isSelected, type Selection } from './selection';

/**
 * One modifier group: header + Required chip (filled while unsatisfied),
 * radio semantics at `max_select === 1`, checkboxes otherwise, and the nested
 * groups a selected modifier reveals — indented behind a brown rule.
 */
export function ModifierGroup({
  locale,
  item,
  group,
  selection,
  onToggle,
  revealed = false,
}: {
  locale: Locale;
  item: MenuItem;
  group: MenuModifierGroup;
  selection: Selection;
  onToggle(group: MenuModifierGroup, modifierId: string): void;
  /** true when this group was exposed by a parent modifier */
  revealed?: boolean;
}) {
  const tr = useMemo(() => makeT(locale), [locale]);
  const ar = locale === 'ar';
  const required = group.min_select > 0;
  const satisfied = groupSatisfied(group, selection);
  const atCap = groupCount(group, selection) >= group.max_select;
  const radio = group.max_select === 1;

  const hint = (): string => {
    if (radio && group.min_select === 1) return tr('cafe.chooseOne');
    if (group.min_select === group.max_select && group.min_select > 0)
      return tr('cafe.chooseExactly', { count: group.min_select });
    if (group.min_select > 0)
      return tr('cafe.chooseRange', { min: group.min_select, max: group.max_select });
    return tr('cafe.chooseUpTo', { max: group.max_select });
  };

  // A revealed group may be exposed by more than one pick — render it once.
  const seen = new Set<string>();

  return (
    <div
      className={`tp-sheet__group${revealed ? ' tp-sheet__group--revealed' : ''}`}
      role="group"
      aria-label={
        revealed
          ? `${tr('cafe.revealsHint')} — ${ar ? group.name_ar : group.name_en}`
          : (ar ? group.name_ar : group.name_en)
      }
    >
      <h3>
        <span>{ar ? group.name_ar : group.name_en}</span>
        {required && (
          <span className="tp-req" data-unsatisfied={satisfied ? 'false' : 'true'}>
            {tr('cafe.required')}
          </span>
        )}
        <span className="tp-sheet__hint">{hint()}</span>
      </h3>

      {group.modifiers.map((m) => {
        const checked = isSelected(selection, m.id);
        return (
          <label key={m.id} className="tp-opt">
            <input
              type={radio ? 'radio' : 'checkbox'}
              name={`tp-group-${group.id}`}
              checked={checked}
              // a radio in an optional group can be un-picked: onClick fires even
              // when `checked` already, onChange would not.
              onChange={() => {
                if (!radio) onToggle(group, m.id);
              }}
              onClick={() => {
                if (radio) onToggle(group, m.id);
              }}
              disabled={!checked && !radio && atCap}
            />
            <span>{ar ? m.name_ar : m.name_en}</span>
            {m.price_delta_iqd > 0 && (
              <span className="tp-opt__price">+{formatIQD(m.price_delta_iqd, locale)}</span>
            )}
          </label>
        );
      })}

      {group.modifiers
        .filter((m) => isSelected(selection, m.id) && m.reveals.length > 0)
        .flatMap((m) => m.reveals)
        .filter((rg) => {
          if (seen.has(rg.id)) return false;
          seen.add(rg.id);
          return true;
        })
        .map((rg) => (
          <ModifierGroup
            key={rg.id}
            locale={locale}
            item={item}
            group={rg}
            selection={selection}
            onToggle={onToggle}
            revealed
          />
        ))}
    </div>
  );
}
