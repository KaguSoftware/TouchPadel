/**
 * The context checkboxes (plan §5.5): what this chat may read, with the size
 * of each scope's pack from the `dry_run` call and the total, so the owner
 * sees the price of context before asking. Three presets sit above the list.
 * The set that applies is stored on the conversation; this strip only edits
 * it, and the server refuses what is not in it.
 */
import { useId } from 'react';
import { ASSISTANT_PRESETS, ASSISTANT_SCOPES, type AssistantScope } from '@touch/core/assistant/tools';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { formatTokens } from '../../lib/assistantPricing';
import { normaliseScopes, sameScopes } from './scopes';

export type PackSizes = Partial<Record<AssistantScope, number>>;

const PRESET_KEYS = ['everything', 'moneyAndFloor', 'justHelp'] as const;

export function ScopeStrip({
  scopes,
  onChange,
  packs,
  measuring,
  disabled,
  compact,
}: {
  scopes: readonly AssistantScope[];
  onChange: (next: AssistantScope[]) => void;
  /** Pack size per scope for the current range; missing = not measured yet. */
  packs: PackSizes;
  measuring?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { tr } = useLocale();
  const legendId = useId();
  const total = scopes.reduce((n, s) => n + (packs[s] ?? 0), 0);
  const knowsAll = scopes.every((s) => packs[s] !== undefined);

  const toggle = (scope: AssistantScope) => {
    const set = new Set(scopes);
    if (set.has(scope)) set.delete(scope);
    else set.add(scope);
    onChange(normaliseScopes(set));
  };

  return (
    <fieldset data-scope-strip="" disabled={disabled} style={{ border: 'none', margin: 0, padding: 0, minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <legend id={legendId} style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, padding: 0, marginBlockEnd: 'var(--tp-sp-1)' }}>
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
          const size = packs[scope];
          return (
            <label key={scope} data-scope={scope} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)', cursor: disabled ? 'default' : 'pointer', minInlineSize: 0 }}>
              <input type="checkbox" checked={checked} onChange={() => toggle(scope)} disabled={disabled} style={{ marginBlockStart: '0.2em' }} />
              <span style={{ flex: 1, minInlineSize: 0 }}>{tr(`ws.owner.assistant.scopes.${scope}`)}</span>
              <span dir="ltr" style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontFamily: 'var(--tp-font-numeric)', whiteSpace: 'nowrap' }}>
                {size === undefined
                  ? measuring && checked
                    ? tr('ws.owner.assistant.scopes.measuring')
                    : ''
                  : size > 0
                    ? tr('ws.owner.assistant.scopes.packSize', { tokens: formatTokens(size) })
                    : tr('ws.owner.assistant.scopes.packNone')}
              </span>
            </label>
          );
        })}
      </div>

      <p data-scope-total="" style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
        {measuring && !knowsAll ? tr('ws.owner.assistant.scopes.measuring') : tr('ws.owner.assistant.scopes.total', { tokens: `⁨${formatTokens(total)}⁩` })}
      </p>
    </fieldset>
  );
}
