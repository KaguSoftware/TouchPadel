/**
 * The customer record's cards (owner's pick, 2026-10-14, "option C"): a row of
 * summary cards and a grid of section cards. Each card answers one question at
 * a glance, and pressing it opens the whole section in a dialog
 * (CustomerRecord.tsx `SectionDialog`), so nothing on the page folds open.
 *
 * Presentational only: the record screen hands every figure in. The look
 * (ground, edge, hover lift, the accent and loyalty tones, the ticket notches)
 * is `.tp-record-card` in GlobalStyles, because hover cannot be inline.
 */
import { useId, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from '../../../components/icons';

export type RecordCardTone = 'plain' | 'accent' | 'loyalty' | 'ticket' | 'scoreboard';

const cardBase: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--tp-sp-3)',
  paddingBlock: 'var(--tp-sp-4)',
  paddingInline: 'var(--tp-sp-4)',
  minBlockSize: '11.5rem',
  inlineSize: '100%',
  textAlign: 'start',
  font: 'inherit',
};

/** A summary card. With `onOpen` it is a button that opens its section's dialog. */
export function RecordCard({
  label,
  aside,
  onOpen,
  tone = 'plain',
  decoration,
  children,
  testId,
  tier,
}: {
  /** The loyalty card's tier colour (data-tier); see recordSummary.tierColour. */
  tier?: string | null;
  label: string;
  /** Beside the label, at the end edge (a countdown, a tier). Replaces the chevron. */
  aside?: ReactNode;
  onOpen?: () => void;
  tone?: RecordCardTone;
  /** Drawn behind the content (the racket on the next booking). */
  decoration?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  // The dark cards (the blue next booking, the charcoal scoreboard) carry light ink.
  const accent = tone === 'accent' || tone === 'scoreboard';
  const inner = (
    <>
      {decoration}
      <span
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--tp-sp-2)',
          fontSize: 'var(--tp-fs-sm)',
          fontWeight: 600,
          color: accent ? 'inherit' : 'var(--tp-muted-fg)',
          position: 'relative',
          // A rule under the label and its chevron, like the section cards' (owner, 2026-10-14).
          // currentColor, so it reads on the accent card as on the plain ones.
          paddingBlockEnd: 'var(--tp-sp-2)',
          borderBlockEnd: '1px solid color-mix(in oklab, currentColor 20%, transparent)',
          // One height whatever sits at the end (a chevron, the countdown, the
          // tier), so the rules line up across the row.
          boxSizing: 'border-box',
          minBlockSize: 'calc(1.75rem + var(--tp-sp-2))',
          flex: 'none',
        }}
      >
        <span>{label}</span>
        {aside ?? (onOpen && <span className="tp-record-open" style={{ display: 'inline-flex' }}><Icon name="chevronEnd" size={16} dataChevron /></span>)}
      </span>
      {children}
    </>
  );
  return onOpen ? (
    <button type="button" className="tp-record-card tp-tile" data-tone={tone} data-tier={tier ?? undefined} aria-haspopup="dialog" onClick={onOpen} style={cardBase} data-testid={testId}>
      {inner}
    </button>
  ) : (
    <section className="tp-record-card" data-tone={tone} data-tier={tier ?? undefined} aria-label={label} style={cardBase} data-testid={testId}>
      {inner}
    </section>
  );
}

/** The big figure a card leads with, and its unit in small type after it. */
export function Figure({ value, unit, size = 'lg' }: { value: ReactNode; unit?: ReactNode; size?: 'lg' | 'md' }) {
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', lineHeight: 1, marginBlockStart: 'var(--tp-sp-1)', position: 'relative' }}>
      <span style={{ fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: size === 'lg' ? 'var(--tp-fs-3xl)' : 'var(--tp-fs-2xl)', letterSpacing: '-0.01em' }}>{value}</span>
      {unit && <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 500 }}>{unit}</span>}
    </span>
  );
}

/** The quiet line at a card's foot. Pinned to the bottom so the cards in a row line up. */
export function CardFoot({ children, rule }: { children: ReactNode; rule?: boolean }) {
  return (
    <span
      style={{
        marginBlockStart: 'auto',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'var(--tp-sp-2)',
        flexWrap: 'wrap',
        fontSize: 'var(--tp-fs-sm)',
        position: 'relative',
        ...(rule ? { paddingBlockStart: 'var(--tp-sp-2)', borderBlockStart: '1px solid color-mix(in oklab, currentColor 22%, transparent)' } : { color: 'var(--tp-muted-fg)' }),
      }}
    >
      {children}
    </span>
  );
}

