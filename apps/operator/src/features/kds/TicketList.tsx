/**
 * Kitchen presentational components (spec §07 "Kitchen"): TicketList,
 * TicketCard, TicketAgeIndicator. Dark board on the `--tp-kds-*` tokens,
 * designed for 1920×1080 read at three metres: items at --tp-fs-kds, the
 * table and age at --tp-fs-kds-lg, nothing below --tp-fs-kds-sm, every target
 * ≥ 44px, primary actions 56px.
 *
 * Cards are keyboard first (spec R11): the card is the focusable unit, the
 * selected card carries a high-contrast ring, the item under the cursor is
 * highlighted, and each action button shows its key.
 */
import { memo, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { formatNumber, formatTime, type MessageKey, type TParams } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { Icon } from '../../components/icons';
import { ageStateVar, formatAge, type AgeState } from './ageColor';
import type { TicketAction, TicketItemView, TicketView } from './ticketView';

export const kdsCard: CSSProperties = {
  background: 'var(--tp-kds-card)',
  border: '1px solid var(--tp-kds-border)',
  borderRadius: 'var(--tp-radius-panel)',
  color: 'var(--tp-kds-fg)',
  overflow: 'hidden',
};

// ---------------------------------------------------------------------------
// Board geometry — the handful of numbers the wall board is built from, each
// declared once so the skeleton, the card and the grid provably agree.
// ---------------------------------------------------------------------------

/** One column holds a two-line item name at --tp-fs-kds without wrapping mid-word. */
const CARD_TRACK = '22rem';

/**
 * The age band, and the height the skeleton reserves for it. Exported because
 * a loading board and a loaded board must occupy the same space (rulebook 9.1).
 */
export const KDS_BAND_BLOCK = '3.5rem';

/**
 * Start / Ready / Complete share one width, so the primary target does not
 * move under the chef's hand as a ticket walks the lifecycle (rulebook 11.5).
 */
const ACTION_INLINE = '8rem';

/**
 * Selection sits OUTSIDE the card, the alarm INSIDE it, so a selected stale
 * ticket carries both signals without either ring eating the other. The alarm
 * must be inset for a second reason: it is painted by a child of a card that
 * sets `overflow: hidden`, which clips a child's OUTER shadow away at the card
 * edge — so the ring the board's most urgent state depends on was being
 * cropped to nothing. Inset also means the alarm costs no layout and never
 * reaches into the grid gutter, so the board does not move when a ticket ages.
 */
const RING_SELECTED = '0 0 0 4px var(--tp-kds-fg)';
const RING_ALARM = 'inset 0 0 0 4px var(--tp-kds-late)';
/** The item cursor, a rung lighter than the card ring so the two never read alike. */
const RING_ITEM_CURSOR = 'inset 0 0 0 2px var(--tp-kds-fg)';

/** One gutter for the band, the meta strip and the footer, so the card has one start edge. */
const GUTTER = 'var(--tp-sp-4)';

/**
 * The board's own key chip. `components/kit` Kbd is a desk-scale chip: it
 * hardcodes --tp-fs-xs (12px) inline, which no stylesheet can lift, and 12px
 * is unreadable at three metres. Follow-up: give the shared Kbd a size prop and
 * delete this.
 */
export function KdsKbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: 'inline-block',
        fontFamily: 'var(--tp-font-numeric)',
        fontSize: 'var(--tp-fs-kds-sm)',
        lineHeight: 1,
        paddingBlock: 'var(--tp-sp-1)',
        paddingInline: 'var(--tp-sp-1-5)',
        border: '1px solid var(--tp-kds-border)',
        borderBlockEndWidth: '2px',
        borderRadius: 'var(--tp-radius-sm)',
        background: 'var(--tp-kds-card-2)',
        color: 'var(--tp-kds-fg)',
      }}
    >
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------------------
// TicketAgeIndicator — ageSeconds against the target, rendered from `state`.
// ---------------------------------------------------------------------------

