/**
 * The unsent basket (spec TabLineList, `editable` = true). Lines are freely
 * editable until F2 / "Send to kitchen" — after that they live on the tab and
 * TabDetailPanel owns them (void = waste, never delete).
 */
import { formatIQD } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText } from '../../components/ui';
import { Kbd } from '../../components/kit';
import { basketLineEstimate, type BasketLine } from './tillData';
import { kvRow, muted, numeric, sectionTitle } from './tillStyles';

export function Basket({
  lines,
  sending,
  error,
  canSend,
  onBump,
  onRemove,
  onClear,
  onSend,
}: {
  lines: readonly BasketLine[];
  sending: boolean;
  error: unknown;
  canSend: boolean;
  onBump: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onSend: () => void;
}) {
  const { tr, locale } = useLocale();
  const total = lines.reduce((s, l) => s + basketLineEstimate(l), 0);

  return (
    <section aria-label={tr('ws.cashier.till.basket.title')} style={{ display: 'grid', gap: '0.4rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <h3 style={sectionTitle}>
          {tr('ws.cashier.till.basket.title')}
          {lines.length > 0 && (
            <span style={{ marginInlineStart: '0.4rem', color: 'var(--tp-accent)' }}>
              {tr('ws.cashier.till.basket.lines', { count: lines.length })}
            </span>
          )}
        </h3>
        {lines.length > 0 && (
          <Button kind="ghost" size="sm" icon="x" disabled={sending} onClick={onClear}>
            {tr('ws.cashier.till.basket.clear')}
          </Button>
        )}
      </div>

      {lines.length === 0 ? (
        <p style={muted}>{tr('op.till.emptyBasket')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.3rem' }}>
          {lines.map((l) => (
            <li key={l.key} style={{ ...kvRow, alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ minInlineSize: 0, flex: 1 }}>
                <span>
                  {l.qty}× {l.itemName} ({l.variantName})
                </span>
                {l.modifiers.length > 0 && (
                  <span style={{ color: 'var(--tp-muted-fg)' }}>
                    {' — '}
                    {l.modifiers.map((m) => m.name).join(', ')}
                  </span>
                )}
                {l.notes && (
                  <span style={{ display: 'block', ...muted, fontStyle: 'italic' }}>
                    <bdi>{l.notes}</bdi>
                  </span>
                )}
              </span>
              <span style={{ display: 'inline-flex', gap: '0.15rem', alignItems: 'center', flexShrink: 0 }}>
                <span style={{ ...numeric, marginInlineEnd: '0.3rem' }}>
                  <bdi>{formatIQD(basketLineEstimate(l), locale)}</bdi>
                </span>
                <Button kind="ghost" icon="minus" aria-label="−1" disabled={sending} onClick={() => onBump(l.key, -1)} />
                <Button kind="ghost" icon="plus" aria-label="+1" disabled={sending} onClick={() => onBump(l.key, 1)} />
                <Button kind="ghost" icon="x" aria-label={tr('ws.cashier.till.basket.remove')} disabled={sending} onClick={() => onRemove(l.key)} />
              </span>
            </li>
          ))}
        </ul>
      )}

      <ErrorText error={error} />

      {lines.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span>
            <strong style={numeric}>
              <bdi>{formatIQD(total, locale)}</bdi>
            </strong>
            <span style={{ display: 'block', ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.cashier.till.basket.estimate')}</span>
          </span>
          <Button
            kind="primary"
            size="lg"
            icon="flame"
            busy={sending}
            disabled={!canSend}
            title="F2"
            aria-label={tr('op.till.sendOrder')}
            onClick={onSend}
          >
            {tr('op.till.sendOrder')} <Kbd>F2</Kbd>
          </Button>
        </div>
      )}
    </section>
  );
}