/** A small rounded label on a card (the countdown, the tier). */
export function CardPill({ children, tone }: { children: ReactNode; tone: 'green' | 'gold' | 'tier' }) {
  return (
    <span
      className={tone === 'tier' ? 'tp-card-pill tp-tier-pill' : 'tp-card-pill'}
      style={{
        // A centred flex box at line-height 1, so the word sits in the middle of
        // the pill rather than riding high (the same fix StatusBadge carries),
        // and a fixed height so every pill lines up with the label beside it.
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        blockSize: '1.5rem',
        lineHeight: 1,
        borderRadius: 'var(--tp-radius-pill)',
        paddingInline: 'var(--tp-sp-2-5)',
        fontSize: 'var(--tp-fs-xs)',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        ...(tone === 'green'
          ? { background: 'var(--tp-accent-2)', color: 'var(--tp-accent-2-contrast)' }
          : tone === 'gold'
            ? { background: 'var(--tp-warn-soft)', color: 'var(--tp-warn-fg)', border: '1px solid var(--tp-warn)' }
            : // Nothing inline: the loyalty card's .tp-tier-pill draws its ground and its
              // black outline, and an inline border would outrank that.
              {}),
      }}
    >
      {children}
    </span>
  );
}

/** The racket head's outline (viewBox 0 0 160 240): a padel head, wide and rounded, narrowing into the throat. */
const RACKET_HEAD = 'M80 10 C118 10 140 34 140 72 C140 112 120 140 98 156 L91 176 L69 176 L62 156 C40 140 20 112 20 72 C20 34 42 10 80 10 Z';

/** The drill holes: a grid kept inside the face's ellipse, clear of its rim. */
const RACKET_HOLES: readonly (readonly [number, number])[] = (() => {
  const holes: [number, number][] = [];
  for (let y = 26; y <= 128; y += 12) {
    // Every other row shifts half a step, the way a racket is drilled.
    const shift = (y / 12) % 2 ? 6 : 0;
    for (let x = 32 + shift; x <= 128; x += 12) {
      if (((x - 80) / 50) ** 2 + ((y - 74) / 54) ** 2 < 0.82) holes.push([x, y]);
    }
  }
  return holes;
})();

/**
 * A padel racket and ball behind the next-booking card, drawn to read as
 * solid: the frame's darker side shows past the face, the face is lit from
 * the top edge, the drill holes and the throat are cut through, and the ball
 * is shaded round. Everything is currentColor at low opacity, so it is a
 * watermark on whatever ground the card has. Decorative.
 */
export function RacketMark() {
  const uid = useId().replace(/:/g, '');
  const face = `rk-face-${uid}`;
  const cut = `rk-cut-${uid}`;
  const ball = `rk-ball-${uid}`;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 250"
      className="tp-racket-mark"
      style={{ position: 'absolute', insetInlineEnd: '-1.25rem', insetBlockStart: '1.5rem', inlineSize: '9.5rem', opacity: 0.2, pointerEvents: 'none', color: 'inherit' }}
    >
      <defs>
        <linearGradient id={face} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="1" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.45" />
        </linearGradient>
        <radialGradient id={ball} cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="currentColor" stopOpacity="1" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.3" />
        </radialGradient>
        {/* What is cut through the face: the holes and the throat's opening. */}
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="160" height="240">
          <rect x="0" y="0" width="160" height="240" fill="white" />
          {RACKET_HOLES.map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={3.1} fill="black" />
          ))}
          <path d="M80 142 L93 162 L67 162 Z" fill="black" />
        </mask>
      </defs>
      <g transform="translate(46 8) rotate(24 80 120)">
        {/* The frame's side: the same shape, pushed back and darker. */}
        <path d={RACKET_HEAD} transform="translate(7 6)" fill="currentColor" fillOpacity={0.5} mask={`url(#${cut})`} />
        <rect x="76" y="176" width="20" height="58" rx="6" transform="translate(-6 6)" fill="currentColor" fillOpacity={0.5} />
        {/* The face, lit from its top edge, with its rim. */}
        <path d={RACKET_HEAD} fill={`url(#${face})`} mask={`url(#${cut})`} />
        <path d={RACKET_HEAD} fill="none" stroke="currentColor" strokeWidth={4} strokeOpacity={0.9} />
        {/* The handle, and the grip's wraps. */}
        <rect x="70" y="176" width="20" height="58" rx="6" fill="currentColor" fillOpacity={0.85} />
        {[188, 198, 208, 218].map((y) => (
          <line key={y} x1="70" y1={y} x2="90" y2={y + 5} stroke="currentColor" strokeOpacity={0.35} strokeWidth={2} />
        ))}
      </g>
      {/* The ball and its shadow. */}
      <ellipse cx="38" cy="214" rx="16" ry="4" fill="currentColor" fillOpacity={0.25} />
      <circle cx="38" cy="196" r="15" fill={`url(#${ball})`} />
      <path d="M25 190 C33 196 43 196 51 190" fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.5} transform="rotate(-20 38 196)" />
    </svg>
  );
}

