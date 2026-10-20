/**
 * The context checkboxes (plan §5.5): what this chat may read, and under them
 * one figure: what any question costs to start with these boxes (the system
 * prompt, tool list and the checked scopes' packs, from the `dry_run` call),
 * so the owner sees the price of context before asking. The boxes carry no
 * sizes of their own; the sum of the packs was never the whole start, and a
 * row of small numbers read as the bill. Two presets sit above the list;
 * there is no "Everything" (owner call 2026-10-16): the owner ticks what a
 * chat needs, one scope at a time.
 * The set that applies is stored on the conversation; this strip only edits
 * it, and the server refuses what is not in it.
 *
 * Since 2026-10-20 each scope is an on/off button (owner: "some things should
 * be buttons"), a new chat starts with none on and says so, and a chat that
 * exists keeps at least one (`keepOne`): the owner picks what every chat reads.
 */
import { useId, useState } from 'react';
import { ASSISTANT_PRESETS, ASSISTANT_SCOPES, type AssistantScope } from '@touch/core/assistant/tools';
import { useLocale } from '../../lib/i18n';
import { formatTokens, formatUsd, priceFor, type PricingMap } from '../../lib/assistantPricing';
import type { StartSize } from './api';
import { normaliseScopes, sameScopes } from './scopes';

const PRESET_KEYS = ['moneyAndFloor', 'justHelp'] as const;