export function TicketAgeIndicator({
  ageSeconds,
  targetSeconds,
  state,
  muted,
}: {
  ageSeconds: number;
  targetSeconds: number;
  state: AgeState;
  /** Completed tickets keep the number but drop the colour and the label. */
  muted?: boolean;
}) {
  const { tr } = useLocale();
  const label = tr(`ws.prep.age.${state}`);
  const targetMinutes = Math.round(targetSeconds / 60);
  return (
    <span
      data-age-state={state}
      title={targetSeconds > 0 ? tr('op.kds.ageTarget', { minutes: targetMinutes }) : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 'var(--tp-sp-2)',
        whiteSpace: 'nowrap',
        color: muted ? 'var(--tp-kds-muted)' : 'inherit',
      }}
    >
      <bdi
        style={{
          fontSize: 'var(--tp-fs-kds-lg)',
          fontWeight: 700,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatAge(ageSeconds)}
      </bdi>
      {!muted && (
        // Was --tp-fs-sm (13px) in caps with tracking — the desk scale, on the
        // one word that says whether this ticket is in trouble. Sentence case
        // at the board floor reads faster through steam than small caps do.
        <span style={{ fontSize: 'var(--tp-fs-kds-sm)', fontWeight: 700 }}>{label}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// TicketCard
// ---------------------------------------------------------------------------

export interface TicketCardProps {
  ticket: TicketView;
  /** 0-based arrival index; the first nine get a digit key. */
  index: number;
  /** Settle in on mount — set only for a ticket that ARRIVED after first paint. */
  rise?: boolean;
  selected: boolean;
  selectedItem: number | null;
  busy: boolean;
  onSelect: (ticketId: string) => void;
  onSelectItem: (ticketId: string, itemIndex: number) => void;
  onStatus: (ticketId: string, status: TicketAction) => void;
  onItemReady: (ticketId: string, itemId: string, ready: boolean) => void;
}

function TagText({ ticket }: { ticket: TicketView }) {
  const { tr } = useLocale();
  const tag = ticket.tag;
  if (tag.kind === 'table') return <bdi>{tr('op.kds.table', { table: tag.number })}</bdi>;
  if (tag.kind === 'court') {
    return (
      <>
        {tr('op.kds.court')}
        {tag.guest && (
          <>
            {' · '}
            <bdi>{tag.guest}</bdi>
          </>
        )}
      </>
    );
  }
  return <bdi>{tag.label ?? '—'}</bdi>;
}

function tagLabel(ticket: TicketView, tr: (k: MessageKey, p?: TParams) => string): string {
  const tag = ticket.tag;
  if (tag.kind === 'table') return tr('op.kds.table', { table: tag.number });
  if (tag.kind === 'court') return `${tr('op.kds.court')}${tag.guest ? ` · ${tag.guest}` : ''}`;
  return tag.label ?? '—';
}

export const TicketCard = memo(function TicketCard({
  ticket: t,
  index,
  rise,
  selected,
  selectedItem,
  busy,
  onSelect,
  onSelectItem,
  onStatus,
  onItemReady,
}: TicketCardProps) {
  const { tr, locale } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const done = t.status === 'completed';
  /**
   * ONE urgency vocabulary per card, and the saturated area grows with it:
   * nothing → amber band → red band → red band plus the alarm ring. It used to
   * run green → amber → red, so a fresh ticket painted the loudest strip on the
   * wall and the eye was pulled to the ticket that needed nothing. A fresh
   * ticket is simply not urgent, so it carries no fill at all — which also
   * leaves Padel Green exactly one job on this card: an item marked ready.
   */
  const urgent = !done && t.ageState !== 'fresh';
  const band = urgent ? ageStateVar(t.ageState) : 'var(--tp-kds-card-2)';
  const bandFg = urgent ? 'var(--tp-kds-on-fill)' : 'var(--tp-kds-fg)';
  const readyCount = t.items.filter((i) => i.ready).length;

  // Keyboard selection moves DOM focus to the card so the ring, the screen
  // reader and the scroll position all follow the cursor; pointer focus goes
  // the other way through onFocus → onSelect.
  useEffect(() => {
    const el = ref.current;
    if (!selected || !el) return;
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selected]);

  const statusLabel = tr(`ws.kit.ticketState.${t.status}`);
  const keyHint = index < 9 ? String(index + 1) : null;

  return (
    <div
      ref={ref}
      role="listitem"
      className={rise ? 'tp-rise' : undefined}
      tabIndex={0}
      aria-label={`${tagLabel(t, tr)} · ${statusLabel}`}
      aria-current={selected ? 'true' : undefined}
      data-testid="ticket-card"
      data-ticket-id={t.id}
      data-status={t.status}
      data-selected={selected || undefined}
      data-stale={t.stale || undefined}
      onFocus={() => onSelect(t.id)}
      style={{
        ...kdsCard,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        opacity: done ? 'var(--tp-opacity-disabled)' : 1,
        outline: 'none',
        // Selection only. The stale ring is a child (below), so a selected
        // stale ticket keeps BOTH signals — it used to lose the red one
        // entirely to the white selection ring.
        boxShadow: selected ? RING_SELECTED : undefined,
        transition: 'box-shadow var(--tp-dur-fast) var(--tp-ease-out)',
      }}
    >
      {/*
        The alarm. This used to be `tpPulse` on the card ROOT, and tpPulse
        drops opacity to 0.45 — so the one ticket the kitchen most needs to
        read was periodically the hardest to read, through steam, from three
        metres. It is now a ring that carries no text, and the card body,
        item names, modifiers and notes stay at full opacity permanently.
        It costs no layout at all (a ring inside an inset:0 overlay), so the
        board does not reflow at the moment a ticket goes stale.
      */}
      {t.stale && !done && (
        <span
          aria-hidden="true"
          className="tp-attention"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'var(--tp-radius-panel)',
            boxShadow: RING_ALARM,
            pointerEvents: 'none',
          }}
        />
      )}
      {/* Header band: the age state carries the whole strip, not a side stripe. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--tp-sp-3)',
          background: band,
          color: bandFg,
          paddingBlock: 'var(--tp-sp-2)',
          paddingInline: GUTTER,
          minBlockSize: KDS_BAND_BLOCK,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2-5)', minInlineSize: 0 }}>
          {keyHint && (
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minInlineSize: 'var(--tp-row-h-dense)',
                blockSize: 'var(--tp-row-h-dense)',
                borderRadius: 'var(--tp-radius-ctl)',
                background: 'var(--tp-kds-on-fill)',
                color: 'var(--tp-kds-fg)',
                fontSize: 'var(--tp-fs-kds)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {keyHint}
            </span>
          )}
          <span
            style={{
              fontSize: 'var(--tp-fs-kds-lg)',
              fontWeight: 700,
              lineHeight: 1.1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <TagText ticket={t} />
          </span>
        </div>
        <TicketAgeIndicator
          ageSeconds={t.ageSeconds}
          targetSeconds={t.targetSeconds}
          state={t.ageState}
          muted={done}
        />
      </div>

      {/*
        Meta: source · status · actor · placed at. Every state has a label
        (DESIGN.md). One line, never two: the strip used to wrap, so the moment
        a ticket went stale its three-character status became "Waiting too long"
        and the card grew a row — which re-flowed every other card on the same
        grid line. The actor is the only elastic part and it truncates.
      */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--tp-sp-3)',
          paddingBlock: 'var(--tp-sp-2)',
          paddingInline: GUTTER,
          minBlockSize: 'var(--tp-row-h)',
          fontSize: 'var(--tp-fs-kds-sm)',
          color: 'var(--tp-kds-muted)',
          borderBlockEnd: '1px solid var(--tp-kds-border)',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-1-5)',
            color: 'var(--tp-kds-fg)',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          <Icon name={t.source === 'web' ? 'globe' : 'drawer'} size={20} />
          {tr(t.source === 'web' ? 'ws.kit.source.web' : 'ws.kit.source.till')}
        </span>
        <span
          style={{
            fontWeight: 700,
            flexShrink: 0,
            color: t.stale ? 'var(--tp-kds-late)' : 'var(--tp-kds-fg)',
          }}
        >
          {t.stale ? tr('op.kds.stale') : statusLabel}
        </span>
        {t.actorLabel && (
          <bdi
            title={t.actorLabel}
            style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {t.actorLabel}
          </bdi>
        )}
        <bdi
          style={{ marginInlineStart: 'auto', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
        >
          {formatTime(new Date(t.createdAt), locale)}
        </bdi>
      </div>

      {/* Items */}
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          paddingBlock: 'var(--tp-sp-1-5)',
          paddingInline: 'var(--tp-sp-1-5)',
          display: 'grid',
          gap: 'var(--tp-sp-0)',
        }}
      >
        {t.items.map((item, i) => (
          <ItemLine
            key={item.id}
            ticketId={t.id}
            item={item}
            index={i}
            cursor={selected && selectedItem === i}
            canMark={t.canMarkItems && !done}
            onSelectItem={onSelectItem}
            onItemReady={onItemReady}
          />
        ))}
      </ul>

      {/* Footer: progress + the one or two legal moves, each with its key. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--tp-sp-2-5)',
          paddingBlock: 'var(--tp-sp-2-5)',
          paddingInline: GUTTER,
          marginBlockStart: 'auto',
          borderBlockStart: '1px solid var(--tp-kds-border)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--tp-fs-kds-sm)',
            color: 'var(--tp-kds-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          {t.canMarkItems ? (
            <bdi>
              {tr('ws.prep.ticket.itemsDone', {
                done: formatNumber(readyCount, locale),
                total: formatNumber(t.items.length, locale),
              })}
            </bdi>
          ) : (
            tr('ws.prep.ticket.marksOffline')
          )}
        </span>
        <div
          style={{
            display: 'flex',
            gap: 'var(--tp-sp-2)',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >
          {t.status === 'queued' && (
            <ActionButton kind="primary" keyLabel="S" busy={busy} onClick={() => onStatus(t.id, 'preparing')}>
              {tr('op.kds.start')}
            </ActionButton>
          )}
          {(t.status === 'queued' || t.status === 'preparing') && (
            <ActionButton
              kind={t.status === 'preparing' ? 'primary' : 'default'}
              keyLabel="R"
              busy={busy}
              onClick={() => onStatus(t.id, 'ready')}
            >
              {tr('op.kds.ready')}
            </ActionButton>
          )}
          {t.status === 'ready' && (
            <ActionButton kind="primary" keyLabel="C" busy={busy} onClick={() => onStatus(t.id, 'completed')}>
              {tr('op.kds.complete')}
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  );
});

function ActionButton({
  children,
  keyLabel,
  kind,
  busy,
  onClick,
}: {
  children: ReactNode;
  keyLabel: string;
  kind: 'primary' | 'default';
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button kind={kind} size="xl" busy={busy} onClick={onClick} style={{ minInlineSize: ACTION_INLINE }}>
      {children}
      <KdsKbd>{keyLabel}</KdsKbd>
    </Button>
  );
}

const ItemLine = memo(function ItemLine({
  ticketId,
  item,
  index,
  cursor,
  canMark,
  onSelectItem,
  onItemReady,
}: {
  ticketId: string;
  item: TicketItemView;
  index: number;
  cursor: boolean;
  canMark: boolean;
  onSelectItem: (ticketId: string, itemIndex: number) => void;
  onItemReady: (ticketId: string, itemId: string, ready: boolean) => void;
}) {
  const { locale } = useLocale();
  const text = (
    <span
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-0)',
        minInlineSize: 0,
        textDecoration: item.ready ? 'line-through' : 'none',
        // A done line steps down a text colour rather than fading out. Opacity
        // fades the strike, the modifiers and the notes chip by the same
        // amount, and a note is the one thing on this board that must stay
        // legible even after the line is ticked.
        color: item.ready ? 'var(--tp-kds-muted)' : undefined,
      }}
    >
      <span style={{ fontSize: 'var(--tp-fs-kds)', fontWeight: 600, lineHeight: 1.3 }}>
        <bdi style={{ fontWeight: 700 }}>{formatNumber(item.qty, locale)}×</bdi> {item.name}
        {item.variant && <span style={{ color: 'var(--tp-kds-muted)' }}> ({item.variant})</span>}
      </span>
      {/* Modifiers and notes step DOWN to the board floor, so the item name is
          the strongest thing on the line — all three used to sit at one size. */}
      {item.modifiers.length > 0 && (
        <span style={{ fontSize: 'var(--tp-fs-kds-sm)', color: 'var(--tp-kds-muted)', lineHeight: 1.3 }}>
          {item.modifiers.join(' · ')}
        </span>
      )}
      {item.notes && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-1-5)',
            justifySelf: 'start',
            fontSize: 'var(--tp-fs-kds-sm)',
            fontWeight: 700,
            lineHeight: 1.3,
            color: 'inherit',
            background: 'var(--tp-kds-card-2)',
            border: '1px solid var(--tp-kds-border)',
            borderRadius: 'var(--tp-radius-ctl)',
            paddingBlock: 'var(--tp-sp-1)',
            paddingInline: 'var(--tp-sp-2)',
          }}
        >
          <Icon name="note" size={20} />
          <bdi>{item.notes}</bdi>
        </span>
      )}
    </span>
  );

  // The whole row is the target, so it is the row that carries --tp-touch; the
  // checkbox only has to be big enough to read the tick from three metres.
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--tp-sp-3)',
    minBlockSize: 'var(--tp-touch)',
    paddingBlock: 'var(--tp-sp-1-5)',
    paddingInline: 'var(--tp-sp-2)',
    borderRadius: 'var(--tp-radius-ctl)',
    background: cursor ? 'var(--tp-kds-card-2)' : 'transparent',
    boxShadow: cursor ? RING_ITEM_CURSOR : undefined,
    cursor: canMark ? 'pointer' : 'default',
  };

  return (
    <li data-item-cursor={cursor || undefined}>
      {canMark ? (
        <label style={rowStyle}>
          <input
            type="checkbox"
            checked={item.ready}
            onFocus={() => onSelectItem(ticketId, index)}
            onChange={() => onItemReady(ticketId, item.id, !item.ready)}
            style={{
              inlineSize: 'var(--tp-row-h-dense)',
              blockSize: 'var(--tp-row-h-dense)',
              margin: 0,
              flexShrink: 0,
              accentColor: 'var(--tp-kds-fresh)',
              cursor: 'pointer',
            }}
          />
          {text}
        </label>
      ) : (
        <div style={rowStyle}>
          <span
            aria-hidden="true"
            style={{
              inlineSize: 'var(--tp-sp-2)',
              blockSize: 'var(--tp-sp-2)',
              // Sits where the checkbox would, so an online and an offline
              // board have the same start edge down the item list.
              marginInline: 'var(--tp-sp-3)',
              borderRadius: '50%',
              background: 'var(--tp-kds-muted)',
              flexShrink: 0,
            }}
          />
          {text}
        </div>
      )}
    </li>
  );
});

