/**
 * FloorView: what the till opens on. A plan of the café, drawn as the room
 * is built, with every table a button: green with a live tab (tap to add to
 * it), plain when free (tap to open one). The courts sit behind their own
 * button with one board per court. floorPlan.ts is the pure half.
 *
 * The drawing is physical, so it is NOT mirrored in Arabic: the bar is on the
 * same side of the screen as it is of the room. The text inside it still
 * reads in the reader's direction (bdi).
 *
 * Tables are real <button>s laid over an SVG of the room rather than shapes
 * inside it, so they take focus, read their state aloud and are found by role.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { tonightScope } from '../desk/useTradingNight';
import { useLocale, pickName } from '../../lib/i18n';
import { AsyncStateWrapper, EmptyState, SegmentedControl } from '../../components/kit';
import { Icon } from '../../components/icons';
import { formatElapsed } from './elapsed';
import {
  CAFE_SPOTS,
  CAFE_VIEW,
  spotPosition,
  type BoardBooking,
  type CafeSpot,
  type CourtBoard,
  type CourtBookingRow,
  type CourtRow,
  type SpotStatus,
} from './floorPlan';
import { muted, touchTarget } from './tillStyles';

export type FloorMode = 'cafe' | 'courts';

/** A tab the plan does not draw, as the side list names it. */
export interface OtherTab {
  id: string;
  label: string;
  status: string;
  offline: boolean;
}

// ---------------------------------------------------------------------------
// Data: courts and today's bookings on them
// ---------------------------------------------------------------------------

/**
 * Active courts and today's live bookings, with each booking's tabs. A cashier
 * reads these since 0106 (reservations_cashier_read: tonight's bookings, and
 * any that carry a tab).
 */
