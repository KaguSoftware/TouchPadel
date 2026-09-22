/**
 * Live floor (owner request, 2026-09-18) — the venue right now as a
 * three-dimensional plan, on the owner's landing screen and Observe's.
 *
 * WHAT IT ANSWERS: "what is happening on the floor this minute?" — which
 * courts are in play, which tables have a tab open and whether it is waiting
 * to be paid, who is at a live station and who is on a break. The plan is the
 * picture; the three counts above it are the answer in words, and they do not
 * depend on the picture: a machine that cannot draw WebGL still gets them.
 *
 * WHY IT IS BUILT THIS WAY
 *  - The numbers are React and the plan is a lazily loaded three.js module.
 *    The owner's screen must never wait on a 600 KB library to say "1 of 2
 *    courts in play", and the unit tests never touch a GPU.
 *  - The tooltip is rendered by React from the snapshot, not injected as
 *    HTML by the scene, so it speaks both languages and mirrors under RTL
 *    like everything else on the page.
 *  - The legend sits under the plan, not over it: overlaid on the canvas it
 *    hid the entrance in Arabic, where it mirrored to the other corner.
 *  - Wheel zoom is off (the page scrolls); closer is a click, back is the one
 *    button that appears only once you have moved.
 *  - Guest counts at tables are not known to the system and are not drawn.
 *    A court in play is drawn with four players, the only way padel is
 *    played. A guest marked arrived before their slot starts is named on the
 *    court's card, not drawn on it: arrived is not playing. See floorModel.ts.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { formatNumber, formatTime } from '@touch/i18n';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Skeleton } from '../../components/ui';
import { ScreenOwnerClaim } from '../../lib/screenOwner';
import { touch } from '../../ipc/bridge';
import { AsyncStateWrapper, Panel } from '../../components/kit';
import { ConnectionPill } from '../../components/ConnectionPill';
import { CardTitle, MARK, MARK_FG } from '../ops/OpsVisuals';
import { countsOf, type FloorSnapshot, type FloorTarget, type Room } from './floorModel';
import { useLiveFloor } from './floorData';
import type { FloorSceneHandle } from './floorScene';

const ROOM_LABEL: Record<Room, 'reception' | 'bar' | 'kitchen' | 'office' | 'meeting' | 'floor'> = {
  reception: 'reception',
  bar: 'bar',
  kitchen: 'kitchen',
  office: 'office',
  meeting: 'meeting',
  floor: 'floor',
};

/** Whether this machine can draw the plan at all. Decided once. */
function canDraw(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function LiveFloor({
  blockSize = '24rem',
  level = 2,
  boardLinks = false,
}: {
  /** Height of the plan itself; the counts and legend sit outside it. */
  blockSize?: string;
  level?: 2 | 3;
  /** Offer the Observe boards as the way deeper (off on Observe's own home, where they are cards below). */
  boardLinks?: boolean;
}) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const floor = useLiveFloor();
  const snapshot = floor.snapshot;

  return (
    <Panel
      level={level}
      title={<CardTitle icon="court">{tr('ws.owner.floor.title')}</CardTitle>}
      actions={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {floor.updatedAt > 0 && (
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {tr('ws.owner.floor.updated', { time: formatTime(new Date(floor.updatedAt), locale) })}
            </span>
          )}
          <ConnectionPill status={floor.connection} />
          {boardLinks && (
            <>
              <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/observation/courts' })}>
                {tr('ws.owner.floor.openBookings')}
              </Button>
              <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/observation/tills' })}>
                {tr('ws.owner.floor.openTills')}
              </Button>
            </>
          )}
        </span>
      }
    >
      <AsyncStateWrapper
        status={floor.status}
        error={floor.error}
        onRetry={floor.refetch}
        skeleton={
          <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'minmax(11rem, 14rem) minmax(0, 1fr)', gap: 'var(--tp-sp-4)' }}>
            <Skeleton lines={4} blockSize="1.6rem" />
            <Skeleton lines={1} blockSize={blockSize} />
          </div>
        }
      >
        {snapshot && <FloorBody snapshot={snapshot} blockSize={blockSize} />}
      </AsyncStateWrapper>
    </Panel>
  );
}