// ---------------------------------------------------------------------------
// TicketList — one list, arrival order, every source.
// ---------------------------------------------------------------------------

/** The board grid. The skeleton renders on the same one (rulebook 9.1). */
export const kdsGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_TRACK}, 1fr))`,
  gap: 'var(--tp-sp-4)',
  alignItems: 'start',
};

export function TicketList({
  tickets,
  selection,
  busyTicketId,
  onSelect,
  onSelectItem,
  onStatus,
  onItemReady,
}: {
  tickets: readonly TicketView[];
  selection: { ticketId: string | null; itemIndex: number | null };
  busyTicketId: string | null;
  onSelect: (ticketId: string) => void;
  onSelectItem: (ticketId: string, itemIndex: number) => void;
  onStatus: (ticketId: string, status: TicketAction) => void;
  onItemReady: (ticketId: string, itemId: string, ready: boolean) => void;
}) {
  const { tr } = useLocale();
  // A ticket that ARRIVES while the chef is looking at the pass settles in;
  // the board's own first paint does not, because nothing arrived — it was
  // always there. This is the causation rule: motion is for what the server
  // did, not for what the operator or the router did.
  const painted = useRef(false);
  useEffect(() => {
    painted.current = true;
  }, []);
  return (
    <div
      role="list"
      aria-label={tr('ws.prep.title')}
      style={{ ...kdsGrid, paddingBlockEnd: 'var(--tp-sp-4)' }}
    >
      {tickets.map((t, i) => {
        const selected = selection.ticketId === t.id;
        return (
          <TicketCard
            key={t.id}
            // Guarded by !t.stale so a ticket that arrives already late does
            // not rise and then immediately begin its alarm.
            rise={painted.current && !t.stale}
            ticket={t}
            index={i}
            selected={selected}
            selectedItem={selected ? selection.itemIndex : null}
            busy={busyTicketId === t.id}
            onSelect={onSelect}
            onSelectItem={onSelectItem}
            onStatus={onStatus}
            onItemReady={onItemReady}
          />
        );
      })}
    </div>
  );
}
