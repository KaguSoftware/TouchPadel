/**
 * The unsent basket (spec TabLineList, `editable` = true). Lines are freely
 * editable until F2 / "Send to kitchen" — after that they live on the tab and
 * TabDetailPanel owns them (void = waste, never delete).
 *
 * PHYSICALLY FIXED. The basket fills a height its caller reserved
 * (BASKET_BLOCK_SIZE) and never asks for more: the list scrolls, the status
 * line is reserved empty, and the Send button is mounted from the first paint
 * — disabled with its reason rather than absent. A cashier adding the fourth
 * item is already moving towards the fifth tile, and every one of those three
 * used to shift the grid under that finger (rulebook 11.5).
 */
import { formatIQD } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText } from '../../components/ui';
import { Kbd } from '../../components/kit';
import { Icon } from '../../components/icons';
import { basketLineEstimate, type BasketLine } from './tillData';
import { kvRow, muted, numeric, reservedStatusLine, sectionTitle } from './tillStyles';

export function Basket({
  lines,
  sending,
  error,
  canSend,
  blockedReason,
  onBump,
  onRemove,
  onClear,
  onSend,
}: {
  lines: readonly BasketLine[];
  sending: boolean;
  error: unknown;
  canSend: boolean;
  /** Why Send cannot be pressed right now — rulebook 4.3. Presentation only. */
  blockedReason?: string;
  onBump: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onSend: () => void;
}) {
  const { tr, locale } = useLocale();
  const total = lines.reduce((s, l) => s + basketLineEstimate(l), 0);

  return (
    <section
      aria-label={tr('ws.cashier.till.basket.title')}
      style={{
        blockSize: '100%',
        minBlockSize: 0,
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr) auto auto',
        gap: 'var(--tp-sp-1-5)',
      }}
    >
      {/* Reserved: "Clear basket" only exists while there are lines, and
          without a floor under the row the list below it started 0.6rem
          higher on an empty basket than on a full one. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-2)', minBlockSize: 'var(--tp-sp-6)' }}>
        <h3 style={sectionTitle}>
          {tr('ws.cashier.till.basket.title')}
          {lines.length > 0 && (
            <span style={{ marginInlineStart: 'var(--tp-sp-1-5)', color: 'var(--tp-accent)' }}>
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

      <div style={{ minBlockSize: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {lines.length === 0 ? (
          <p style={muted}>{tr('op.till.emptyBasket')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {lines.map((l) => (
              <li key={l.key} style={{ ...kvRow, alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
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
                <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-0)', alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ ...numeric, marginInlineEnd: 'var(--tp-sp-1)' }}>
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
      </div>

      {/*
        One reserved line, three occupants, never two at once. `sending` used to
        be announced from the tab pane on the far side of the screen, which is
        the one place a cashier watching the basket is not looking.
      */}
      <div style={reservedStatusLine}>
        {error != null ? (
          <ErrorText error={error} style={{ marginBlock: 0 }} />
        ) : sending ? (
          <span role="status" style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
            <Icon name="refresh" size={13} /> {tr('ws.cashier.till.basket.sending')}
          </span>
        ) : !canSend && blockedReason ? (
          <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{blockedReason}</span>
        ) : null}
      </div>

      {/* The Send target is mounted whether or not there is anything to send:
          it is the second-most-pressed control on the till and it must be in
          the same place at the start of a line as at the end of one. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
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
          title={!canSend && blockedReason ? blockedReason : 'F2'}
          aria-label={tr('op.till.sendOrder')}
          onClick={onSend}
        >
          {tr('op.till.sendOrder')} <Kbd>F2</Kbd>
        </Button>
      </div>
    </section>
  );
}
