/**
 * Pick ids by name from a list of chips (moved out of the promotion editor, 2026-11-14, so Setup ›
 * Loyalty's card privileges and drink card pick menu sections and items the same way).
 */
import { useState, type ReactNode } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../lib/i18n';
import { Button } from './ui';
import { SearchField } from './kit';

const hintStyle = { fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: 'var(--tp-sp-1)' } as const;

/** Above this many options a picker starts from a search instead of every chip. */
const SEARCH_ABOVE = 16;
/** Search results drawn at once; the rest wait for a narrower search. */
const RESULTS_SHOWN = 24;

/**
 * Pick ids by name. A short list (a venue's courts) shows every chip in a
 * bordered box that grows to fit — nothing clipped. A long list (menu items)
 * shows what is chosen, then a search; results appear only once something is
 * typed. The old picker cut chips in half at the bottom of a borderless
 * 9rem scroll area and drew ~190 of them for items.
 */
export function ChipPicker({
  label,
  hint,
  options,
  selected,
  onToggle,
  disabled,
  flush,
  testId,
}: {
  label: string;
  hint?: string;
  options: { id: string; label: string }[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  /** No space under it (inside a grid that spaces its own children). */
  flush?: boolean;
  testId?: string;
}) {
  const { tr, locale } = useLocale();
  const [q, setQ] = useState('');
  const searchable = options.length > SEARCH_ABOVE;
  const chosen = options.filter((o) => selected.includes(o.id));
  const needle = q.trim().toLowerCase();
  const matches = needle ? options.filter((o) => !selected.includes(o.id) && o.label.toLowerCase().includes(needle)) : [];

  const chip = (o: { id: string; label: string }) => {
    const on = selected.includes(o.id);
    return (
      <Button key={o.id} size="sm" kind={on ? 'primary' : 'default'} icon={on ? 'check' : undefined} aria-pressed={on} disabled={disabled} onClick={() => onToggle(o.id)}>
        <bdi>{o.label}</bdi>
      </Button>
    );
  };

  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, marginBlockEnd: flush ? 0 : 'var(--tp-sp-4)', minInlineSize: 0 }} data-testid={testId}>
      <legend style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, marginBlockEnd: 'var(--tp-sp-1)' }}>
        {label}
        {selected.length > 0 && (
          <span style={{ color: 'var(--tp-muted-fg)', fontWeight: 400 }}>
            {' · '}
            {tr('ws.manager.promotions.editor.chosen', { n: formatNumber(selected.length, locale) })}
          </span>
        )}
      </legend>
      {hint && <p style={{ ...hintStyle, marginBlockStart: 0, marginBlockEnd: 'var(--tp-sp-1-5)' }}>{hint}</p>}

      {!searchable ? (
        <ChipBox>{options.length === 0 ? <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.kit.common.none')}</span> : options.map(chip)}</ChipBox>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          {chosen.length > 0 && <div style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>{chosen.map(chip)}</div>}
          {/* Read-only with nothing chosen used to draw a bare heading: say so. */}
          {disabled && chosen.length === 0 && (
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.pricing.promotions.noneChosen')}</span>
          )}
          {!disabled && <SearchField value={q} onChange={setQ} aria-label={`${label}: ${tr('ws.kit.search.placeholder')}`} />}
          {!disabled &&
            (needle === '' ? (
              <span style={{ ...hintStyle, marginBlockStart: 0 }}>{tr('ws.manager.promotions.editor.searchToAdd')}</span>
            ) : (
              <ChipBox>
                {matches.length === 0 ? (
                  <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.manager.promotions.editor.noResults')}</span>
                ) : (
                  matches.slice(0, RESULTS_SHOWN).map(chip)
                )}
                {matches.length > RESULTS_SHOWN && (
                  <span style={{ ...hintStyle, flexBasis: '100%' }}>
                    {tr('ws.manager.promotions.editor.moreResults', { shown: formatNumber(RESULTS_SHOWN, locale) })}
                  </span>
                )}
              </ChipBox>
            ))}
        </div>
      )}
    </fieldset>
  );
}

export function ChipBox({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--tp-sp-1)',
        flexWrap: 'wrap',
        padding: 'var(--tp-sp-2)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
      }}
    >
      {children}
    </div>
  );
}
