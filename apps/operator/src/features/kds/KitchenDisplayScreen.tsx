/**
 * 06.20 KitchenDisplayScreen — the only screen in the prep workspace. Full
 * screen, dark, high contrast, no navigation, no refresh or polling control
 * (the container's refetchInterval is the invisible safety net). Presentation
 * only: tickets arrive as view models, the four states as `status`, and the
 * two events go back up (spec: onMarkItemReady / onMarkTicketComplete, here
 * generalised to the S/R/C lifecycle the board already had).
 */
import { useCallback, useMemo, type CSSProperties, type ReactNode } from 'react';
import { formatNumber, formatTime } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useAudioArming } from '../../lib/audio';
import type { BroadcastStatus } from '../../lib/realtime';
import { Button, ErrorText } from '../../components/ui';
import type { AsyncStatus } from '../../components/kit';
import { Icon } from '../../components/icons';
import { BrandLockup } from '../../components/brand';
import { TicketList, KdsKbd, kdsCard, kdsGrid, KDS_BAND_BLOCK } from './TicketList';
import { useKdsKeyboard } from './useKdsKeyboard';
import { openCount, type TicketAction, type TicketView } from './ticketView';

export interface KitchenDisplayScreenProps {
  status: AsyncStatus;
  tickets: readonly TicketView[];
  connection: BroadcastStatus;
  /** Queued tickets past the stale threshold — the banner count. */
  staleCount: number;
  /** Board clock (the container's 5 s tick). */
  nowMs: number;
  /** Cloud query down; tickets are the LAN queue from the till. */
  degraded: boolean;
  /** Query error for the error state. */
  error?: unknown;
  /** Last refused lifecycle write, shown inline (spec: never only as a toast). */
  actionError?: unknown;
  busyTicketId?: string | null;
  onRetry?: () => void;
  onStatus: (ticketId: string, status: TicketAction) => void;
  onItemReady: (ticketId: string, itemId: string, ready: boolean) => void;
}

export function KitchenDisplayScreen({
  status,
  tickets,
  connection,
  staleCount,
  nowMs,
  degraded,
  error,
  actionError,
  busyTicketId = null,
  onRetry,
  onStatus,
  onItemReady,
}: KitchenDisplayScreenProps) {
  const { tr, locale, dir } = useLocale();

  const keyboardTickets = useMemo(
    () =>
      tickets.map((t) => ({
        id: t.id,
        itemCount: t.items.length,
        status: t.status,
        canMarkItems: t.canMarkItems,
      })),
    [tickets],
  );
  const onToggleItem = useCallback(
    (ticketId: string, itemIndex: number) => {
      const item = tickets.find((t) => t.id === ticketId)?.items[itemIndex];
      if (item) onItemReady(ticketId, item.id, !item.ready);
    },
    [tickets, onItemReady],
  );
  const { selection, select, selectItem } = useKdsKeyboard({
    tickets: keyboardTickets,
    dir,
    enabled: status === 'ready',
    onStatus,
    onToggleItem,
  });

  const open = openCount(tickets);

  return (
    <section
      aria-label={tr('kds.title')}
      data-testid="kitchen-display"
      style={{
        display: 'flex',
        flexDirection: 'column',
        blockSize: '100%',
        minBlockSize: 0,
        color: 'var(--tp-kds-fg)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--tp-sp-4)',
          paddingBlockEnd: 'var(--tp-sp-2-5)',
          marginBlockEnd: 'var(--tp-sp-2-5)',
          borderBlockEnd: '1px solid var(--tp-kds-border)',
          flexShrink: 0,
        }}
      >
        <BrandLockup size={24} tone="onDark" />
        <h1 style={{ fontSize: 'var(--tp-fs-xl)', fontWeight: 600, color: 'var(--tp-kds-muted)' }}>
          {tr('kds.title')}
        </h1>
        <span style={{ marginInlineStart: 'auto' }} />
        <span
          data-testid="open-count"
          style={{ fontSize: 'var(--tp-fs-kds-lg)', fontWeight: 700, whiteSpace: 'nowrap' }}
        >
          <bdi>{tr('ws.prep.open', { count: formatNumber(open, locale) })}</bdi>
        </span>
        <bdi
          style={{
            fontSize: 'var(--tp-fs-kds-lg)',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--tp-kds-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          {formatTime(new Date(nowMs), locale)}
        </bdi>
        <KdsConnectionPill status={connection} />
      </header>

      {/*
        The notice region is RESERVED, not conditional. A stale banner arriving
        used to shove the whole ticket grid down by its own height at the exact
        moment the chef was reading a card — the board moved because a ticket
        aged, which is rulebook 11.5's case exactly. One notice row is held
        open permanently; the start-shift strip and the LAN notice occupy the
        same reserved space rather than each buying their own.
      */}
      <div
        style={{
          flexShrink: 0,
          display: 'grid',
          gap: 'var(--tp-sp-2)',
          minBlockSize: KDS_BAND_BLOCK,
        }}
      >
        <KdsStartShiftBanner />
        {degraded && (
          <p
            role="status"
            style={{
              ...notice,
              background: 'var(--tp-kds-card-2)',
              border: '1px solid var(--tp-kds-border)',
              color: 'var(--tp-kds-fg)',
            }}
          >
            <Icon name="wifiOff" size={24} />
            {tr('op.kds.lanMode')}
          </p>
        )}
        {staleCount > 0 && (
          <p
            role="alert"
            data-testid="stale-banner"
            style={{
              ...notice,
              background: 'var(--tp-kds-late)',
              color: 'var(--tp-kds-on-fill)',
              fontWeight: 700,
            }}
          >
            {/* The literal glyph is the e2e suite's anchor for this banner. */}
            <span aria-hidden="true">⚠</span>
            <bdi>{tr('op.kds.staleBanner', { count: formatNumber(staleCount, locale) })}</bdi>
          </p>
        )}
        <ErrorText
          error={actionError}
          style={{
            ...notice,
            marginBlock: 0,
            background: 'var(--tp-kds-late)',
            color: 'var(--tp-kds-on-fill)',
            fontWeight: 700,
          }}
        />
      </div>

      <div style={{ flex: 1, minBlockSize: 0, overflow: 'auto', paddingBlockStart: 'var(--tp-sp-2-5)' }}>
        {status === 'loading' && <KdsSkeleton />}
        {status === 'error' && (
          <KdsErrorPanel error={error} onRetry={onRetry} />
        )}
        {status === 'empty' && (
          <KdsEmpty
            title={degraded ? tr('op.kds.lanEmpty') : tr('ws.prep.empty.title')}
            body={degraded ? null : tr('ws.prep.empty.body')}
          />
        )}
        {status === 'ready' && (
          <TicketList
            tickets={tickets}
            selection={selection}
            busyTicketId={busyTicketId}
            onSelect={select}
            onSelectItem={selectItem}
            onStatus={onStatus}
            onItemReady={onItemReady}
          />
        )}
      </div>

      <KeyLegend dir={dir} />
    </section>
  );
}

/** A skeleton card stands in for a two-item ticket, so the loading board and
 *  the loaded board fill roughly the same amount of wall. */
const SKELETON_CARD_BLOCK = '16rem';

const notice: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--tp-sp-2-5)',
  paddingBlock: 'var(--tp-sp-2-5)',
  paddingInline: 'var(--tp-sp-4)',
  borderRadius: 'var(--tp-radius-panel)',
  fontSize: 'var(--tp-fs-kds)',
};

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------

