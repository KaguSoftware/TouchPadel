/**
 * The context checkboxes (plan §5.5): what this chat may read, and under them
 * one figure: what any question costs to start with these boxes (the system
 * prompt, tool list and the checked scopes' packs, from the `dry_run` call),
 * so the owner sees the price of context before asking. The boxes carry no
 * sizes of their own; the sum of the packs was never the whole start, and a
 * row of small numbers read as the bill. Three presets sit above the list.
 * The set that applies is stored on the conversation; this strip only edits
 * it, and the server refuses what is not in it.
 */
import { useId } from 'react';
import { ASSISTANT_PRESETS, ASSISTANT_SCOPES, type AssistantScope } from '@touch/core/assistant/tools';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { formatTokens, formatUsd, priceFor, type PricingMap } from '../../lib/assistantPricing';
import type { StartSize } from './api';
import { normaliseScopes, sameScopes } from './scopes';

const PRESET_KEYS = ['everything', 'moneyAndFloor', 'justHelp'] as const;

export function ScopeStrip({
  scopes,
  onChange,
  start,
  measuring,
  pricing,
  fallbackMicrosPerMtok = 0,
  titleHidden,
  disabled,
  compact,
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
  compact?: boolean;
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

  return (
    <fieldset data-scope-strip="" disabled={disabled} style={{ border: 'none', margin: 0, padding: 0, minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <legend id={legendId} style={titleHidden ? { position: 'absolute', inlineSize: 1, blockSize: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } : { fontSize: 'var(--tp-fs-sm)', fontWeight: 600, padding: 0, marginBlockEnd: 'var(--tp-sp-1)' }}>
        {tr('ws.owner.assistant.scopes.title')}
      </legend>

      <div role="group" aria-labelledby={legendId} style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
        {PRESET_KEYS.map((key) => {
          const preset = ASSISTANT_PRESETS[key];
          const active = sameScopes(scopes, preset);
          return (
            <Button key={key} size="sm" kind={active ? 'primary' : 'soft'} aria-pressed={active} onClick={() => onChange(normaliseScopes(preset))} disabled={disabled}>
              {tr(`ws.owner.assistant.scopes.presets.${key}`)}
            </Button>
          );
        })}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? 'repeat(auto-fill, minmax(11rem, 1fr))' : 'repeat(auto-fill, minmax(14rem, 1fr))',
          gap: 'var(--tp-sp-1) var(--tp-sp-3)',
        }}
      >
        {ASSISTANT_SCOPES.map((scope) => {
          const checked = scopes.includes(scope);
          return (
            <label key={scope} data-scope={scope} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)', cursor: disabled ? 'default' : 'pointer', minInlineSize: 0 }}>
              <input type="checkbox" checked={checked} onChange={() => toggle(scope)} disabled={disabled} style={{ marginBlockStart: '0.2em' }} />
              <span style={{ flex: 1, minInlineSize: 0 }}>{tr(`ws.owner.assistant.scopes.${scope}`)}</span>
            </label>
          );
        })}
      </div>

      <div data-scope-start="" style={{ display: 'grid', gap: '0.15rem' }}>
        <p style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
          {measuring || start === undefined
            ? tr('ws.owner.assistant.scopes.measuring')
            : start
              ? tr(start.exact ? 'ws.owner.assistant.scopes.start' : 'ws.owner.assistant.scopes.startEstimated', {
                  tokens: `⁨${formatTokens(start.tokens)}⁩`,
                  cost: `⁨${formatUsd(micros)}⁩`,
                })
              : tr('ws.owner.assistant.scopes.startUnknown')}
        </p>
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.scopes.startHint')}</p>
      </div>
    </fieldset>
  );
}