function FloorBody({ snapshot, blockSize }: { snapshot: FloorSnapshot; blockSize: string }) {
  const { tr, locale } = useLocale();
  const counts = countsOf(snapshot);
  const n = (v: number) => formatNumber(v, locale);
  const of = (a: number, b: number) => tr('ws.owner.floor.counters.of', { n: n(a), total: n(b) });

  return (
    // The figures stand BESIDE the plan, not over it (owner call, 2026-09-18):
    // a column of counts, the key, and the honesty note on the start side,
    // the plan taking the rest of the width and its whole height.
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(11rem, 14rem) minmax(0, 1fr)', gap: 'var(--tp-sp-4)', alignItems: 'stretch' }}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', alignContent: 'start' }}>
        <dl style={{ margin: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
          <Count label={tr('ws.owner.floor.counters.courts')} value={of(counts.courtsInPlay, counts.courtsTotal)} live={counts.courtsInPlay > 0} />
          <Count label={tr('ws.owner.floor.counters.tables')} value={of(counts.tablesOccupied, counts.tablesTotal)} live={counts.tablesOccupied > 0} />
          <Count label={tr('ws.owner.floor.counters.staff')} value={n(counts.staffWorking)} live={counts.staffWorking > 0} />
          {counts.staffOnBreak > 0 && <Count label={tr('ws.owner.floor.counters.onBreak')} value={n(counts.staffOnBreak)} live={false} />}
        </dl>

        <Legend />

        {(counts.courtsNotDrawn > 0 || counts.tablesNotDrawn > 0) && (
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {counts.courtsNotDrawn > 0 && (
              <>
                {tr('ws.owner.floor.notDrawnCourts')} <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{n(counts.courtsNotDrawn)}</strong>
                {counts.tablesNotDrawn > 0 ? ' · ' : '. '}
              </>
            )}
            {counts.tablesNotDrawn > 0 && (
              <>
                {tr('ws.owner.floor.notDrawnTables')} <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{n(counts.tablesNotDrawn)}</strong>
                {'. '}
              </>
            )}
            {tr('ws.owner.floor.notDrawnHint')}
          </p>
        )}
      </div>

      <Stage snapshot={snapshot} blockSize={blockSize} />
    </div>
  );
}

