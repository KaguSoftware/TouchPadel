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
import { Kbd, type AsyncStatus } from '../../components/kit';
import { BrandMark, Icon } from '../../components/icons';
import { TicketList, kdsCard } from './TicketList';
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
          gap: '1.25rem',
          paddingBlockEnd: '0.6rem',
          marginBlockEnd: '0.6rem',
          borderBlockEnd: '1px solid var(--tp-kds-border)',
          flexShrink: 0,
        }}
      >
        <BrandMark compact style={{ color: 'var(--tp-kds-fg)' }} />
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

      <div style={{ flexShrink: 0, display: 'grid', gap: '0.5rem' }}>
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
            <Icon name="wifiOff" size={22} />
            {tr('op.kds.lanMode')}
          </p>
        )}
        {staleCount > 0 && (
          <p
            role="alert"
            data-testid="stale-banner"
            style={{ ...notice, background: 'var(--tp-kds-late)', color: 'var(--tp-brand-black)', fontWeight: 700 }}
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
            color: 'var(--tp-brand-black)',
            fontWeight: 700,
          }}
        />
      </div>

      <div style={{ flex: 1, minBlockSize: 0, overflow: 'auto', paddingBlockStart: '0.6rem' }}>
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

const notice: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  paddingBlock: '0.6rem',
  paddingInline: '0.85rem',
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
        gap: '0.5rem',
        fontSize: 'var(--tp-fs-lg)',
        fontWeight: 700,
        color: status === 'disconnected' ? 'var(--tp-kds-late)' : 'var(--tp-kds-fg)',
        border: '1px solid var(--tp-kds-border)',
        background: 'var(--tp-kds-card)',
        borderRadius: 'var(--tp-radius-pill)',
        paddingInline: '0.85rem',
        minBlockSize: '2.25rem',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          inlineSize: '0.75rem',
          blockSize: '0.75rem',
          borderRadius: '50%',
          background: color,
          animation: status === 'connecting' ? 'tpPulse 1.2s infinite' : undefined,
        }}
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
        minBlockSize: '3.5rem',
        background: 'var(--tp-kds-fresh)',
        color: 'var(--tp-brand-black)',
        border: 'none',
        inlineSize: '100%',
        textAlign: 'start',
        font: 'inherit',
        fontSize: 'var(--tp-fs-kds)',
        cursor: 'pointer',
      }}
    >
      <span>{tr('op.kds.startShiftHint')}</span>
      <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
        <Icon name="play" size={20} />
        {tr('op.kds.startShift')}
      </strong>
    </button>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function KdsSkeleton() {
  const { tr } = useLocale();
  return (
    <div
      role="status"
      aria-label={tr('ws.kit.async.loading')}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(22rem, 1fr))',
        gap: '1rem',
      }}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            ...kdsCard,
            blockSize: '16rem',
            animation: 'tpPulse 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.15}s`,
          }}
        >
          <div style={{ blockSize: '3.5rem', background: 'var(--tp-kds-card-2)' }} />
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
        gap: '0.75rem',
        minBlockSize: '60%',
        paddingBlock: '3rem',
        paddingInline: '1.5rem',
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
        gap: '0.75rem',
        justifyItems: 'start',
        paddingBlock: '1.25rem',
        paddingInline: '1.25rem',
        maxInlineSize: '48rem',
      }}
    >
      <p
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
      <span style={{ display: 'inline-flex', gap: '0.2rem' }}>{keys}</span>
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
        gap: '0.5rem 1.5rem',
        paddingBlockStart: '0.6rem',
        marginBlockStart: '0.4rem',
        borderBlockStart: '1px solid var(--tp-kds-border)',
        fontSize: 'var(--tp-fs-md)',
        color: 'var(--tp-kds-muted)',
        flexShrink: 0,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}>
        <Icon name="keyboard" size={18} />
        {tr('ws.prep.keys.legend')}
      </span>
      {entry(<Kbd>1–9</Kbd>, tr('ws.prep.keys.ticket'))}
      {entry(
        <>
          <Kbd>{prev}</Kbd>
          <Kbd>{next}</Kbd>
        </>,
        tr('ws.prep.keys.prevNext'),
      )}
      {entry(
        <>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
        </>,
        tr('ws.prep.keys.items'),
      )}
      {entry(<Kbd>Space</Kbd>, tr('ws.prep.keys.toggle'))}
      {entry(<Kbd>S</Kbd>, tr('ws.prep.keys.start'))}
      {entry(<Kbd>R</Kbd>, tr('ws.prep.keys.ready'))}
      {entry(<Kbd>C</Kbd>, tr('ws.prep.keys.complete'))}
      {entry(<Kbd>Esc</Kbd>, tr('ws.prep.keys.clear'))}
    </footer>
  );
}
