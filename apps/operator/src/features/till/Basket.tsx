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
import { formatIQD, formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText } from '../../components/ui';
import { Kbd } from '../../components/kit';
import { Icon } from '../../components/icons';
import { basketLineEstimate, type BasketLine } from './tillData';
import { BASKET_LIST_OPEN, kvRow, muted, numeric, reservedStatusLine, sectionTitle } from './tillStyles';

export function Basket({
  lines,
  forLabel,
  sending,
  error,
  canSend,
  blockedReason,
  onBump,
  onNote,
  onRemove,
  onClear,
  onSend,
  expanded,
  onToggleExpanded,
}: {
  lines: readonly BasketLine[];
  /** The tab the basket will be sent to, or null when none is chosen. */
  forLabel?: string | null;
  sending: boolean;
  error: unknown;
  canSend: boolean;
  /** Why Send cannot be pressed right now — rulebook 4.3. Presentation only. */
  blockedReason?: string;
  onBump: (key: string, delta: number) => void;
  /** Open the note dialog for one line — the only place an unsent line's note is edited. */
  onNote: (key: string) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onSend: () => void;
  /** Opened to its tall height; the caller reserves both heights. */
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { tr, locale } = useLocale();
  const total = lines.reduce((s, l) => s + basketLineEstimate(l), 0);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);

  return (
    <section
      aria-label={tr('ws.cashier.till.basket.title')}
      style={{
        minBlockSize: 0,
        display: 'grid',
        /* Every row sizes to its own content, in reading order: heading,
           lines, status, then the estimate and Send. The box is pinned to the
           pane's bottom edge by its caller, so a taller list moves the TOP of
           the basket up and never the bottom. */
        gridTemplateRows: 'auto auto auto auto',
        // An auto column sizes to its widest unbreakable content — the
        // "Basket for <tab>" heading — and pushed Send past the menu column.
        gridTemplateColumns: 'minmax(0, 1fr)',
        /* NO row gap. Closed, the list row is not rendered, and a grid `gap`
           would take its spacing away with it — three children have two gaps
           where four have three — which lifted the estimate and Send by one
           gap every time the basket was closed. The rows carry their own
           spacing instead, so removing one changes nothing below it. */
        columnGap: 'var(--tp-sp-1-5)',
      }}
    >
      {/* Reserved: "Clear basket" only exists while there are lines, and
          without a floor under the row the list below it started 0.6rem
          higher on an empty basket than on a full one. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--tp-sp-2)',
          minBlockSize: 'var(--tp-sp-6)',
          marginBlockEnd: 'var(--tp-sp-1-5)',
        }}
      >
        {/* Which tab this lands on, said where the lines are. The old "1 unsent"
            counted LINES, so two coffees on one line read as one thing. */}
        <h3 style={{ ...sectionTitle, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {forLabel ? (
            <>
              {tr('ws.cashier.till.basket.titleFor')} <bdi style={{ color: 'var(--tp-fg)' }}>{forLabel}</bdi>
            </>
          ) : (
            tr('ws.cashier.till.basket.title')
          )}
          {/* UNITS, not lines: two coffees on one line are two things to make,
              and the count is what the heading is for once the list is folded
              down to a line or two. */}
          {itemCount > 0 && (
            <span style={{ ...muted, fontWeight: 400, marginInlineStart: 'var(--tp-sp-1)' }}>
              ({formatNumber(itemCount, locale)})
            </span>
          )}
        </h3>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
          {lines.length > 0 && (
            <Button kind="ghost" size="sm" icon="x" disabled={sending} onClick={onClear}>
              {tr('ws.cashier.till.basket.clear')}
            </Button>
          )}
          {/* The basket is short by default — one line, so the item grid keeps
              the screen — and opens TALLER to check a long order before
              sending. Both heights are reserved by the caller, so the tiles
              above move once, when the cashier asks, and never while lines are
              landing (rulebook 11.5). */}
          <Button
            kind="ghost"
            size="sm"
            aria-expanded={expanded}
            aria-label={
              expanded
                ? tr('ws.cashier.till.basket.collapse')
                : tr('ws.cashier.till.basket.expand')
            }
            title={
              expanded
                ? tr('ws.cashier.till.basket.collapse')
                : tr('ws.cashier.till.basket.expand')
            }
            onClick={onToggleExpanded}
          >
            {/* One glyph, TURNED between the two states rather than swapped
                for its mirror image mid-animation. The rotation sits on this
                span, not on the button, so the focus ring and the hit box
                stay where they are. */}
            <span
              style={{
                display: 'inline-flex',
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform var(--tp-dur-base) var(--tp-ease-settle)',
              }}
            >
              <Icon name="chevronUp" size={14} />
            </span>
          </Button>
        </span>
      </div>

      {/* Ordinary flow, in reading order: the lines sit under the heading and
          over the estimate.

          The row stays MOUNTED in both states and animates between no height
          and its cap — unmounting it would have nothing to transition from,
          and the lines would appear and vanish instantly under a basket that
          was itself sliding. Its own margin goes with it, so closed the row
          takes no space at all and nothing below it moves (the grid carries no
          row gap for exactly that reason). `visibility` follows the height so
          a closed list is out of the tab order rather than a zero-height strip
          still holding focusable buttons. */}
      <div
        aria-hidden={!expanded}
        style={{
          /* A CAP, not a height: three lines take three lines' room and the
             basket is that much shorter, while a fifth line starts the scroll
             instead of making the basket taller. `50vh` is the backstop on a
             short window. */
          maxBlockSize: expanded ? `min(${BASKET_LIST_OPEN}, 50vh)` : 0,
          overflowY: expanded ? 'auto' : 'hidden',
          overflowX: 'hidden',
          marginBlockEnd: expanded ? 'var(--tp-sp-1-5)' : 0,
          visibility: expanded ? 'visible' : 'hidden',
          transition:
            'max-block-size var(--tp-dur-base) var(--tp-ease-settle),' +
            ' margin-block-end var(--tp-dur-base) var(--tp-ease-settle),' +
            ' visibility var(--tp-dur-base)',
        }}
      >
        {lines.length === 0 ? (
          <p style={muted}>{tr('op.till.emptyBasket')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {lines.map((l) => (
              <li
                key={l.key}
                /* Each line on its own card. Against the basket's flat ground
                   four lines read as one block of text with buttons in it, and
                   the row a cashier is aiming a −/+ at had no edges. */
                style={{
                  ...kvRow,
                  alignItems: 'center',
                  gap: 'var(--tp-sp-1-5)',
                  flexWrap: 'wrap',
                  background: 'var(--tp-surface)',
                  border: '1px solid var(--tp-border)',
                  borderRadius: 'var(--tp-radius-ctl)',
                  paddingBlock: 'var(--tp-sp-1)',
                  paddingInline: 'var(--tp-sp-2)',
                }}
              >
                <span style={{ minInlineSize: '8rem', flex: 1 }}>
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
                <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-0)', alignItems: 'center', flexShrink: 0, marginInlineStart: 'auto' }}>
                  <span style={{ ...numeric, marginInlineEnd: 'var(--tp-sp-1)' }}>
                    <bdi>{formatIQD(basketLineEstimate(l), locale)}</bdi>
                  </span>
                  {/* The note lives with the line, not in a screen the cashier
                      has to go back to: this is the only chance to say "extra
                      shot" before F2 sends the line to the kitchen. Set notes
                      tint the glyph AND rename the button, so the state is not
                      carried by colour alone (rulebook 6.4). */}
                  <Button
                    kind="ghost"
                    icon="note"
                    aria-label={l.notes ? tr('ws.cashier.till.note.edit') : tr('ws.cashier.till.note.add')}
                    title={l.notes ? l.notes : tr('ws.cashier.till.note.add')}
                    disabled={sending}
                    onClick={() => onNote(l.key)}
                    style={l.notes ? { color: 'var(--tp-accent)' } : undefined}
                  />
                  {/* Dead at one rather than deleting the line: × is the way
                      out, and it is next to this button. */}
                  <Button
                    kind="ghost"
                    icon="minus"
                    aria-label="−1"
                    disabled={sending || l.qty <= 1}
                    onClick={() => onBump(l.key, -1)}
                  />
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
      <div style={{ ...reservedStatusLine, marginBlockEnd: 'var(--tp-sp-1-5)' }}>
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
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
        {/* An estimate from the cached menu; the server prices the ticket. One
            word says that — the two-line disclaimer under it said it at length
            on every sale. It reads as a row of its own above Send, which then
            takes the full width the way Cash and Card do in the other pane;
            side by side, Send was sized by its label and sat short of the
            edge. */}
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--tp-sp-2)' }}>
          <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.cashier.till.basket.estimate')}</span>
          <strong style={numeric}>
            <bdi>{formatIQD(total, locale)}</bdi>
          </strong>
        </span>
        {/* Same weight as Cash and Card across the pane: Send is the other
            control a till presses all shift, and at `lg` beside their `xl` it
            read as the lesser of the three. */}
        <Button
          kind="primary"
          size="xl"
          icon="flame"
          busy={sending}
          disabled={!canSend}
          title={!canSend && blockedReason ? blockedReason : 'F2'}
          aria-label={tr('op.till.sendOrder')}
          style={{ inlineSize: '100%' }}
          onClick={onSend}
        >
          {tr('op.till.sendOrder')} <Kbd>F2</Kbd>
        </Button>
      </div>
    </section>
  );
}