/** One of the counts beside the plan: label over the figure. Tone only when there is something. */
function Count({ label, value, live }: { label: string; value: string; live: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
      <dt style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          fontSize: 'var(--tp-fs-xl)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: live ? MARK_FG.success : 'var(--tp-fg)',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

interface Hover {
  target: FloorTarget;
  x: number;
  y: number;
}

function Stage({ snapshot, blockSize }: { snapshot: FloorSnapshot; blockSize: string }) {
  const { tr, locale } = useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FloorSceneHandle | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [drawable] = useState(canDraw);
  // Pixels the macOS traffic lights are drawn over, for the full-screen
  // corner. Absent off Electron and off macOS, where they do not exist.
  const [titleBarInset] = useState(() => touch.getStation().titleBarInset ?? 0);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [focused, setFocused] = useState(false);
  const [full, setFull] = useState(false);
  // Where the slider's thumb sits: 0 the whole floor, 1 as close as the plan
  // goes. The scene owns the truth and reports every camera move, so the
  // buttons, a click on a court and a drag all carry the thumb with them.
  const [zoomLevel, setZoomLevel] = useState(0);

  useEffect(() => {
    if (!drawable || !hostRef.current) return;
    const host = hostRef.current;
    let cancelled = false;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    void import('./floorScene').then(({ createFloorScene }) => {
      if (cancelled) return;
      const scene = createFloorScene(
        host,
        {
          onHover: (target, point) => setHover(target ? { target, x: point.x, y: point.y } : null),
          onPick: (target) => {
            sceneRef.current?.focus(target);
            setFocused(true);
          },
          onMoved: () => setFocused(true),
          onZoom: setZoomLevel,
        },
        { reducedMotion },
      );
      sceneRef.current = scene;
      scene.apply(snapshotRef.current);
      setReady(true);
    });
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [drawable]);

  useEffect(() => {
    sceneRef.current?.apply(snapshot);
  }, [snapshot]);

  // The wheel zooms the plan wherever it is (owner request, 2026-09-21), and
  // only over the plan — the handler is on the canvas, so the wheel means what
  // it always meant everywhere else on the page. Inside the scrolling panel it
  // hands the wheel back once the plan is all the way out or all the way in,
  // so the page still scrolls past rather than trapping the reader on the
  // canvas; see the note on the handler in floorScene.ts.
  //
  // Full screen additionally covers the window, and Escape is the way out
  // alongside the button.
  useEffect(() => {
    sceneRef.current?.setWheelZoom(true);
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, ready]);

  const stage: CSSProperties = full
    ? { position: 'fixed', inset: 0, zIndex: 'var(--tp-z-overlay)' as CSSProperties['zIndex'], background: 'var(--tp-bg)', overflow: 'hidden' }
    : {
        position: 'relative',
        // At least this tall, and as tall as the column beside it when that is more.
        minBlockSize: blockSize,
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-bg)',
        border: '1px solid var(--tp-border)',
        overflow: 'hidden',
      };

  if (!drawable) {
    return (
      <div style={{ ...stage, display: 'grid', placeItems: 'center', padding: 'var(--tp-sp-4)' }} data-testid="floor-no-webgl">
        <p style={{ margin: 0, maxInlineSize: '40ch', textAlign: 'center', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.floor.noWebgl')}</p>
      </div>
    );
  }

  return (
    <div style={stage}>
      {/* Full screen only: the exit and zoom buttons sit in the top corner,
          which is where the macOS drag strip would be. Inline, not laid out. */}
      {full && <ScreenOwnerClaim />}
      <div
        ref={hostRef}
        role="img"
        aria-label={tr('ws.owner.floor.ariaLabel')}
        // The plan itself is geometry: it does not mirror with the document.
        dir="ltr"
        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      />
      {!ready && (
        <div aria-busy="true" style={{ position: 'absolute', inset: 0, padding: 'var(--tp-sp-3)' }}>
          <Skeleton lines={1} blockSize="100%" style={{ blockSize: '100%' }} />
        </div>
      )}
      {/* "Show whole floor" sits in the top START corner, opposite the zoom
          cluster (owner call, 2026-09-21): it undoes a move rather than
          adjusting one, so it does not belong in the column of controls that
          make the moves. Only once the view HAS moved — at the whole floor it
          would be a control that does nothing. */}
      {ready && (focused || full) && (
        <div
          style={{
            position: 'absolute',
            // Full screen puts this corner under the macOS traffic lights,
            // which the OS draws over the page ('hiddenInset'): clear the
            // band they occupy and keep the usual gap below it, so the row
            // sits under them rather than behind them.
            //
            // In BOTH languages, now that the row spans the full width. The
            // lights stay at the window's physical top-LEFT whatever the
            // script (__root.tsx says the same where the sign-in panels
            // handle this), and this row always has a control at each end —
            // so whichever button is physically on the left is under them:
            // "Show whole floor" in English, the way out in Arabic. Dropping
            // the inset for Arabic, as an earlier version did, put the exit
            // button straight on top of the lights.
            //
            // Windowed, the plan is inside the page and this corner is the
            // panel's own, so the ordinary gap is all it needs; and the inset
            // is 0 on Windows, in the browser and on every kiosk, where the
            // lights do not exist at all.
            insetBlockStart: full && titleBarInset > 0 ? `calc(${titleBarInset}px + var(--tp-sp-2))` : 'var(--tp-sp-2)',
            // The row spans both gutters so its two controls can sit in
            // opposite corners of the SAME line: "Show whole floor" at the
            // start, the way out of full screen at the end.
            insetInlineStart: 'var(--tp-sp-2)',
            insetInlineEnd: 'var(--tp-sp-2)',
            display: 'flex',
            gap: 'var(--tp-sp-1)',
            alignItems: 'center',
            justifyContent: 'space-between',
            // Only the buttons are clickable; the empty middle of the row must
            // not sit over the plan and swallow a drag or a click on a court.
            pointerEvents: 'none',
          }}
        >
          {/* Only once the view HAS moved — at the whole floor it would be a
              control that does nothing. In full screen the row may therefore
              hold the way out alone. */}
          {focused ? (
            <Button
              size="sm"
              icon="court"
              style={{ pointerEvents: 'auto' }}
              onClick={() => {
                sceneRef.current?.focus(null);
                setFocused(false);
              }}
            >
              {tr('ws.owner.floor.showWhole')}
            </Button>
          ) : (
            // Holds the start of the row so the way out stays at the end
            // rather than sliding over when there is nothing to reset.
            <span />
          )}
          {/* Full screen only: the way out joins this row rather than keeping
              its own corner (owner call, 2026-09-21) — the two controls that
              step BACK out of something belong together, and the corner it
              used to hold is the one the traffic lights complicate. */}
          {full && (
            <Button
              size="sm"
              icon="frameExit"
              style={{ pointerEvents: 'auto' }}
              aria-label={tr('ws.owner.floor.exitFullScreen')}
              title={tr('ws.owner.floor.exitFullScreen')}
              onClick={() => setFull(false)}
            />
          )}
        </div>
      )}
      {/* The zoom column, read top to bottom the way the view moves: Closer,
          the track, Further. The track's two ends are the two buttons, so the
          column says the same thing three ways.

          In full screen too (owner call, 2026-09-21): the wheel zooms there
          as well, but a wheel is not a control — it says nothing about where
          the view stands between the whole floor and the nearest it goes, and
          a trackpad-less till has only the buttons. The track answers both. */}
      {ready && (
        <div
          style={{
            position: 'absolute',
            insetBlockEnd: 'var(--tp-sp-2)',
            insetInlineEnd: 'var(--tp-sp-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--tp-sp-1)',
            alignItems: 'center',
          }}
        >
          <Button
            size="sm"
            icon="zoomIn"
            aria-label={tr('ws.owner.floor.zoomIn')}
            title={tr('ws.owner.floor.zoomIn')}
            onClick={() => {
              sceneRef.current?.zoom('in');
              setFocused(true);
            }}
          />
          <ZoomSlider
            value={zoomLevel}
            onChange={(v) => {
              sceneRef.current?.setZoomLevel(v);
              setZoomLevel(v);
              if (v > 0) setFocused(true);
            }}
          />
          <Button
            size="sm"
            icon="zoomOut"
            aria-label={tr('ws.owner.floor.zoomOut')}
            title={tr('ws.owner.floor.zoomOut')}
            onClick={() => {
              sceneRef.current?.zoom('out');
              setFocused(true);
            }}
          />
        </div>
      )}
      {/* Windowed, the way IN sits in the top end corner, above the zoom
          column: it is the one control that changes the whole frame rather
          than the view inside it. In full screen the way OUT moves to the
          start-corner row instead, beside "Show whole floor". Icon only —
          the label lives in the tooltip and the accessible name, so the
          corner stays quiet. */}
      {ready && !full && (
        <div style={{ position: 'absolute', insetBlockStart: 'var(--tp-sp-2)', insetInlineEnd: 'var(--tp-sp-2)' }}>
          <Button
            size="sm"
            icon="frame"
            aria-label={tr('ws.owner.floor.fullScreen')}
            title={tr('ws.owner.floor.fullScreen')}
            onClick={() => setFull(true)}
          />
        </div>
      )}
      {/* The hint is two elements, and the reason is the background.
          The <p> is an invisible frame: pinned to BOTH side gutters, it is
          what stops the sentence — wrapped lines included — from ever
          reaching the full-screen button in the corner. The <span> inside
          carries the surface, and being inline it is only ever as wide as
          the words themselves, so the paint stops where the text stops
          instead of running on across empty floor. */}
      <p
        style={{
          position: 'absolute',
          insetBlockEnd: 'var(--tp-sp-2)',
          insetInlineStart: 'var(--tp-sp-3)',
          insetInlineEnd: 'calc(var(--tp-sp-2) + 1.85rem + var(--tp-sp-2))',
          margin: 0,
          fontSize: 'var(--tp-fs-xs)',
          color: 'var(--tp-muted-fg)',
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            // A wrapped line breaks the box in two, and each piece keeps the
            // rounding, so the sentence never looks like a torn label.
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
            paddingBlock: 'var(--tp-sp-0)',
            paddingInline: 'var(--tp-sp-2)',
            borderRadius: 'var(--tp-radius-sm)',
            background: 'var(--tp-surface)',
          }}
        >
          {tr(full ? 'ws.owner.floor.hintFull' : 'ws.owner.floor.hint')}
        </span>
      </p>
      {/* Pointer coordinates are physical, so the tooltip is placed inside an
          LTR overlay and only its content follows the document direction. */}
      {hover && (
        <div dir="ltr" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <Tooltip hover={hover} snapshot={snapshot} host={hostRef.current} locale={locale} />
        </div>
      )}
    </div>
  );
}

/**
 * The zoom track: upright, under "Closer" and over "Further", so the column
 * reads the way the view moves — top is near, bottom is far.
 *
 * A native range input, not a div with a drag handler: it arrives with the
 * keyboard (arrows, Home/End), the pointer, touch and the screen reader's
 * slider role already right, and macOS and Windows both give it the grab
 * behaviour the owner expects. Only the paint is ours.
 *
 * Upright is `writing-mode: vertical-lr` + `direction: rtl` (GlobalStyles),
 * not a rotate() — the browser then knows the control is vertical, so Up/Right
 * really do move toward 100 and the hit box is the box that is drawn. A
 * rotated slider keeps its horizontal hit box and its arrow keys stay
 * sideways, which is wrong for a mouse and wrong for a screen reader.
 *
 * Nothing here mirrors under RTL: the track is vertical, and near is at the
 * top in both scripts.
 */
function ZoomSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { tr } = useLocale();
  const pct = Math.round(value * 100);
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={1}
      value={pct}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
      aria-label={tr('ws.owner.floor.zoomLevel')}
      title={tr('ws.owner.floor.zoomLevel')}
      data-testid="floor-zoom-slider"
      className="tp-floor-zoom"
      style={{
        // Upright, between the two buttons: closer at the top under "Closer",
        // further at the bottom above "Further".
        //
        // THESE READ BACKWARDS AND ARE CORRECT. The element's own writing mode
        // is vertical (GlobalStyles), and logical sizes resolve against THAT,
        // not the page's — so the inline axis here runs down the screen and
        // the block axis runs across it. Written the intuitive way round, the
        // control renders 80 × 24 instead of 24 × 80.
        inlineSize: '5rem',
        blockSize: '1.5rem',
        margin: 0,
        cursor: 'pointer',
        // The fill stops at the CENTRE OF THE CIRCLE, at every value.
        //
        // A percentage of the track would not: the thumb's centre never
        // reaches either end, it travels only between half a thumb in from
        // each, so `${pct}%` runs ahead of the circle in the middle of the
        // range and the blue pokes out below it. The stop is therefore
        // measured in the same units the thumb actually moves in — half a
        // thumb, plus pct of what is left — which lands on the centre
        // wherever the thumb is, including hard against both ends.
        //
        // The two colours come from --tp-zoom-fill / --tp-zoom-track
        // (GlobalStyles), not from --tp-accent / --tp-border, because blue
        // mode pins this control to the paper theme's paint and those tokens
        // invert there.
        background: `linear-gradient(to top, var(--tp-zoom-fill) calc(0.75rem + ${pct} * (100% - 1.5rem) / 100), var(--tp-zoom-track) calc(0.75rem + ${pct} * (100% - 1.5rem) / 100))`,
      }}
    />
  );
}

/** What the pointer is over, in words, beside the pointer. */
function Tooltip({ hover, snapshot, host, locale }: { hover: Hover; snapshot: FloorSnapshot; host: HTMLDivElement | null; locale: ReturnType<typeof useLocale>['locale'] }) {
  const { tr } = useLocale();
  const body = describe(hover.target, snapshot, tr, locale);
  if (!body) return null;
  // Keep it inside the stage: flip to the other side of the pointer near the far edge.
  const w = host?.clientWidth ?? 0;
  const h = host?.clientHeight ?? 0;
  const flipX = w > 0 && hover.x > w - 240;
  const flipY = h > 0 && hover.y > h - 120;
  // The positioned box inherits the overlay's LTR (inset-inline-start resolves
  // against the element's OWN direction, so it must not carry the page's);
  // only the words inside take the document direction.
  return (
    <div
      style={{
        position: 'absolute',
        insetBlockStart: 0,
        insetInlineStart: 0,
        transform: `translate(${flipX ? hover.x - 14 : hover.x + 14}px, ${flipY ? hover.y - 14 : hover.y + 14}px) translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`,
        pointerEvents: 'none',
      }}
    >
      <div
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
        style={{
          background: 'var(--tp-surface)',
          border: '1px solid var(--tp-border)',
          borderRadius: 'var(--tp-radius-ctl)',
          boxShadow: 'var(--tp-shadow-popover)',
          paddingBlock: 'var(--tp-sp-2)',
          paddingInline: 'var(--tp-sp-3)',
          fontSize: 'var(--tp-fs-sm)',
          lineHeight: 1.4,
          minInlineSize: '10rem',
          maxInlineSize: '16rem',
          display: 'grid',
          gap: 'var(--tp-sp-1)',
        }}
      >
        {body}
      </div>
    </div>
  );
}

type Tr = ReturnType<typeof useLocale>['tr'];

function describe(target: FloorTarget, s: FloorSnapshot, tr: Tr, locale: ReturnType<typeof useLocale>['locale']): ReactNode {
  const time = (iso: string) => formatTime(new Date(iso), locale);
  if (target.kind === 'court') {
    const c = s.courts.find((x) => x.id === target.id);
    if (!c) return null;
    const tone = c.status === 'in_play' ? 'success' : c.status === 'booked' ? 'warn' : 'neutral';
    return (
      <>
        <strong>{pickName(locale, c)}</strong>
        <Status tone={tone}>{tr(`ws.owner.floor.court.${c.status === 'in_play' ? 'inPlay' : c.status}`)}</Status>
        {c.status !== 'free' && (
          <Parts>
            {c.guest && <bdi>{c.guest}</bdi>}
            {c.until && <span>{tr('ws.owner.floor.court.until', { time: time(c.until) })}</span>}
          </Parts>
        )}
        {c.waiting ? (
          <span style={{ color: 'var(--tp-muted-fg)' }}>
            {c.waiting.guest
              ? tr('ws.owner.floor.court.waiting', { guest: c.waiting.guest, time: time(c.waiting.startsAt) })
              : tr('ws.owner.floor.court.waitingAnon', { time: time(c.waiting.startsAt) })}
          </span>
        ) : (
          c.status === 'free' && c.nextAt && <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.floor.court.next', { time: time(c.nextAt) })}</span>
        )}
      </>
    );
  }
  if (target.kind === 'table') {
    const t = s.tables.find((x) => x.id === target.id);
    if (!t) return null;
    return (
      <>
        <strong>{tr('ws.owner.floor.table.table', { number: t.number })}</strong>
        <Status tone={t.tab ? (t.tab.state === 'awaiting_payment' ? 'warn' : 'success') : 'neutral'}>
          {t.tab ? tr(t.tab.state === 'awaiting_payment' ? 'ws.owner.floor.table.awaiting' : 'ws.owner.floor.table.open') : tr('ws.owner.floor.table.free')}
        </Status>
        {t.tab && (
          <Parts>
            {(t.tab.guest ?? t.tab.label) && <bdi>{t.tab.guest ?? t.tab.label}</bdi>}
            <span>{tr('ws.owner.floor.table.since', { time: time(t.tab.openedAt) })}</span>
          </Parts>
        )}
      </>
    );
  }
  const people = s.staff.filter((p) => p.room === target.room);
  return (
    <>
      <strong>{tr(`ws.owner.floor.rooms.${ROOM_LABEL[target.room]}`)}</strong>
      {people.length === 0 ? (
        <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.floor.staff.nobody')}</span>
      ) : (
        people.map((p) => (
          <span key={p.id} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <bdi>{p.name}</bdi>
            <Status tone={p.status === 'working' ? 'success' : 'neutral'}>{tr(`ws.owner.floor.staff.${p.status}`)}</Status>
            <Parts small>
              {p.coveringFor ? (
                <span>{tr('ws.owner.floor.staff.covering', { name: p.coveringFor })}</span>
              ) : p.stationId ? (
                <span>{tr('ws.owner.floor.staff.station', { station: p.stationId })}</span>
              ) : null}
              {p.since && <span>{tr('ws.owner.floor.staff.since', { time: time(p.since) })}</span>}
            </Parts>
          </span>
        ))
      )}
    </>
  );
}

/** Muted detail fragments separated by a middle dot; each one bidi-isolated so a Latin name sits right in an Arabic line. */
function Parts({ children, small }: { children: ReactNode; small?: boolean }) {
  const parts = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <span style={{ color: 'var(--tp-muted-fg)', fontSize: small ? 'var(--tp-fs-xs)' : undefined }}>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {part}
        </span>
      ))}
    </span>
  );
}

