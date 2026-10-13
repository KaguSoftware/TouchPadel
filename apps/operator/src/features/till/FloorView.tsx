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
 * The room is a dark board in CSS 3D (CafePlan): every piece stands on it as a
 * solid, and the tables are real <button>s, so they take focus, read their
 * state aloud and are found by role.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { tonightScope } from '../desk/useTradingNight';
import { useLocale, pickName } from '../../lib/i18n';
import { AsyncStateWrapper, EmptyState, SegmentedControl, ViewMore, useListCap } from '../../components/kit';
import { ChevronForward, Icon } from '../../components/icons';
import { formatElapsed } from './elapsed';
import {
  CAFE_SPOTS,
  CAFE_VIEW,
  cafeSeats,
  type BoardBooking,
  type CafeSpot,
  type CourtBoard,
  type CourtBookingRow,
  type CourtRow,
  type SpotStatus,
} from './floorPlan';
import { muted, touchTarget } from './tillStyles';
import { OFFLINE_MARK, OfflineMarkIcon } from './offlineMark';
import type { OfflineTabState } from '../../lib/offlineTabs';
import { reservationNameOf } from '../matches/matchLogic';

export type FloorMode = 'cafe' | 'courts';

/** A tab the plan does not draw, as the side list names it. */
export interface OtherTab {
  id: string;
  label: string;
  status: string;
  offline: boolean;
  /** Null for a server tab (see offlineMark). */
  offlineState: OfflineTabState | null;
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
          .select('id, court_id, kind, start_at, end_at, status, guest_id, guest_name, tabs!tabs_reservation_id_fkey(id, status)')
          .in('status', ['confirmed', 'arrived'])
          .gte('start_at', night.start)
          .lt('start_at', night.end)
          .order('start_at'),
      ]);
      if (courts.error) throw courts.error;
      if (bookings.error) throw bookings.error;
      // A lesson is paid on its own screen, never on a court bill (open_tab
      // refuses LESSON_VIA_COACHING, coaching operator.md §5.8): no tab is offered on one.
      const rows = (bookings.data as unknown as (CourtBookingRow & { kind?: string })[]).filter((b) => b.kind !== 'lesson');
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
  // Owner's rule (2026-10-08): three off-plan tables, then "View more"; their order is kept.
  const offPlanCap = useListCap(offPlan);

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
            // One line under the plan: the words, then each table as a round
            // chip, its number and its line side by side.
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
              <p style={muted}>{tr('ws.cashier.floor.offPlan')}</p>
              {offPlanCap.shown.map((s) => (
                <TableButton
                  key={s.table.id}
                  spot={s}
                  onPress={() => onTable(s)}
                  style={{ ...touchTarget, gridAutoFlow: 'column', alignItems: 'baseline', columnGap: 'var(--tp-sp-1-5)', paddingInline: 'var(--tp-sp-4)', borderRadius: 'var(--tp-radius-pill)' }}
                />
              ))}
              <ViewMore hidden={offPlanCap.hidden} open={offPlanCap.open} onToggle={offPlanCap.toggle} style={{ marginBlockStart: 0 }} />
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

