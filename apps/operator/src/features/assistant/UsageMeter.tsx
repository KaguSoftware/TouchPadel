/**
 * Tokens and their price (plan §5.2, §5.6): this message, this chat, today,
 * this month — four kinds each, priced with `priceFor` so the meter and the
 * cap can never disagree. Numbers are isolated (U+2068/2069) so they read LTR
 * inside Arabic prose.
 */
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { TOKEN_KINDS, formatTokens, formatUsd, priceFor, totalTokens, type PricingMap, type TokenKinds } from '../../lib/assistantPricing';

export interface MeterSlot {
  label: 'thisMessage' | 'thisChat' | 'today' | 'month';
  tokens: Partial<TokenKinds>;
  /** Priced by the calculator unless the server already priced it. */
  costMicros?: number | null;
  model?: string | null;
  calls?: number | null;
}

const iso = (s: string) => `⁨${s}⁩`;

/** Does the slot have anything to show? The meter skips empty slots. */
export function slotHasUsage(slot: MeterSlot): boolean {
  return totalTokens(slot.tokens) > 0 || (slot.costMicros ?? 0) > 0;
}

/** `20.1k tokens · <$0.01`, the same figure the slot prints, for a folded header. */
export function slotTotal(slot: MeterSlot, pricing: PricingMap | null | undefined, fallbackMicrosPerMtok: number, tr: ReturnType<typeof useLocale>['tr']): string {
  const micros = slot.costMicros ?? priceFor({ model: slot.model ?? '', ...slot.tokens }, pricing, fallbackMicrosPerMtok);
  return `${tr('ws.owner.assistant.meter.tokens', { tokens: iso(formatTokens(totalTokens(slot.tokens))) })} · ${iso(formatUsd(micros))}`;
}

export function UsageMeter({ slots, pricing, fallbackMicrosPerMtok, compact, hideLabels }: { slots: readonly MeterSlot[]; pricing: PricingMap | null | undefined; fallbackMicrosPerMtok: number; compact?: boolean; /** No slot title (a Disclosure header already names the one slot). */ hideLabels?: boolean }) {
  const { tr, locale } = useLocale();
  const shown = slots.filter(slotHasUsage);
  if (shown.length === 0) return null;
  return (
    <dl
      data-usage-meter=""
      style={{
        display: 'grid',
        gridTemplateColumns: compact ? 'repeat(auto-fit, minmax(9rem, 1fr))' : 'repeat(auto-fit, minmax(11rem, 1fr))',
        gap: 'var(--tp-sp-2)',
        margin: 0,
        fontSize: 'var(--tp-fs-xs)',
        color: 'var(--tp-muted-fg)',
      }}
    >
      {shown.map((slot) => {
        const micros = slot.costMicros ?? priceFor({ model: slot.model ?? '', ...slot.tokens }, pricing, fallbackMicrosPerMtok);
        const kinds = TOKEN_KINDS.filter((k) => (slot.tokens[k] ?? 0) > 0)
          .map((k) => `${tr(`ws.owner.assistant.meter.kinds.${k}`)} ${iso(formatTokens(slot.tokens[k] ?? 0))}`)
          .join(' · ');
        return (
          <div key={slot.label} style={{ display: 'grid', gap: '0.1rem', minInlineSize: 0 }}>
            <dt style={hideLabels ? { position: 'absolute', inlineSize: 1, blockSize: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } : { fontWeight: 600 }}>{tr(`ws.owner.assistant.meter.${slot.label}`)}</dt>
            <dd style={{ margin: 0, display: 'grid', gap: '0.1rem' }}>
              <span style={{ color: 'var(--tp-fg)', fontFamily: 'var(--tp-font-numeric)' }}>
                {tr('ws.owner.assistant.meter.tokens', { tokens: iso(formatTokens(totalTokens(slot.tokens))) })} · {iso(formatUsd(micros))}
              </span>
              {kinds && <span title={kinds} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kinds}</span>}
              {slot.calls != null && slot.calls > 0 && <span>{tr('ws.owner.assistant.meter.calls', { n: iso(formatNumber(slot.calls, locale)) })}</span>}
              {slot.model && slot.label === 'thisMessage' && <span dir="auto">{tr('ws.owner.assistant.meter.model', { model: iso(slot.model) })}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
