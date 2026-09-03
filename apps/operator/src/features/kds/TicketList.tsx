/**
 * Kitchen presentational components (spec §07 "Kitchen"): TicketList,
 * TicketCard, TicketAgeIndicator. Dark board on the `--tp-kds-*` tokens,
 * designed for 1920×1080 read at three metres: items at --tp-fs-kds, the
 * table and age at --tp-fs-kds-lg, every target ≥ 44px, primary actions 56px.
 *
 * Cards are keyboard first (spec R11): the card is the focusable unit, the
 * selected card carries a high-contrast ring, the item under the cursor is
 * highlighted, and each action button shows its key.
 */
import { memo, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { formatNumber, formatTime, type MessageKey, type TParams } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { Kbd } from '../../components/kit';
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
        gap: '0.55rem',
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
        <span
          style={{
            fontSize: 'var(--tp-fs-sm)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {label}
        </span>
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
  const band = done ? 'var(--tp-kds-card-2)' : ageStateVar(t.ageState);
  const bandFg = done ? 'var(--tp-kds-fg)' : 'var(--tp-brand-black)';
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
        display: 'flex',
        flexDirection: 'column',
        opacity: done ? 0.55 : 1,
        outline: 'none',
        boxShadow: selected
          ? '0 0 0 4px var(--tp-kds-fg)'
          : t.stale
            ? '0 0 0 3px var(--tp-kds-late)'
            : undefined,
        animation: t.stale && !done ? 'tpPulse 1.2s infinite' : undefined,
        transition: 'box-shadow var(--tp-dur-fast) var(--tp-ease-out)',
      }}
    >
      {/* Header band: the age state carries the whole strip, not a side stripe. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          background: band,
          color: bandFg,
          paddingBlock: '0.5rem',
          paddingInline: '0.85rem',
          minBlockSize: '3.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minInlineSize: 0 }}>
          {keyHint && (
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minInlineSize: '1.9rem',
                blockSize: '1.9rem',
                borderRadius: '6px',
                background: 'var(--tp-brand-black)',
                color: 'var(--tp-kds-fg)',
                fontSize: 'var(--tp-fs-lg)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                opacity: done ? 0.5 : 0.85,
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

      {/* Meta: source · status · actor · placed at. Every state has a label (DESIGN.md). */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.35rem 0.75rem',
          paddingBlock: '0.5rem',
          paddingInline: '0.85rem',
          fontSize: 'var(--tp-fs-lg)',
          color: 'var(--tp-kds-muted)',
          borderBlockEnd: '1px solid var(--tp-kds-border)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            color: 'var(--tp-kds-fg)',
            fontWeight: 700,
          }}
        >
          <Icon name={t.source === 'web' ? 'globe' : 'drawer'} size={18} />
          {tr(t.source === 'web' ? 'ws.kit.source.web' : 'ws.kit.source.till')}
        </span>
        <span style={{ fontWeight: 700, color: t.stale ? 'var(--tp-kds-late)' : 'var(--tp-kds-fg)' }}>
          {t.stale ? tr('op.kds.stale') : statusLabel}
        </span>
        {t.actorLabel && <bdi>{t.actorLabel}</bdi>}
        <bdi style={{ marginInlineStart: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(new Date(t.createdAt), locale)}
        </bdi>
      </div>

      {/* Items */}
      <ul
        style={{ listStyle: 'none', margin: 0, paddingBlock: '0.35rem', paddingInline: '0.35rem', display: 'grid', gap: '0.15rem' }}
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
          gap: '0.6rem',
          paddingBlock: '0.6rem',
          paddingInline: '0.85rem',
          marginBlockStart: 'auto',
          borderBlockStart: '1px solid var(--tp-kds-border)',
        }}
      >
        <span style={{ fontSize: 'var(--tp-fs-lg)', color: 'var(--tp-kds-muted)', whiteSpace: 'nowrap' }}>
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
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
    <Button kind={kind} size="xl" busy={busy} onClick={onClick} style={{ minInlineSize: '8rem' }}>
      {children}
      <Kbd>{keyLabel}</Kbd>
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
        gap: '0.15rem',
        minInlineSize: 0,
        textDecoration: item.ready ? 'line-through' : 'none',
        opacity: item.ready ? 0.6 : 1,
      }}
    >
      <span style={{ fontSize: 'var(--tp-fs-kds)', fontWeight: 600, lineHeight: 1.3 }}>
        <bdi style={{ fontWeight: 700 }}>{formatNumber(item.qty, locale)}×</bdi> {item.name}
        {item.variant && <span style={{ color: 'var(--tp-kds-muted)' }}> ({item.variant})</span>}
      </span>
      {item.modifiers.length > 0 && (
        <span style={{ fontSize: 'var(--tp-fs-kds)', color: 'var(--tp-kds-muted)', lineHeight: 1.3 }}>
          {item.modifiers.join(' · ')}
        </span>
      )}
      {item.notes && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            justifySelf: 'start',
            fontSize: 'var(--tp-fs-kds)',
            fontWeight: 700,
            lineHeight: 1.3,
            color: 'var(--tp-kds-fg)',
            background: 'var(--tp-kds-card-2)',
            border: '1px solid var(--tp-kds-border)',
            borderRadius: 'var(--tp-radius-ctl)',
            paddingBlock: '0.15rem',
            paddingInline: '0.5rem',
          }}
        >
          <Icon name="note" size={16} />
          <bdi>{item.notes}</bdi>
        </span>
      )}
    </span>
  );

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    minBlockSize: 'var(--tp-touch)',
    paddingBlock: '0.35rem',
    paddingInline: '0.5rem',
    borderRadius: 'var(--tp-radius-ctl)',
    background: cursor ? 'var(--tp-kds-card-2)' : 'transparent',
    boxShadow: cursor ? 'inset 0 0 0 2px var(--tp-kds-fg)' : undefined,
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
              inlineSize: '1.75rem',
              blockSize: '1.75rem',
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
              inlineSize: '0.6rem',
              blockSize: '0.6rem',
              marginInline: '0.55rem',
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
  return (
    <div
      role="list"
      aria-label={tr('ws.prep.title')}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(22rem, 1fr))',
        gap: '1rem',
        alignItems: 'start',
        paddingBlockEnd: '1rem',
      }}
    >
      {tickets.map((t, i) => {
        const selected = selection.ticketId === t.id;
        return (
          <TicketCard
            key={t.id}
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