export interface RingPart {
  key: string;
  label: string;
  value: number;
  /** A MARK-rung token: the ring and the key's swatch. */
  color: string;
}

/** A ring split by the parts, the headline figure in its middle, the key beside it; it sits on the card's bottom edge (owner, 2026-10-14). */
export function KeptRing({ parts, centre }: { parts: readonly RingPart[]; centre: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  let offset = 0;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', marginBlockStart: 'auto' }}>
      <span style={{ position: 'relative', inlineSize: '5.5rem', blockSize: '5.5rem', flex: 'none' }}>
        <svg viewBox="0 0 88 88" aria-hidden="true" style={{ inlineSize: '100%', blockSize: '100%', transform: 'rotate(-90deg)' }}>
          <circle cx="44" cy="44" r={r} fill="none" strokeWidth={10} style={{ stroke: 'var(--tp-ring-track, var(--tp-surface-2))' }} />
          {parts.map((p) => {
            const len = (p.value / total) * c;
            const el = len > 0 && (
              <circle key={p.key} cx="44" cy="44" r={r} fill="none" strokeWidth={10} style={{ stroke: p.color }} strokeDasharray={`${len} ${c}`} strokeDashoffset={-offset} />
            );
            offset += len;
            return el;
          })}
        </svg>
        <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 'var(--tp-fs-lg)' }}>
          <bdi>{centre}</bdi>
        </span>
      </span>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)', flex: 1, minInlineSize: 0, fontSize: 'var(--tp-fs-sm)' }}>
        {parts.map((p) => (
          <li key={p.key} style={{ display: 'grid', gridTemplateColumns: '0.65rem 1fr auto', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
            <span aria-hidden="true" style={{ inlineSize: '0.65rem', blockSize: '0.65rem', borderRadius: '3px', background: p.color }} />
            <span>{p.label}</span>
            <span style={{ fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{p.value}</span>
          </li>
        ))}
      </ul>
    </span>
  );
}

/** A thin bar, filled to `pct` with the brand green. */
export function Meter({ pct }: { pct: number }) {
  return (
    <span aria-hidden="true" style={{ display: 'block', blockSize: '0.5rem', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-surface-2)', overflow: 'hidden', position: 'relative' }}>
      <span style={{ display: 'block', blockSize: '100%', inlineSize: `${Math.max(0, Math.min(100, pct))}%`, borderRadius: 'var(--tp-radius-pill)', background: 'linear-gradient(90deg, var(--tp-success-mark), var(--tp-accent-2))' }} />
    </span>
  );
}

/** The dashed tear line of the tickets card, level with its notches. */
export function TearLine() {
  return <span aria-hidden="true" style={{ display: 'block', borderBlockStart: '2px dashed var(--tp-border-strong)', marginBlock: 'var(--tp-sp-1)', marginInline: 'var(--tp-sp-1)' }} />;
}

// ---------------------------------------------------------------------------
// Section cards
// ---------------------------------------------------------------------------

/** Each section's icon chip: its own family, clear of the others (operator.ts). */
export type SectionTone = 'matches' | 'lessons' | 'cafe' | 'series';
const SECTION_TONE: Record<SectionTone, { fg: string; bg: string; strip: string }> = {
  matches: { fg: 'var(--tp-success-fg)', bg: 'var(--tp-success-soft)', strip: 'var(--tp-success-mark)' },
  lessons: { fg: 'var(--tp-lesson)', bg: 'var(--tp-lesson-soft)', strip: 'var(--tp-lesson)' },
  cafe: { fg: 'var(--tp-warn-fg)', bg: 'var(--tp-warn-soft)', strip: 'var(--tp-warn)' },
  series: { fg: 'var(--tp-tournament)', bg: 'var(--tp-tournament-soft)', strip: 'var(--tp-tournament)' },
};

export function SectionCard({
  title,
  sub,
  icon,
  tone,
  openLabel,
  onOpen,
  children,
  testId,
}: {
  testId?: string;
  title: string;
  sub?: ReactNode;
  icon: IconName;
  tone: SectionTone;
  /** The "Open" word beside the chevron. */
  openLabel: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  const t = SECTION_TONE[tone];
  return (
    <button type="button" className="tp-record-card tp-tile tp-section-card" aria-haspopup="dialog" onClick={onOpen}
      // A strip on top in the section's own colour, the icon's (inline, so it
      // stays); the 1px outline turns that colour on hover only (owner,
      // 2026-10-15), from --tp-strip in .tp-section-card.
      style={{ ...cardBase, minBlockSize: '12rem', gap: 'var(--tp-sp-3)', borderBlockStart: `6px solid ${t.strip}`, ['--tp-strip' as string]: t.strip }}
      data-testid={testId}
    >
      <span style={{ display: 'grid', gridTemplateColumns: '2.25rem minmax(0, 1fr) auto', gap: 'var(--tp-sp-2-5)', alignItems: 'center', inlineSize: '100%', minBlockSize: '2.75rem' /* title and subtitle, so a card without a subtitle keeps its rule level with the rest */ }}>
        <span aria-hidden="true" style={{ inlineSize: '2.25rem', blockSize: '2.25rem', borderRadius: 'var(--tp-radius-panel)', display: 'grid', placeItems: 'center', background: t.bg, color: t.fg }}>
          <Icon name={icon} size={18} />
        </span>
        <span style={{ display: 'grid', minInlineSize: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 'var(--tp-fs-md)' }}>{title}</span>
          {sub && <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
        </span>
        <span className="tp-record-open" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-0)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
          {openLabel}
          <Icon name="chevronEnd" size={15} dataChevron />
        </span>
      </span>
      {/* The body under a rule, so the figure never crowds the heading; it fills
          the card, and whatever comes last (a list, the bars) sits on the bottom
          edge, so cards side by side line up. */}
      <span style={{ flex: 1, inlineSize: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-3)', paddingBlockStart: 'var(--tp-sp-3)', borderBlockStart: '1px solid var(--tp-border)' }}>
        {children}
      </span>
    </button>
  );
}

export interface MiniRow {
  key: string;
  dot: 'ok' | 'warn' | 'info' | 'bad' | 'neutral';
  text: ReactNode;
  aside?: ReactNode;
}

const DOT: Record<MiniRow['dot'], string> = {
  ok: 'var(--tp-success-mark)',
  warn: 'var(--tp-warn-mark)',
  info: 'var(--tp-accent)',
  bad: 'var(--tp-danger-mark)',
  neutral: 'var(--tp-neutral-mark)',
};

/** A section card's last few items: a status dot, the item, and a quiet word at the end. */
export function MiniList({ rows }: { rows: readonly MiniRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul style={{ listStyle: 'none', margin: 0, marginBlockStart: 'auto', padding: 0, display: 'grid', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)', inlineSize: '100%' }}>
      {rows.map((r) => (
        <li key={r.key} style={{ display: 'grid', gridTemplateColumns: '0.5rem minmax(0, 1fr) auto', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
          <span aria-hidden="true" style={{ inlineSize: '0.45rem', blockSize: '0.45rem', borderRadius: '50%', background: DOT[r.dot] }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.text}</span>
          {r.aside && <span style={{ color: 'var(--tp-muted-fg)', whiteSpace: 'nowrap' }}>{r.aside}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Small bars, oldest first, the newest filled solid. Decorative: the dialog holds the figures. */
export function Spark({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  return (
    <span aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--tp-sp-1)', blockSize: '2.25rem', inlineSize: '100%', marginBlockStart: 'auto' }}>
      {values.map((v, i) => {
        const last = i === values.length - 1;
        return (
          <span
            key={i}
            style={{
              flex: 1,
              blockSize: `${Math.max(8, Math.round((v / max) * 100))}%`,
              borderStartStartRadius: '3px',
              borderStartEndRadius: '3px',
              background: last ? 'var(--tp-warn)' : 'var(--tp-warn-soft)',
              borderBlockStart: '2px solid var(--tp-warn)',
            }}
          />
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The bookings dialog's counts
// ---------------------------------------------------------------------------

/** One figure in the dialog's counts row. */
export interface StatItem {
  key: string;
  label: string;
  value: string;
  /** A colour by meaning rather than by place: cancellations red, no-shows amber. */
  tone?: 'danger' | 'warn';
}

/** The counts across the top of a section dialog, one tile per figure, in the owner's four colours by place. */
export function StatRow({ items }: { items: readonly StatItem[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 'var(--tp-sp-2)' }}>
      {items.map((s) => (
        <div key={s.key} className="tp-tone-tile" data-tone={s.tone} style={{ border: '1px solid var(--tp-tone)', borderBlockStart: '6px solid var(--tp-tone)', borderRadius: 'var(--tp-radius-panel)', paddingBlock: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-3)', display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-band-ink, var(--tp-fg))' }}>{s.label}</span>
          <span style={{ fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 'var(--tp-fs-2xl)', lineHeight: 1, color: 'var(--tp-band-ink, var(--tp-fg))' }}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}