function Status({ tone, children }: { tone: 'success' | 'warn' | 'neutral'; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', fontWeight: 600, color: tone === 'neutral' ? 'var(--tp-muted-fg)' : MARK_FG[tone] }}>
      <span aria-hidden="true" style={{ inlineSize: '0.5rem', blockSize: '0.5rem', borderRadius: '50%', background: MARK[tone] }} />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function Legend() {
  const { tr } = useLocale();
  const item = (mark: ReactNode, label: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', whiteSpace: 'nowrap' }}>
      {mark}
      {label}
    </span>
  );
  const swatch = (bg: string, border?: string) => (
    <span aria-hidden="true" style={{ inlineSize: '0.7rem', blockSize: '0.7rem', borderRadius: '3px', background: bg, border: border ?? 'none', boxSizing: 'border-box' }} />
  );
  const cap = (bg: string, border?: string) => (
    <span aria-hidden="true" style={{ inlineSize: '0.5rem', blockSize: '0.85rem', borderRadius: '999px', background: bg, border: border ?? 'none', boxSizing: 'border-box' }} />
  );
  const hat = (color: string) => (
    <span aria-hidden="true" style={{ position: 'relative', display: 'inline-block', inlineSize: '0.5rem', blockSize: '0.85rem', borderRadius: '999px', background: 'repeating-linear-gradient(180deg, #3360AB 0 3px, #A5D06F 3px 4.5px)' }}>
      <span style={{ position: 'absolute', insetInline: '-2px', insetBlockStart: '-4px', blockSize: '4px', borderRadius: '2px 2px 0 0', background: color }} />
    </span>
  );
  return (
    <ul
      aria-label={tr('ws.owner.floor.title')}
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}
    >
      <li>{item(swatch('#A5D06F'), tr('ws.owner.floor.legend.inPlay'))}</li>
      <li>{item(swatch('#D9A64B'), tr('ws.owner.floor.legend.booked'))}</li>
      <li>{item(swatch('#BCBDBF'), tr('ws.owner.floor.legend.free'))}</li>
      <li>{item(cap('#A5D06F'), tr('ws.owner.floor.legend.players'))}</li>
      <li>{item(cap('var(--tp-surface)', '1px solid #BCBDBF'), tr('ws.owner.floor.legend.seated'))}</li>
      <li>{item(cap('#D9A64B'), tr('ws.owner.floor.legend.paying'))}</li>
      <li>{item(hat('#A5D06F'), tr('ws.owner.floor.legend.staffWorking'))}</li>
      <li>{item(hat('#BCBDBF'), tr('ws.owner.floor.legend.staffBreak'))}</li>
    </ul>
  );
}