/** The realtime pill on the dark board. Same test ids as components/ConnectionPill. */
export function KdsConnectionPill({ status }: { status: BroadcastStatus }) {
  const { tr } = useLocale();
  const color =
    status === 'live'
      ? 'var(--tp-kds-fresh)'
      : status === 'connecting'
        ? 'var(--tp-kds-warm)'
        : 'var(--tp-kds-late)';
  const label =
    status === 'live'
      ? tr('op.common.live')
      : status === 'connecting'
        ? tr('op.common.connecting')
        : tr('op.common.disconnected');
  return (
    <span
      title={tr('op.kds.connection')}
      data-testid="connection-pill"
      data-status={status}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-2)',
        fontSize: 'var(--tp-fs-kds-sm)',
        fontWeight: 700,
        color: status === 'disconnected' ? 'var(--tp-kds-late)' : 'var(--tp-kds-fg)',
        border: '1px solid var(--tp-kds-border)',
        background: 'var(--tp-kds-card)',
        borderRadius: 'var(--tp-radius-pill)',
        paddingInline: 'var(--tp-sp-4)',
        minBlockSize: 'var(--tp-row-h)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          inlineSize: 'var(--tp-sp-3)',
          blockSize: 'var(--tp-sp-3)',
          borderRadius: '50%',
          background: color,
        }}
        // Transient and pending, so it may loop. 'live' is a steady state
        // already carried by the label and never does.
        className={status === 'connecting' ? 'tp-attention' : undefined}
      />
      {label}
    </span>
  );
}

/** "Start shift" — the whole strip arms audio; hidden once armed (Electron arms on mount). */
function KdsStartShiftBanner() {
  const { tr } = useLocale();
  const { armed, arm } = useAudioArming();
  if (armed) return null;
  return (
    <button
      type="button"
      onClick={arm}
      data-testid="start-shift"
      style={{
        ...notice,
        justifyContent: 'space-between',
        minBlockSize: KDS_BAND_BLOCK,
        background: 'var(--tp-kds-fresh)',
        color: 'var(--tp-kds-on-fill)',
        border: 'none',
        inlineSize: '100%',
        textAlign: 'start',
        font: 'inherit',
        fontSize: 'var(--tp-fs-kds)',
        cursor: 'pointer',
      }}
    >
      <span>{tr('op.kds.startShiftHint')}</span>
      <strong
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--tp-sp-1-5)',
          whiteSpace: 'nowrap',
        }}
      >
        <Icon name="play" size={20} />
        {tr('op.kds.startShift')}
      </strong>
    </button>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** Skeleton cards on the board's own grid, so nothing moves when the tickets land. */