export function useCourtBookings() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['tillCourts'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ courts: CourtRow[]; bookings: CourtBookingRow[] }> => {
      const night = await tonightScope(() => queryClient.ensureQueryData({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings }));
      const [courts, bookings] = await Promise.all([
        supabase.from('courts').select('id, name_en, name_ar, sort_order').eq('is_active', true).order('sort_order'),
        supabase
          .from('reservations')
          .select('id, court_id, start_at, end_at, status, guest_name, tabs!tabs_reservation_id_fkey(id, status)')
          .in('status', ['confirmed', 'arrived'])
          .gte('start_at', night.start)
          .lt('start_at', night.end)
          .order('start_at'),
      ]);
      if (courts.error) throw courts.error;
      if (bookings.error) throw bookings.error;
      const rows = bookings.data as unknown as CourtBookingRow[];
      return { courts: courts.data as CourtRow[], bookings: rows.filter((b) => night.isTonight(b.start_at)) };
    },
  });
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function FloorView({
  mode,
  onMode,
  spots,
  tablesStatus,
  onRetryTables,
  boards,
  boardsStatus,
  boardsError,
  onRetryBoards,
  courtTabs,
  onTable,
  onBooking,
}: {
  mode: FloorMode;
  onMode: (m: FloorMode) => void;
  spots: readonly CafeSpot[];
  tablesStatus: 'loading' | 'error' | 'ready';
  onRetryTables: () => void;
  boards: readonly CourtBoard[];
  boardsStatus: 'loading' | 'error' | 'ready';
  boardsError: unknown;
  onRetryBoards: () => void;
  /** Live tabs on the courts, printed on the Courts button so they are not forgotten behind it. */
  courtTabs: number;
  onTable: (spot: CafeSpot) => void;
  onBooking: (b: BoardBooking, court: CourtRow) => void;
}) {
  const { tr, locale } = useLocale();
  const placed = spots.filter((s) => s.slot !== null);
  const offPlan = spots.filter((s) => s.slot === null);

  return (
    // Two rows of the till's own grid (subgrid): the heading, switch and legend
    // on the first, the plan on the second, so the plan's top edge sits level with
    // the waiter calls beside it.
    <section aria-label={tr('ws.cashier.floor.title')} style={{ gridRow: 'span 2', display: 'grid', gridTemplateRows: 'subgrid', minBlockSize: 0, minInlineSize: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'start', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 'var(--tp-fs-xl)', fontWeight: 700, margin: 0 }}>{tr('ws.cashier.floor.title')}</h1>
        <SegmentedControl<FloorMode>
          value={mode}
          onChange={onMode}
          aria-label={tr('ws.cashier.floor.show')}
          options={[
            { value: 'cafe', label: tr('ws.cashier.floor.cafe'), icon: 'table' },
            {
              value: 'courts',
              icon: 'court',
              label:
                courtTabs > 0 ? (
                  <>
                    {tr('ws.cashier.floor.courts')}{' '}
                    <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>{tr('ws.cashier.floor.courtsOpen', { count: formatNumber(courtTabs, locale) })}</span>
                  </>
                ) : (
                  tr('ws.cashier.floor.courts')
                ),
            },
          ]}
        />
        {mode === 'cafe' && <Legend />}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-3)', minBlockSize: 0 }}>
      {mode === 'cafe' ? (
        <AsyncStateWrapper status={tablesStatus} onRetry={onRetryTables} compact>
          {placed.length === 0 && offPlan.length === 0 ? (
            <EmptyState icon="table" title={tr('ws.cashier.floor.noTables')} />
          ) : (
            <CafePlan spots={placed} onTable={onTable} />
          )}
          {offPlan.length > 0 && (
            <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
              <p style={muted}>{tr('ws.cashier.floor.offPlan')}</p>
              <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
                {offPlan.map((s) => (
                  <TableButton key={s.table.id} spot={s} onPress={() => onTable(s)} style={{ ...touchTarget, minInlineSize: '5.5rem', borderRadius: 'var(--tp-radius-ctl)' }} />
                ))}
              </div>
            </div>
          )}
        </AsyncStateWrapper>
      ) : (
        <AsyncStateWrapper status={boardsStatus} onRetry={onRetryBoards} error={boardsError} compact>
          {boards.length === 0 ? (
            <EmptyState icon="court" title={tr('ws.cashier.floor.noCourts')} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: 'var(--tp-sp-4)', alignContent: 'start', overflowY: 'auto', minBlockSize: 0 }}>
              {boards.map((b) => (
                <CourtCard key={b.court.id} board={b} onBooking={(bb) => onBooking(bb, b.court)} />
              ))}
            </div>
          )}
        </AsyncStateWrapper>
      )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Café
// ---------------------------------------------------------------------------

const FILL: Record<SpotStatus, string> = { free: 'var(--tp-surface)', open: 'var(--tp-success)', paying: 'var(--tp-success)' };
const INK: Record<SpotStatus, string> = { free: 'var(--tp-fg)', open: 'var(--tp-accent-2-contrast)', paying: 'var(--tp-accent-2-contrast)' };
const EDGE: Record<SpotStatus, string> = { free: 'var(--tp-border-strong)', open: 'var(--tp-success-mark)', paying: 'var(--tp-warn-mark)' };

function Legend() {
  const { tr } = useLocale();
  const swatch = (status: SpotStatus): CSSProperties => ({
    inlineSize: '0.875rem',
    blockSize: '0.875rem',
    borderRadius: '50%',
    background: FILL[status],
    border: `${status === 'paying' ? 3 : 1}px solid ${EDGE[status]}`,
    flexShrink: 0,
  });
  const item = (mark: ReactNode, label: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
      {mark}
      {label}
    </span>
  );
  return (
    <div style={{ ...muted, display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap' }}>
      {item(<span style={swatch('free')} />, tr('ws.cashier.floor.legend.free'))}
      {item(<span style={swatch('open')} />, tr('ws.cashier.floor.legend.open'))}
      {item(<span style={swatch('paying')} />, tr('ws.cashier.floor.legend.paying'))}
      {item(<CallingMark />, tr('ws.cashier.floor.legend.calling'))}
    </div>
  );
}

function CallingMark({ style }: { style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        inlineSize: '1.5rem',
        blockSize: '1.5rem',
        borderRadius: '50%',
        background: 'var(--tp-danger)',
        color: 'var(--tp-danger-contrast)',
        flexShrink: 0,
        ...style,
      }}
    >
      <Icon name="bell" size={14} />
    </span>
  );
}