function CallingMark({ style, className }: { style?: CSSProperties; className?: string }) {
  return (
    <span
      className={className}
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

/**
 * The plan: the café as a model on the counter (the owner's design, picked
 * from samples and refined, 2026-10-13). A board leaned back in CSS
 * perspective, with the walls, the kitchen pass, the bar and its four stools,
 * the chairs (small couches: seat, padded back, two arms), six palms and the
 * tables standing on it as solids: a stack of flat slices in a side colour
 * under a top. It follows the operator's appearance: a pale board on paper, a
 * deep blue one in blue mode (the --tp-floor-* tokens).
 *
 * A live table's top is Padel Green with a glow; a table waiting for payment
 * has amber walls; the table under the pointer takes the mode's hover colour,
 * top and walls (GlobalStyles, "the till's floor board"). A four-seat table
 * whose chairs stand on the diagonals is a square turned 45°, a rhombus with
 * equal sides, so each flat side faces a chair; its number is turned back
 * upright. Tables are real buttons, found by role and read aloud with their
 * state; nothing else on the board is reachable.
 *
 * Everything is placed in metres (the same frame as CAFE_SPOTS): one metre is
 * --tp-floor-m, a tenth of the room's width in the plan's own container units,
 * so the board scales with its panel and every piece keeps its proportions.
 * The plan keeps the room's proportions at any window size: the wrapper is a
 * size container, and the room is as large as fits inside it both ways.
 *
 * Plain CSS, not the live floor's three.js: it costs nothing to load, needs no
 * WebGL, and the tables stay DOM buttons.
 */
const PLAN_TILT = '24deg';
/** The viewer stands this many board-heights away, so the depth looks the same at any panel size. */
const PLAN_DISTANCE = 3;
/**
 * How tall the tilted board looks against its flat height, at PLAN_TILT and
 * PLAN_DISTANCE (measured in the browser). The board's depth is stretched by
 * its inverse before the tilt, so the room keeps its real proportions on
 * screen (a round table stays round, the room is not wider than it is) while
 * the tables, chairs and walls keep their height; and the board fills the
 * panel instead of leaving a band of empty page above it.
 */
const FORESHORTEN = 0.83;
/** Of the panel's width, what the board's near edge may take. */
const PLAN_WIDTH = 0.96;
/**
 * How much wider than the room's true proportions the board is drawn: the
 * till's panel is wide, and at 1:1 the room left wide empty bands either side
 * (owner call, 2026-10-13: between true and the earlier, too-wide look).
 */
const PLAN_WIDEN = 1.18;
/** How much of the space it could fill the board takes, leaving a margin round it (owner call, 2026-10-13). */
const PLAN_FILL = 0.9;
/** Heights in metres. A chair's seat, arms and back stand above HEIGHT.chair. */
const HEIGHT = { table: 0.28, chair: 0.08, bar: 0.34, pass: 0.3, wall: 0.25, pot: 0.36 } as const;
/** Four bar stools along the bar's front, 0.8 m apart and centred (owner call, 2026-10-13). */
const STOOLS = [-1.2, -0.4, 0.4, 1.2] as const;
/** Palms along the side walls, as the live floor stands them. */
const PALMS = [-2.4, 1.0, 4.4].flatMap((z) => [-4.5, 4.5].map((x) => ({ x, z })));

const metres = (v: number) => `calc(var(--tp-floor-m) * ${v})`;

/** How many slices a solid of this height gets: enough to read as solid at the tilt, and few enough to stay cheap. */
function slicesFor(height: number): number {
  return Math.max(2, Math.round(5 * Math.min(1, height / 0.5)) + 1);
}

/** Where a piece stands and how big it is, in metres, centred on (x, z). */
function place(x: number, z: number, w: number, d: number, rotate = 0): CSSProperties {
  return {
    position: 'absolute',
    insetInlineStart: metres(x - CAFE_VIEW.x - w / 2),
    insetBlockStart: metres(z - CAFE_VIEW.z - d / 2),
    inlineSize: metres(w),
    blockSize: metres(d),
    transform: rotate ? `rotate(${rotate}rad)` : undefined,
    transformStyle: 'preserve-3d',
  };
}

/**
 * A solid on the board: its walls as slices from the floor up, then its top at
 * `height`. `side` paints a slice and `top` the top (background, or a border
 * for the bar's U and the stool's ring).
 */
function Solid({
  height,
  radius,
  side,
  top,
  children,
  style,
}: {
  height: number;
  radius: string;
  side: CSSProperties;
  top: CSSProperties;
  children?: ReactNode;
  style: CSSProperties;
}) {
  const n = slicesFor(height);
  const face: CSSProperties = { position: 'absolute', inset: 0, borderRadius: radius, boxSizing: 'border-box' };
  return (
    <div aria-hidden="true" style={style}>
      {Array.from({ length: n }, (_, k) => (
        <span key={k} style={{ ...face, ...side, transform: `translateZ(${metres((height * k) / n)})` }} />
      ))}
      <span style={{ ...face, ...top, transform: `translateZ(${metres(height)})` }}>{children}</span>
    </div>
  );
}

/** A word lying on the floor itself. */
function FloorText({ x, z, children }: { x: number; z: number; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        insetInlineStart: metres(x - CAFE_VIEW.x),
        insetBlockStart: metres(z - CAFE_VIEW.z),
        transform: 'translate(-50%, -50%)',
        color: 'var(--tp-floor-muted)',
        fontSize: metres(0.36),
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/** The chairs' paint: a cushion lit in its middle, the frame's thin softened line. */
const CUSHION = 'radial-gradient(circle at 50% 45%, color-mix(in oklab, var(--tp-floor-chair) 80%, var(--tp-brand-white)) 0 35%, var(--tp-floor-chair) 62%)';
const chairSide: CSSProperties = { background: 'var(--tp-floor-chair-side)' };
const frameTop = (lit: '90deg' | '180deg'): CSSProperties => ({
  background: `linear-gradient(${lit}, color-mix(in oklab, var(--tp-floor-chair) 78%, var(--tp-brand-white)), var(--tp-floor-chair) 55%)`,
  outline: '1px solid color-mix(in oklab, var(--tp-floor-chair-line) 70%, transparent)',
  outlineOffset: '-1px',
});

/**
 * A chair like a small couch, facing the table at angle `a`: a cushioned
 * seat, a short arm at each end and a thick padded back on the outer edge.
 * The seat has no outline of its own; the back and arms carry one thin line
 * and are drawn over the seat's edges.
 */
function Chair({ x, z, a }: { x: number; z: number; a: number }) {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pill = '999px';
  return (
    <>
      <Solid style={place(x, z, 0.36, 0.42, a)} height={HEIGHT.chair + 0.08} radius={metres(0.07)} side={chairSide} top={{ background: CUSHION }} />
      {[-1, 1].map((k) => (
        <Solid
          key={k}
          style={place(x - sin * 0.22 * k + cos * 0.03, z + cos * 0.22 * k + sin * 0.03, 0.3, 0.08, a)}
          height={HEIGHT.chair + 0.22}
          radius={pill}
          side={chairSide}
          top={frameTop('180deg')}
        />
      ))}
      <Solid style={place(x + cos * 0.21, z + sin * 0.21, 0.14, 0.5, a)} height={HEIGHT.chair + 0.34} radius={pill} side={chairSide} top={frameTop('90deg')} />
    </>
  );
}

/** A bar stool: a tall round cushioned seat on a footrest ring. */
function Stool({ x }: { x: number }) {
  return (
    <>
      <Solid
        style={place(x, 0.2, 0.44, 0.44)}
        height={0.06}
        radius="50%"
        side={{ background: 'var(--tp-floor-stool-ring-side)' }}
        top={{ background: 'transparent', border: `${metres(0.04)} solid var(--tp-floor-stool-ring)` }}
      />
      <Solid style={place(x, 0.2, 0.34, 0.34)} height={HEIGHT.chair + 0.3} radius="50%" side={chairSide} top={{ background: CUSHION }} />
    </>
  );
}

/** A palm, as the live floor draws one: a pale round pot and a fan of long fronds from its centre. */
function Palm({ x, z }: { x: number; z: number }) {
  return (
    <>
      <Solid
        style={place(x, z, 0.44, 0.44)}
        height={HEIGHT.pot}
        radius="50%"
        side={{ background: 'var(--tp-floor-pot-side)' }}
        top={{ background: 'var(--tp-floor-pot)', boxShadow: `inset 0 0 0 ${metres(0.05)} var(--tp-floor-pot-side)` }}
      />
      {Array.from({ length: 12 }, (_, i) => {
        const len = 0.5 + (i % 4) * 0.1;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{
              position: 'absolute',
              insetInlineStart: metres(x - CAFE_VIEW.x - 0.07),
              insetBlockStart: metres(z - CAFE_VIEW.z - len),
              inlineSize: metres(0.14),
              blockSize: metres(len),
              borderRadius: '50% 50% 45% 45% / 60% 60% 40% 40%',
              background: 'linear-gradient(180deg, var(--tp-floor-leaf), var(--tp-floor-leaf-dark))',
              transformOrigin: '50% 100%',
              transform: `translateZ(${metres(HEIGHT.pot + 0.02 + (i % 2) * 0.08)}) rotate(${i * 2.399 + x * 3.1}rad)`,
            }}
          />
        );
      })}
    </>
  );
}

/** The room: walls, palms, the kitchen pass, the bar and its stools, the chairs. */
function Room() {
  const { tr } = useLocale();
  const wall = (x: number, z: number, w: number, d: number) => (
    <Solid style={place(x, z, w, d)} height={HEIGHT.wall} radius="2px" side={{ background: 'var(--tp-floor-wall-side)' }} top={{ background: 'var(--tp-floor-wall)' }} />
  );
  const barU: CSSProperties = { borderStyle: 'solid', borderWidth: metres(0.6), borderBlockStartWidth: 0, background: 'transparent' };
  return (
    <>
      {wall(CAFE_VIEW.x + 0.06, 1.5, 0.1, 10.2)}
      {wall(-CAFE_VIEW.x - 0.06, 1.5, 0.1, 10.2)}
      {wall(-3.0, 6.55, 3.9, 0.1)}
      {wall(3.0, 6.55, 3.9, 0.1)}
      <FloorText x={0} z={6.1}>
        {tr('ws.cashier.floor.entrance')}
      </FloorText>
      {PALMS.map((p) => (
        <Palm key={`${p.x},${p.z}`} x={p.x} z={p.z} />
      ))}

      <Solid
        style={place(0, -3.0, 5.9, 0.7)}
        height={HEIGHT.pass}
        radius={metres(0.08)}
        side={{ background: 'var(--tp-floor-pass-side)' }}
        top={{ background: 'var(--tp-floor-pass)', border: '1px solid var(--tp-floor-line)', display: 'grid', placeItems: 'center', color: 'var(--tp-floor-muted)', fontWeight: 600, fontSize: metres(0.32) }}
      >
        {tr('ws.cashier.floor.kitchen')}
      </Solid>

      {/* the bar: a U open toward the kitchen, as floorScene draws it */}
      <Solid
        style={place(0, -1.175, 5.6, 1.85)}
        height={HEIGHT.bar}
        radius={`0 0 ${metres(0.9)} ${metres(0.9)}`}
        side={{ ...barU, borderColor: 'var(--tp-floor-bar-side)' }}
        top={{ ...barU, borderColor: 'var(--tp-floor-bar)' }}
      />
      <FloorText x={0} z={-1.55}>
        {tr('ws.cashier.floor.bar')}
      </FloorText>
      {STOOLS.map((x) => (
        <Stool key={x} x={x} />
      ))}

      {CAFE_SPOTS.map((_, i) => cafeSeats(i).map((c, k) => <Chair key={`${i}-${k}`} x={c.x} z={c.z} a={c.angle} />))}
    </>
  );
}

function CafePlan({ spots, onTable }: { spots: readonly CafeSpot[]; onTable: (s: CafeSpot) => void }) {
  const ratio = CAFE_VIEW.w / CAFE_VIEW.d;
  return (
    // The panel is the size container; the stage inside it holds the
    // perspective, sized from the board, and stands the board on its bottom
    // edge. The near edge pivots in place, so it is never wider than the
    // board's own box; the far edge leans back toward the top of the panel.
    <div style={{ flex: 1, minBlockSize: '18rem', containerType: 'size', overflow: 'hidden', borderRadius: 'var(--tp-radius-panel)' }}>
      <div
        style={{
          ...({ '--tp-floor-board-h': `calc(min(100cqb, calc(${PLAN_WIDTH * 100}cqi / ${ratio} / ${PLAN_WIDEN})) * ${PLAN_FILL})` } as CSSProperties),
          position: 'relative',
          blockSize: '100%',
          perspective: `calc(var(--tp-floor-board-h) / ${FORESHORTEN} * ${PLAN_DISTANCE})`,
          perspectiveOrigin: '50% 100%',
        }}
      >
      <div
        dir="ltr"
        style={{
          ...({ '--tp-floor-m': '10cqi' } as CSSProperties),
          // Pinned by its bottom and centred, since the tilt pivots on the
          // near edge. When the panel's width is the limit, the room left over
          // is split above and below rather than all left on top.
          position: 'absolute',
          insetBlockEnd: 'max(0px, calc((100cqb - var(--tp-floor-board-h)) / 2))',
          insetInlineStart: '50%',
          marginInlineStart: `calc(var(--tp-floor-board-h) * ${ratio} / -2)`,
          blockSize: 'var(--tp-floor-board-h)',
          aspectRatio: `${CAFE_VIEW.w} / ${CAFE_VIEW.d}`,
          containerType: 'inline-size',
          backgroundColor: 'var(--tp-floor-bg)',
          // A faint half-metre tile.
          backgroundImage: 'linear-gradient(var(--tp-floor-tile) 1px, transparent 1px), linear-gradient(90deg, var(--tp-floor-tile) 1px, transparent 1px)',
          backgroundSize: `${metres(0.5)} ${metres(0.5)}`,
          backgroundPosition: `${metres(0.5)} ${metres(0.4)}`,
          borderRadius: 'var(--tp-radius-panel)',
          boxShadow: '0 1px 0 var(--tp-floor-edge), 0 6px 0 var(--tp-floor-edge), var(--tp-shadow-popover)',
          transform: `rotateX(${PLAN_TILT}) scale(${PLAN_WIDEN}, ${(1 / FORESHORTEN).toFixed(4)})`,
          transformOrigin: '50% 100%',
          transformStyle: 'preserve-3d',
        }}
      >
        <Room />
        {spots.map((s) => (
          <TableSolid key={s.table.id} spot={s} onPress={() => onTable(s)} />
        ))}
      </div>
      </div>
    </div>
  );
}

/** A table on the board: a real button whose walls and top are painted by the .tp-floor-* rules. */
function TableSolid({ spot, onPress }: { spot: CafeSpot; onPress: () => void }) {
  const { tr, locale } = useLocale();
  const slot = spot.slot!;
  const def = CAFE_SPOTS[slot]!;
  // Chairs on the diagonals (cafeSeats: every other row of four-seaters).
  const diamond = def.seats === 4 && Math.floor(slot / 3) % 2 === 0;
  const size = def.seats === 4 ? (diamond ? 0.88 : 0.94) : 0.86;
  const radius = def.seats === 4 ? '12%' : '50%';
  const { name, state, detail, first } = describeSpot(spot, tr, locale);
  // More slices than a chair or a wall gets: a table is the thing under the
  // finger, and its sides must read as one solid edge, round tables above all.
  const n = Math.max(10, slicesFor(HEIGHT.table));
  const face: CSSProperties = { position: 'absolute', inset: 0, borderRadius: radius };
  return (
    <button
      type="button"
      className="tp-floor-table"
      data-status={spot.status}
      aria-label={[name, state, first?.offlineState ? tr(OFFLINE_MARK[first.offlineState].key) : null, spot.calling ? tr('ws.cashier.floor.legend.calling') : null].filter(Boolean).join(', ')}
      onClick={onPress}
      style={{ ...place(def.x, def.z, size, size, diamond ? Math.PI / 4 : 0), fontSize: 'clamp(0.85rem, 1.55cqi, 1.2rem)' }}
    >
      {Array.from({ length: n }, (_, k) => (
        <span key={k} className="tp-floor-side" aria-hidden="true" style={{ ...face, transform: `translateZ(${metres((HEIGHT.table * k) / n)})` }} />
      ))}
      <span className="tp-floor-top" style={{ ...face, transform: `translateZ(${metres(HEIGHT.table)})`, display: 'grid', placeItems: 'center' }}>
        <span style={{ display: 'grid', justifyItems: 'center', gap: '0.1em', padding: '0.2em', maxInlineSize: diamond ? '100%' : undefined, transform: diamond ? 'rotate(-45deg)' : undefined }}>
          <strong style={{ fontSize: '1.45em', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
            <bdi>{spot.table.table_number}</bdi>
          </strong>
          {detail && (
            <span style={{ fontSize: '0.82em', fontWeight: 600, lineHeight: 1.1, maxInlineSize: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '0.25em' }}>
              {first?.offlineState && <OfflineMarkIcon state={first.offlineState} size={11} />}
              <bdi>{detail}</bdi>
            </span>
          )}
        </span>
        {spot.calling && (
          <span style={{ position: 'absolute', insetBlockStart: '-0.5rem', insetInlineEnd: '-0.5rem' }}>
            <CallingMark className="tp-floor-bell" style={{ boxShadow: 'var(--tp-shadow-raised)' }} />
          </span>
        )}
      </span>
    </button>
  );
}

/** The words for a table: its name, its state for the accessible name, and the line under its number. */
function describeSpot(spot: CafeSpot, tr: ReturnType<typeof useLocale>['tr'], locale: ReturnType<typeof useLocale>['locale']) {
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
  return { name, state, detail, first };
}

/** A table the plan has no place for (the list beside it): a flat tile in the same colours. */
function TableButton({ spot, onPress, style }: { spot: CafeSpot; onPress: () => void; style: CSSProperties }) {
  const { tr, locale } = useLocale();
  const { name, state, detail, first } = describeSpot(spot, tr, locale);
  return (
    <button
      type="button"
      className="tp-tile"
      data-status={spot.status}
      aria-label={[name, state, first?.offlineState ? tr(OFFLINE_MARK[first.offlineState].key) : null, spot.calling ? tr('ws.cashier.floor.legend.calling') : null].filter(Boolean).join(', ')}
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
          {first?.offlineState && <OfflineMarkIcon state={first.offlineState} size={11} />}
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
  const guest = (b: BoardBooking) => reservationNameOf(b.booking, tr) ?? tr('op.till.forReservation');
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
            // A ticket on the service rail like the calls above it: a green dot
            // for a live tab, the name, a Paying chip, and the way in.
            style={{
              ...touchTarget,
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--tp-sp-2)',
              textAlign: 'start',
              paddingBlock: 'var(--tp-sp-2)',
              paddingInline: 'var(--tp-sp-2-5)',
              border: 'none',
              borderRadius: 'var(--tp-radius-panel)',
              background: 'var(--tp-surface)',
              color: 'var(--tp-fg)',
              font: 'inherit',
              minInlineSize: 0,
            }}
          >
            <span aria-hidden="true" style={{ inlineSize: '0.6rem', blockSize: '0.6rem', borderRadius: '50%', background: 'var(--tp-success)', flexShrink: 0 }} />
            <strong style={{ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <bdi>{t.label}</bdi>
            </strong>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', whiteSpace: 'nowrap' }}>
              {t.offlineState && <OfflineMarkIcon state={t.offlineState} size={12} label={tr(OFFLINE_MARK[t.offlineState].key)} />}
              {t.status === 'awaiting_payment' && (
                <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 700, borderRadius: 'var(--tp-radius-pill)', paddingInline: 'var(--tp-sp-2)', background: 'var(--tp-warn)', color: 'var(--tp-brand-black)' }}>
                  {tr('ws.cashier.floor.paying')}
                </span>
              )}
              <ChevronForward size={16} style={{ color: 'var(--tp-muted-fg)' }} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