function KdsSkeleton() {
  const { tr } = useLocale();
  return (
    <div role="status" aria-label={tr('ws.kit.async.loading')} style={kdsGrid}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="tp-skel"
          // The sweep is the whole animation and it runs on the one period the
          // board is allowed (--tp-dur-attention, via .tp-skel). The per-card
          // stagger that used to sit here was a second, hand-typed duration.
          style={{ ...kdsCard, blockSize: SKELETON_CARD_BLOCK }}
        >
          <div style={{ blockSize: KDS_BAND_BLOCK, background: 'var(--tp-kds-card-2)' }} />
        </div>
      ))}
    </div>
  );
}

function KdsEmpty({ title, body }: { title: string; body: string | null }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 'var(--tp-sp-3)',
        minBlockSize: '60%',
        paddingBlock: 'var(--tp-sp-6)',
        paddingInline: 'var(--tp-sp-5)',
      }}
    >
      <span style={{ color: 'var(--tp-kds-fresh)', display: 'inline-flex' }}>
        <Icon name="checkCircle" size={56} />
      </span>
      <p style={{ fontSize: 'var(--tp-fs-kds-lg)', fontWeight: 700, lineHeight: 1.2 }}>{title}</p>
      {body && (
        <p style={{ fontSize: 'var(--tp-fs-kds)', color: 'var(--tp-kds-muted)', maxInlineSize: '46ch' }}>{body}</p>
      )}
    </div>
  );
}

function KdsErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { tr } = useLocale();
  return (
    <div
      role="alert"
      style={{
        ...kdsCard,
        display: 'grid',
        gap: 'var(--tp-sp-3)',
        justifyItems: 'start',
        paddingBlock: 'var(--tp-sp-5)',
        paddingInline: 'var(--tp-sp-5)',
        maxInlineSize: 'var(--tp-measure-form)',
      }}
    >
      <p
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--tp-sp-2-5)',
          fontSize: 'var(--tp-fs-kds-lg)',
          fontWeight: 700,
          color: 'var(--tp-kds-late)',
        }}
      >
        <Icon name="alert" size={28} />
        {tr('ws.prep.error.title')}
      </p>
      <ErrorText
        error={error}
        style={{ marginBlock: 0, background: 'var(--tp-kds-card-2)', color: 'var(--tp-kds-fg)', fontSize: 'var(--tp-fs-kds)' }}
      />
      <p style={{ fontSize: 'var(--tp-fs-kds)', color: 'var(--tp-kds-muted)' }}>{tr('ws.prep.error.hint')}</p>
      {onRetry && (
        <Button size="xl" kind="primary" icon="refresh" onClick={onRetry}>
          {tr('ws.kit.async.retry')}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key legend — always visible at the bottom edge.
// ---------------------------------------------------------------------------

function KeyLegend({ dir }: { dir: 'ltr' | 'rtl' }) {
  const { tr } = useLocale();
  const prev = dir === 'rtl' ? '→' : '←';
  const next = dir === 'rtl' ? '←' : '→';
  const entry = (keys: ReactNode, label: string) => (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-1-5)',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)' }}>{keys}</span>
      {label}
    </span>
  );
  return (
    <footer
      aria-label={tr('ws.prep.keys.legend')}
      data-testid="key-legend"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--tp-sp-2) var(--tp-sp-5)',
        paddingBlockStart: 'var(--tp-sp-2-5)',
        marginBlockStart: 'var(--tp-sp-1)',
        borderBlockStart: '1px solid var(--tp-kds-border)',
        // Was --tp-fs-md — the desk scale, on the only instructions this
        // station ever gets, read from the same three metres as everything else.
        fontSize: 'var(--tp-fs-kds-sm)',
        color: 'var(--tp-kds-muted)',
        flexShrink: 0,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontWeight: 700 }}>
        <Icon name="keyboard" size={20} />
        {tr('ws.prep.keys.legend')}
      </span>
      {entry(<KdsKbd>1–9</KdsKbd>, tr('ws.prep.keys.ticket'))}
      {entry(
        <>
          <KdsKbd>{prev}</KdsKbd>
          <KdsKbd>{next}</KdsKbd>
        </>,
        tr('ws.prep.keys.prevNext'),
      )}
      {entry(
        <>
          <KdsKbd>↑</KdsKbd>
          <KdsKbd>↓</KdsKbd>
        </>,
        tr('ws.prep.keys.items'),
      )}
      {entry(<KdsKbd>Space</KdsKbd>, tr('ws.prep.keys.toggle'))}
      {entry(<KdsKbd>S</KdsKbd>, tr('ws.prep.keys.start'))}
      {entry(<KdsKbd>R</KdsKbd>, tr('ws.prep.keys.ready'))}
      {entry(<KdsKbd>C</KdsKbd>, tr('ws.prep.keys.complete'))}
      {entry(<KdsKbd>Esc</KdsKbd>, tr('ws.prep.keys.clear'))}
    </footer>
  );
}