export function ScopeStrip({
  scopes,
  onChange,
  start,
  measuring,
  pricing,
  fallbackMicrosPerMtok = 0,
  titleHidden,
  disabled,
  keepOne,
}: {
  scopes: readonly AssistantScope[];
  onChange: (next: AssistantScope[]) => void;
  /** What a question starts at with the checked boxes; null = not measurable (no key), undefined = not measured yet. */
  start: StartSize | null | undefined;
  measuring?: boolean;
  pricing?: PricingMap | null;
  fallbackMicrosPerMtok?: number;
  /** The legend stays for screen readers but is not drawn (a Disclosure header already shows the title). */
  titleHidden?: boolean;
  disabled?: boolean;
  /** The last scope that is on cannot be turned off (a chat that exists reads something). */
  keepOne?: boolean;
}) {
  const { tr } = useLocale();
  const legendId = useId();
  // Priced as fresh input: the most it costs. On Claude a repeat within the
  // cache window pays the cache-read rate for the unchanged prefix.
  const micros = start ? priceFor({ model: start.model, input: start.tokens }, pricing, fallbackMicrosPerMtok) : 0;

  const toggle = (scope: AssistantScope) => {
    const set = new Set(scopes);
    if (set.has(scope)) set.delete(scope);
    else set.add(scope);
    onChange(normaliseScopes(set));
  };

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = ASSISTANT_SCOPES.filter((scope) => q === '' || tr(`ws.owner.assistant.scopes.${scope}`).toLowerCase().includes(q) || scope.includes(q));
  const value =
    scopes.length === 0
      ? tr('ws.owner.assistant.scopes.pickOne')
      : measuring || start === undefined
        ? tr('ws.owner.assistant.scopes.measuring')
        : start
          ? `${start.exact ? '' : '≈ '}⁨${formatUsd(micros)}⁩`
          : tr('ws.owner.assistant.scopes.startUnknown');
  const sized = scopes.length > 0 && !measuring && !!start;

  // Design P3 (Sait, 2026-10-20), as drawn: the price leads in a dark band, a
  // field filters the scopes, the scopes are ✓/+ chips, the quick sets close it.
  return (
    <fieldset data-scope-strip="" disabled={disabled} style={{ border: 'none', margin: 0, padding: 0, minInlineSize: 0, display: 'grid' }}>
      <legend id={legendId} style={titleHidden ? { position: 'absolute', inlineSize: 1, blockSize: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } : { fontSize: 'var(--tp-fs-sm)', fontWeight: 600, padding: 0, marginBlockEnd: 'var(--tp-sp-1)' }}>
        {tr('ws.owner.assistant.scopes.title')}
      </legend>

      <div data-scope-start="" style={{ background: 'var(--tp-accent-2-contrast)', color: 'var(--tp-brand-white)', paddingBlock: '14px', paddingInline: 'var(--tp-sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)' }}>
        <p title={tr('ws.owner.assistant.scopes.startHint')} style={{ margin: 0, flex: 1, minInlineSize: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-card-1)', fontWeight: 600 }}>{tr('ws.owner.assistant.scopes.startsAt')}</span>
          {sized ? (
            <strong style={{ fontSize: '22px' }}>
              {value} <span style={{ fontSize: '13px', fontWeight: 400, color: 'var(--tp-border)' }}>· {tr('ws.owner.assistant.meter.tokens', { tokens: `⁨${formatTokens(start!.tokens)}⁩` })}</span>
            </strong>
          ) : (
            <strong style={{ fontSize: 'var(--tp-fs-md)' }}>{value}</strong>
          )}
        </p>
        <span style={{ blockSize: '28px', paddingInline: '10px', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-brand-green)', color: 'var(--tp-accent-2-contrast)', fontSize: 'var(--tp-fs-xs)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
          {tr('ws.owner.assistant.scopes.picked', { n: `⁨${scopes.length}⁩` })}
        </span>
      </div>

      <div style={{ paddingBlock: '14px', paddingInline: 'var(--tp-sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-3)' }}>
        <label htmlFor={`${legendId}-find`} style={{ position: 'absolute', inlineSize: 1, blockSize: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
          {tr('ws.owner.assistant.scopes.findLabel')}
        </label>
        <input
          id={`${legendId}-find`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr('ws.owner.assistant.scopes.find')}
          style={{ blockSize: '38px', borderRadius: 'var(--tp-radius-panel)', border: '1px solid var(--tp-border-input)', paddingInline: 'var(--tp-sp-3)', font: 'inherit', background: 'var(--tp-surface)', color: 'var(--tp-fg)' }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {shown.map((scope) => {
            const on = scopes.includes(scope);
            const locked = on && keepOne && scopes.length === 1;
            return (
              <button
                key={scope}
                type="button"
                data-testid={`scope-${scope}`}
                className="tp-hover-tint"
                aria-pressed={on}
                onClick={() => toggle(scope)}
                disabled={disabled || locked}
                title={locked ? tr('ws.owner.assistant.scopes.keepOne') : undefined}
                style={{
                  blockSize: '34px',
                  paddingInline: 'var(--tp-sp-3)',
                  borderRadius: 'var(--tp-radius-pill)',
                  border: on ? 'none' : '1px solid var(--tp-border)',
                  background: on ? 'var(--tp-brand-green)' : 'var(--tp-surface)',
                  color: on ? 'var(--tp-accent-2-contrast)' : 'var(--tp-fg)',
                  fontWeight: on ? 700 : 400,
                  fontSize: '13px',
                  cursor: disabled || locked ? 'default' : 'pointer',
                  opacity: disabled ? 'var(--tp-opacity-disabled)' : undefined,
                }}
              >
                {on ? '✓ ' : '+ '}
                {tr(`ws.owner.assistant.scopes.${scope}`)}
              </button>
            );
          })}
          {shown.length === 0 && <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.scopes.noMatch')}</span>}
        </div>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', borderBlockStart: '1px solid var(--tp-bg)', paddingBlockStart: 'var(--tp-sp-3)' }}>
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', alignSelf: 'center', flex: 1 }}>{tr('ws.owner.assistant.scopes.quickSets')}</span>
          <div role="group" aria-labelledby={legendId} style={{ display: 'flex', gap: 'var(--tp-sp-2)' }}>
            {PRESET_KEYS.map((key) => {
              const preset = ASSISTANT_PRESETS[key];
              const active = sameScopes(scopes, preset);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  className="tp-hover-tint"
                  onClick={() => onChange(normaliseScopes(preset))}
                  disabled={disabled}
                  style={{ blockSize: '32px', paddingInline: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-panel)', border: '1px solid var(--tp-border-strong)', background: 'var(--tp-surface)', color: 'var(--tp-fg)', fontSize: '13px', cursor: disabled ? 'default' : 'pointer' }}
                >
                  {tr(`ws.owner.assistant.scopes.presets.${key}`)}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