/** The room behind the tables, in metres (the same frame as CAFE_SPOTS). */
function RoomDrawing() {
  const { tr } = useLocale();
  const wall = { stroke: 'var(--tp-border-strong)', strokeWidth: 0.08, strokeLinecap: 'round' as const };
  const label = { fontSize: 0.34, fill: 'var(--tp-muted-fg)', textAnchor: 'middle' as const, dominantBaseline: 'middle' as const };
  const zBottom = CAFE_VIEW.z + CAFE_VIEW.d - 0.15;
  return (
    <svg
      viewBox={`${CAFE_VIEW.x} ${CAFE_VIEW.z} ${CAFE_VIEW.w} ${CAFE_VIEW.d}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, inlineSize: '100%', blockSize: '100%' }}
    >
      <rect x={CAFE_VIEW.x} y={CAFE_VIEW.z} width={CAFE_VIEW.w} height={CAFE_VIEW.d} fill="var(--tp-surface-2)" />
      {/* kitchen pass */}
      <rect x={-2.95} y={-3.35} width={5.9} height={0.7} rx={0.08} fill="var(--tp-neutral-soft)" stroke="var(--tp-border)" strokeWidth={0.03} />
      <text x={0} y={-3.0} {...label}>
        {tr('ws.cashier.floor.kitchen')}
      </text>
      {/* the bar: a U open toward the kitchen, as floorScene draws it */}
      <path
        d="M -2.8 -2.1 L -2.8 -1.15 A 0.9 0.9 0 0 0 -1.9 -0.25 L 1.9 -0.25 A 0.9 0.9 0 0 0 2.8 -1.15 L 2.8 -2.1 L 2.2 -2.1 L 2.2 -1.15 A 0.3 0.3 0 0 1 1.9 -0.85 L -1.9 -0.85 A 0.3 0.3 0 0 1 -2.2 -1.15 L -2.2 -2.1 Z"
        fill="var(--tp-accent-soft)"
        stroke="var(--tp-accent)"
        strokeWidth={0.03}
      />
      <text x={0} y={-1.45} {...label}>
        {tr('ws.cashier.floor.bar')}
      </text>
      {[-1.9, -0.95, 0, 0.95, 1.9].map((x) => (
        <circle key={x} cx={x} cy={0.2} r={0.17} fill="var(--tp-surface-3)" stroke="var(--tp-border)" strokeWidth={0.02} />
      ))}
      {/* chairs */}
      {CAFE_SPOTS.map((s, i) => (
        <g key={i} fill="var(--tp-surface-3)" stroke="var(--tp-border)" strokeWidth={0.02}>
          <rect x={s.x - 0.83} y={s.z - 0.2} width={0.26} height={0.4} rx={0.07} />
          <rect x={s.x + 0.57} y={s.z - 0.2} width={0.26} height={0.4} rx={0.07} />
          {s.seats === 4 && (
            <>
              <rect x={s.x - 0.2} y={s.z - 0.83} width={0.4} height={0.26} rx={0.07} />
              <rect x={s.x - 0.2} y={s.z + 0.57} width={0.4} height={0.26} rx={0.07} />
            </>
          )}
        </g>
      ))}
      {/* walls, and the way in */}
      <line x1={CAFE_VIEW.x + 0.04} y1={CAFE_VIEW.z} x2={CAFE_VIEW.x + 0.04} y2={zBottom} {...wall} />
      <line x1={-CAFE_VIEW.x - 0.04} y1={CAFE_VIEW.z} x2={-CAFE_VIEW.x - 0.04} y2={zBottom} {...wall} />
      <line x1={CAFE_VIEW.x + 0.04} y1={zBottom} x2={-1.1} y2={zBottom} {...wall} />
      <line x1={1.1} y1={zBottom} x2={-CAFE_VIEW.x - 0.04} y2={zBottom} {...wall} />
      <text x={0} y={zBottom - 0.35} {...label}>
        {tr('ws.cashier.floor.entrance')}
      </text>
    </svg>
  );
}

/**
 * The plan keeps the room's proportions at any window size: the wrapper is a
 * size container, and the room is as large as fits inside it both ways.
 */
function CafePlan({ spots, onTable }: { spots: readonly CafeSpot[]; onTable: (s: CafeSpot) => void }) {
  const ratio = CAFE_VIEW.w / CAFE_VIEW.d;
  return (
    <div style={{ flex: 1, minBlockSize: '18rem', containerType: 'size', display: 'grid', placeItems: 'start center' }}>
      <div
        dir="ltr"
        style={{
          position: 'relative',
          inlineSize: `min(100cqi, calc(100cqb * ${ratio}))`,
          aspectRatio: `${CAFE_VIEW.w} / ${CAFE_VIEW.d}`,
          containerType: 'inline-size',
          borderRadius: 'var(--tp-radius-panel)',
          overflow: 'hidden',
          border: '1px solid var(--tp-border)',
        }}
      >
        <RoomDrawing />
        {spots.map((s) => {
          const def = CAFE_SPOTS[s.slot!]!;
          const p = spotPosition(def);
          const size = def.seats === 4 ? 10 : 8.6;
          return (
            <TableButton
              key={s.table.id}
              spot={s}
              onPress={() => onTable(s)}
              style={{
                position: 'absolute',
                insetInlineStart: `${p.inline * 100}%`,
                insetBlockStart: `${p.block * 100}%`,
                inlineSize: `${size}%`,
                aspectRatio: '1',
                transform: 'translate(-50%, -50%)',
                borderRadius: def.seats === 4 ? '12%' : '50%',
                fontSize: 'clamp(0.85rem, 1.55cqi, 1.2rem)',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function TableButton({ spot, onPress, style }: { spot: CafeSpot; onPress: () => void; style: CSSProperties }) {
  const { tr, locale } = useLocale();
  const name = `${tr('op.till.table')} ${spot.table.table_number}`;
  const count = spot.tabs.length;
  const first = spot.tabs[0];
  const detail =
    spot.status === 'paying'
      ? tr('ws.cashier.floor.paying')
      : count > 1
        ? tr('ws.cashier.floor.tabCount', { count: formatNumber(count, locale) })
        : first
          ? (first.label ?? formatElapsed(first.openedAt, Date.now(), tr))
          : null;
  const state =
    spot.status === 'free' ? tr('ws.cashier.floor.legend.free') : spot.status === 'paying' ? tr('ws.cashier.floor.legend.paying') : count > 1 ? tr('ws.cashier.floor.tabCount', { count: formatNumber(count, locale) }) : tr('ws.cashier.floor.legend.open');
  return (
    <button
      type="button"
      className="tp-tile"
      data-status={spot.status}
      aria-label={[name, state, spot.calling ? tr('ws.cashier.floor.legend.calling') : null].filter(Boolean).join(', ')}
      onClick={onPress}
      style={{
        display: 'grid',
        placeContent: 'center',
        justifyItems: 'center',
        gap: '0.1em',
        padding: '0.2em',
        background: FILL[spot.status],
        color: INK[spot.status],
        border: `${spot.status === 'paying' ? 3 : 1}px solid ${EDGE[spot.status]}`,
        boxShadow: spot.status === 'free' ? undefined : 'var(--tp-shadow-raised)',
        font: 'inherit',
        cursor: 'pointer',
        minInlineSize: 0,
        position: 'relative',
        ...style,
      }}
    >
      <strong style={{ fontSize: '1.45em', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
        <bdi>{spot.table.table_number}</bdi>
      </strong>
      {detail && (
        <span style={{ fontSize: '0.82em', fontWeight: 600, lineHeight: 1.1, maxInlineSize: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '0.25em' }}>
          {first?.offline && <Icon name="wifiOff" size={11} />}
          <bdi>{detail}</bdi>
        </span>
      )}
      {spot.calling && <CallingMark style={{ position: 'absolute', insetBlockStart: '-0.5rem', insetInlineEnd: '-0.5rem', boxShadow: 'var(--tp-shadow-raised)' }} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Courts
// ---------------------------------------------------------------------------

function CourtCard({ board, onBooking }: { board: CourtBoard; onBooking: (b: BoardBooking) => void }) {
  const { tr, locale } = useLocale();
  const featured = board.featured;
  const rest = board.bookings.filter((b) => b !== featured);
  const hours = (b: BoardBooking) => `${formatTime(new Date(b.booking.start_at), locale)}–${formatTime(new Date(b.booking.end_at), locale)}`;
  const guest = (b: BoardBooking) => b.booking.guest_name ?? tr('op.till.forReservation');
  const courtFill = featured?.liveTab ? 'var(--tp-success)' : 'var(--tp-accent)';
  const courtInk = featured?.liveTab ? 'var(--tp-accent-2-contrast)' : 'var(--tp-accent-contrast)';

  return (
    <article style={{ display: 'grid', gap: 'var(--tp-sp-2)', alignContent: 'start' }}>
      <h2 style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, margin: 0 }}>
        <bdi>{pickName(locale, board.court)}</bdi>
      </h2>
      {/* The court, drawn: its colour is the featured booking's state. */}
      <button
        type="button"
        className="tp-tile"
        disabled={!featured}
        aria-label={featured ? `${pickName(locale, board.court)}, ${guest(featured)}, ${hours(featured)}, ${bookingState(featured, tr)}` : `${pickName(locale, board.court)}, ${tr('ws.cashier.floor.court.none')}`}
        onClick={() => featured && onBooking(featured)}
        style={{
          position: 'relative',
          aspectRatio: '2 / 1',
          border: 'none',
          borderRadius: 'var(--tp-radius-panel)',
          padding: 0,
          overflow: 'hidden',
          background: featured ? courtFill : 'var(--tp-neutral-soft)',
          color: featured ? courtInk : 'var(--tp-muted-fg)',
          cursor: featured ? 'pointer' : 'default',
          font: 'inherit',
        }}
      >
        <svg viewBox="0 0 20 10" preserveAspectRatio="none" aria-hidden="true" style={{ position: 'absolute', inset: 0, inlineSize: '100%', blockSize: '100%' }}>
          <g fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={0.08}>
            <rect x={0.4} y={0.4} width={19.2} height={9.2} />
            <line x1={10} y1={0.1} x2={10} y2={9.9} strokeWidth={0.18} strokeOpacity={0.7} />
            <line x1={3.35} y1={0.4} x2={3.35} y2={9.6} />
            <line x1={16.65} y1={0.4} x2={16.65} y2={9.6} />
            <line x1={3.35} y1={5} x2={16.65} y2={5} />
          </g>
        </svg>
        {/* The words sit on a card of their own: straight on the court, the net
            and service lines ran through the guest's name. */}
        <span style={{ position: 'relative', display: 'grid', placeItems: 'center', blockSize: '100%', padding: 'var(--tp-sp-2)' }}>
          <span
            style={{
              display: 'grid',
              justifyItems: 'center',
              gap: 'var(--tp-sp-1)',
              textAlign: 'center',
              maxInlineSize: '90%',
              background: 'var(--tp-surface)',
              color: 'var(--tp-fg)',
              borderRadius: 'var(--tp-radius-ctl)',
              paddingBlock: 'var(--tp-sp-2)',
              paddingInline: 'var(--tp-sp-4)',
              boxShadow: 'var(--tp-shadow-raised)',
            }}
          >
            {featured ? (
              <>
                <span style={{ ...muted, fontWeight: 600 }}>{tr(`ws.cashier.floor.court.${featured.phase}`)}</span>
                <strong style={{ fontSize: 'var(--tp-fs-lg)', lineHeight: 1.15, overflowWrap: 'anywhere' }}>
                  <bdi>{guest(featured)}</bdi>
                </strong>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--tp-fs-sm)' }}>{hours(featured)}</span>
                <StatePill b={featured} />
              </>
            ) : (
              <span style={muted}>{tr('ws.cashier.floor.court.none')}</span>
            )}
          </span>
        </span>
      </button>

      {rest.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <p style={muted}>{tr('ws.cashier.floor.court.alsoToday')}</p>
          {rest.map((b) => (
            <button
              key={b.booking.id}
              type="button"
              className="tp-row"
              data-clickable="true"
              onClick={() => onBooking(b)}
              style={{
                ...touchTarget,
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--tp-sp-2)',
                textAlign: 'start',
                border: `1px solid ${b.liveTab ? 'var(--tp-success-mark)' : 'var(--tp-border)'}`,
                background: b.liveTab ? 'var(--tp-success-soft)' : 'var(--tp-surface)',
                borderRadius: 'var(--tp-radius-ctl)',
                paddingBlock: 'var(--tp-sp-1-5)',
                paddingInline: 'var(--tp-sp-2-5)',
                cursor: 'pointer',
                font: 'inherit',
                color: 'inherit',
              }}
            >
              <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{hours(b)}</span>
              <strong style={{ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <bdi>{guest(b)}</bdi>
              </strong>
              <StatePill b={b} />
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function bookingState(b: BoardBooking, tr: ReturnType<typeof useLocale>['tr']): string {
  if (!b.liveTab) return tr('ws.cashier.floor.court.openTab');
  return b.liveTab.status === 'awaiting_payment' ? tr('ws.cashier.floor.legend.paying') : tr('ws.cashier.floor.court.tabOpen');
}

function StatePill({ b }: { b: BoardBooking }) {
  const { tr } = useLocale();
  const live = b.liveTab !== null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-1)',
        whiteSpace: 'nowrap',
        fontSize: 'var(--tp-fs-sm)',
        fontWeight: 600,
        borderRadius: 'var(--tp-radius-pill)',
        paddingInline: 'var(--tp-sp-2)',
        paddingBlock: 'var(--tp-sp-0)',
        background: live ? 'var(--tp-success)' : 'transparent',
        color: live ? 'var(--tp-accent-2-contrast)' : 'var(--tp-fg)',
        border: live ? '1px solid var(--tp-success-mark)' : '1px solid var(--tp-border)',
      }}
    >
      <Icon name={live ? 'receipt' : 'plus'} size={12} />
      {bookingState(b, tr)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tabs the plan does not draw
// ---------------------------------------------------------------------------

export function OtherTabsList({ tabs, onPick }: { tabs: readonly OtherTab[]; onPick: (id: string) => void }) {
  const { tr, locale } = useLocale();
  if (tabs.length === 0) return null;
  return (
    <section aria-label={tr('ws.cashier.floor.others')} style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
      <h2 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, margin: 0, display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'baseline' }}>
        {tr('ws.cashier.floor.others')}
        <span style={{ ...muted, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(tabs.length, locale)}</span>
      </h2>
      <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.cashier.floor.othersHint')}</p>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="tp-tile"
            onClick={() => onPick(t.id)}
            style={{
              ...touchTarget,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--tp-sp-1-5)',
              textAlign: 'start',
              paddingBlock: 'var(--tp-sp-1-5)',
              paddingInline: 'var(--tp-sp-2-5)',
              border: '1px solid var(--tp-success-mark)',
              borderRadius: 'var(--tp-radius-ctl)',
              background: 'var(--tp-success-soft)',
              color: 'var(--tp-fg)',
              font: 'inherit',
              minInlineSize: 0,
            }}
          >
            <strong style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <bdi>{t.label}</bdi>
            </strong>
            <span style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', whiteSpace: 'nowrap' }}>
              {t.offline && <Icon name="wifiOff" size={12} label={tr('ws.cashier.till.rail.offline')} />}
              {t.status === 'awaiting_payment' && tr('ws.cashier.floor.paying')}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
