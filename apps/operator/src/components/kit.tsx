/**
 * Spec §07 presentational components shared by every workspace: async
 * states, tables, status indicators, headline figures, governance prompts,
 * search, pagination, bilingual editing. Pure presentation — permissions
 * arrive as props, money/time/stock arrive formatted or as server figures.
 *
 * Inline styles with logical properties only; interaction states via the
 * class hooks in GlobalStyles.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { formatIQD, formatNumber, formatPercent } from '@touch/i18n';
import { useLocale } from '../lib/i18n';
import type { StaffRole } from '../lib/auth';
import { Button, ErrorText, Field, Modal, REASON_CODES, Select, Skeleton, Spinner, card, inputStyle, type ReasonCode } from './ui';
import { Icon, type IconName } from './icons';
import { BilingualFields } from './inputs';

// ---------------------------------------------------------------------------
// Page structure
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  children,
  style,
}: {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <header
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        marginBlockEnd: '1rem',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ minInlineSize: 0 }}>
          {eyebrow && (
            <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBlockEnd: '0.2rem' }}>
              {eyebrow}
            </p>
          )}
          <h1 style={{ fontSize: 'var(--tp-fs-2xl)', fontWeight: 700 }}>{title}</h1>
          {subtitle && (
            <p style={{ color: 'var(--tp-muted-fg)', marginBlockStart: '0.2rem', maxInlineSize: '70ch' }}>{subtitle}</p>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** A horizontal control strip: filters, view switches, search. */
export function Toolbar({ children, style, end }: { children?: ReactNode; end?: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        flexWrap: 'wrap',
        marginBlockEnd: '0.9rem',
        ...style,
      }}
    >
      {children}
      {end && <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>{end}</div>}
    </div>
  );
}

/** A grouped section with an optional title row. Use sparingly: most content needs no container. */
export function Panel({
  title,
  actions,
  children,
  muted,
  padded = true,
  level = 2,
  style,
  'data-testid': testId,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  muted?: boolean;
  padded?: boolean;
  /**
   * Heading rank. A Panel nested inside another Panel — or inside a section
   * that already owns the h2 — must not emit a second h2 at the same depth,
   * or heading navigation reads the page as a flat list of equals.
   */
  level?: 2 | 3 | 4;
  style?: CSSProperties;
  'data-testid'?: string;
}) {
  const Heading = `h${level}` as 'h2' | 'h3' | 'h4';
  return (
    <section
      data-testid={testId}
      style={{
        background: muted ? 'var(--tp-surface-2)' : 'var(--tp-surface)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-panel)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {(title || actions) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            paddingBlock: '0.6rem',
            paddingInline: '0.85rem',
            borderBlockEnd: '1px solid var(--tp-border)',
          }}
        >
          {title && <Heading style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700 }}>{title}</Heading>}
          {actions && <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>{actions}</div>}
        </div>
      )}
      <div style={padded ? { paddingBlock: '0.75rem', paddingInline: '0.85rem' } : undefined}>{children}</div>
    </section>
  );
}

/** Keyboard hint chip. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: 'inline-block',
        fontFamily: 'var(--tp-font-numeric)',
        fontSize: 'var(--tp-fs-xs)',
        lineHeight: 1,
        paddingBlock: '0.2rem',
        paddingInline: '0.35rem',
        border: '1px solid var(--tp-border-strong)',
        borderBlockEndWidth: '2px',
        borderRadius: 'var(--tp-radius-sm)',
        background: 'var(--tp-surface-2)',
        color: 'var(--tp-muted-fg)',
      }}
    >
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------------------
// Async states (spec R6)
// ---------------------------------------------------------------------------

export type AsyncStatus = 'loading' | 'ready' | 'empty' | 'error';

/** Derive the four-state status from a query and an emptiness predicate. */
export function asyncStatus<T>(q: UseQueryResult<T>, isEmpty: (data: T) => boolean): AsyncStatus {
  if (q.isError && q.data === undefined) return 'error';
  if (q.data === undefined) return 'loading';
  return isEmpty(q.data) ? 'empty' : 'ready';
}

/**
 * Which kind of nothing (rulebook 9.2). "Nothing here yet" told a manager whose
 * filter matched no rows that the system was empty and offered no way back —
 * the sentence a user saw depended on which component won the race, not on what
 * had actually happened.
 */
export type EmptyKind = 'initial' | 'filtered' | 'nothingToDo';

export function AsyncStateWrapper({
  status,
  onRetry,
  emptyContent,
  errorContent,
  error,
  skeleton,
  children,
  compact,
  kind,
  onClearFilters,
}: {
  status: AsyncStatus;
  onRetry?: () => void;
  emptyContent?: ReactNode;
  errorContent?: ReactNode;
  error?: unknown;
  skeleton?: ReactNode;
  children: ReactNode;
  compact?: boolean;
  /** Passed straight to the default EmptyState; ignored when `emptyContent` is given. */
  kind?: EmptyKind;
  /** The way back out of a filter that matched nothing. Only used at kind='filtered'. */
  onClearFilters?: () => void;
}) {
  const { tr } = useLocale();
  if (status === 'loading') {
    return (
      <>
        {/*
          Skeleton is aria-hidden, so between the click and the data a
          screen-reader user got silence. The live region is a SIBLING and not
          a wrapper on purpose: this branch renders straight into whatever grid
          or flex column the caller owns, and .tp-sr-only is absolutely
          positioned, so it announces without claiming a track.
        */}
        <span role="status" className="tp-sr-only">
          {tr('common.loading')}
        </span>
        {skeleton ?? <Skeleton lines={compact ? 2 : 5} />}
      </>
    );
  }
  if (status === 'error') {
    return (
      <div role="alert" style={{ ...card, display: 'grid', gap: '0.5rem', justifyItems: 'start' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--tp-danger-fg)', fontWeight: 600 }}>
          <Icon name="alert" /> {tr('ws.kit.async.error')}
        </div>
        {errorContent ?? (error ? <ErrorText error={error} style={{ marginBlock: 0 }} /> : null)}
        <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.kit.async.offlineHint')}</p>
        {onRetry && (
          <Button icon="refresh" onClick={onRetry}>
            {tr('ws.kit.async.retry')}
          </Button>
        )}
      </div>
    );
  }
  if (status === 'empty')
    return <>{emptyContent ?? <EmptyState kind={kind} onClearFilters={onClearFilters} compact={compact} />}</>;
  return <>{children}</>;
}

const EMPTY_ICON: Record<EmptyKind, IconName> = {
  initial: 'layers',
  filtered: 'search',
  nothingToDo: 'checkCircle',
};

/**
 * Empty states teach the next action rather than saying "nothing here".
 *
 * The grey circle chip this used to draw around the icon is PRODUCT.md's stated
 * anti-reference word for word ("white cards on grey with an icon, a heading and
 * a paragraph each"), and it was the most-seen composition in the product. The
 * icon now sits inline with the title at the title's own optical weight, so it
 * reads as part of the sentence rather than as a decorated placeholder.
 */
export function EmptyState({
  icon,
  title,
  kind = 'initial',
  body,
  action,
  onClearFilters,
  titleAs: Heading = 'h2',
  compact,
  style,
}: {
  icon?: IconName;
  /** Overrides the sentence `kind` would choose. */
  title?: string;
  kind?: EmptyKind;
  body?: ReactNode;
  action?: ReactNode;
  /** Rendered as the primary way out when `kind='filtered'`. */
  onClearFilters?: () => void;
  /** A styled <p> here made heading navigation skip every empty state in the app. */
  titleAs?: 'h2' | 'h3' | 'h4';
  compact?: boolean;
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  const sentence =
    title ??
    (kind === 'filtered'
      ? tr('ws.kit.empty.filtered')
      : kind === 'nothingToDo'
        ? tr('ws.kit.empty.nothingToDo')
        : tr('ws.kit.async.empty'));
  const clear = kind === 'filtered' && onClearFilters ? onClearFilters : undefined;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 'var(--tp-sp-2)',
        paddingBlock: compact ? 'var(--tp-sp-5)' : 'var(--tp-sp-6)',
        paddingInline: 'var(--tp-sp-4)',
        border: '1px dashed var(--tp-border-strong)',
        borderRadius: 'var(--tp-radius-panel)',
        color: 'var(--tp-muted-fg)',
        ...style,
      }}
    >
      <Heading
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--tp-sp-2)',
          color: 'var(--tp-fg)',
          fontSize: compact ? 'var(--tp-fs-md)' : 'var(--tp-fs-lg)',
          fontWeight: 600,
        }}
      >
        <Icon name={icon ?? EMPTY_ICON[kind]} size={compact ? 16 : 18} />
        {sentence}
      </Heading>
      {body && <p style={{ maxInlineSize: '46ch', fontSize: 'var(--tp-fs-sm)' }}>{body}</p>}
      {(action || clear) && (
        <div style={{ marginBlockStart: 'var(--tp-sp-1-5)', display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
          {clear && (
            <Button size="sm" icon="x" onClick={clear}>
              {tr('ws.kit.empty.clearFilters')}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

/** Placeholder for a screen a lane has not built yet; makes the shell navigable meanwhile. */
export function ScreenScaffold({ title, lead }: { title: string; lead?: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <EmptyState icon="spark" title={lead ?? title} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status indicators (spec: seven booking statuses, all handled; labelled, never colour-only)
// ---------------------------------------------------------------------------

export type Tone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info';

const TONE_STYLE: Record<Tone, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: 'var(--tp-neutral-soft)', fg: 'var(--tp-neutral-fg)', dot: 'var(--tp-muted-fg)' },
  accent: { bg: 'var(--tp-accent-soft)', fg: 'var(--tp-accent-soft-fg)', dot: 'var(--tp-accent)' },
  success: { bg: 'var(--tp-success-soft)', fg: 'var(--tp-success-fg)', dot: 'var(--tp-success)' },
  warn: { bg: 'var(--tp-warn-soft)', fg: 'var(--tp-warn-fg)', dot: 'var(--tp-warn)' },
  danger: { bg: 'var(--tp-danger-soft)', fg: 'var(--tp-danger-fg)', dot: 'var(--tp-danger)' },
  info: { bg: 'var(--tp-info-soft)', fg: 'var(--tp-info-fg)', dot: 'var(--tp-accent)' },
};

export function StatusBadge({
  tone = 'neutral',
  label,
  dot = true,
  size = 'md',
  icon,
  style,
  title,
}: {
  tone?: Tone;
  label: string;
  dot?: boolean;
  size?: 'sm' | 'md';
  icon?: IconName;
  style?: CSSProperties;
  title?: string;
}) {
  const t = TONE_STYLE[tone];
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        background: t.bg,
        color: t.fg,
        borderRadius: 'var(--tp-radius-pill)',
        paddingBlock: size === 'sm' ? '0.1rem' : '0.2rem',
        paddingInline: size === 'sm' ? '0.45rem' : '0.6rem',
        fontSize: size === 'sm' ? 'var(--tp-fs-xs)' : 'var(--tp-fs-sm)',
        fontWeight: 600,
        lineHeight: 1.3,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {icon ? (
        <Icon name={icon} size={size === 'sm' ? 12 : 14} />
      ) : dot ? (
        <span aria-hidden="true" style={{ inlineSize: '0.45rem', blockSize: '0.45rem', borderRadius: '50%', background: t.dot }} />
      ) : null}
      {label}
    </span>
  );
}

export type BookingStatus = 'pending' | 'confirmed' | 'arrived' | 'completed' | 'cancelled' | 'no_show' | 'expired';
const BOOKING_TONE: Record<BookingStatus, Tone> = {
  pending: 'warn',
  confirmed: 'accent',
  arrived: 'success',
  completed: 'neutral',
  cancelled: 'danger',
  no_show: 'danger',
  expired: 'neutral',
};
export function BookingStatusIndicator({ status, size }: { status: BookingStatus | string; size?: 'sm' | 'md' }) {
  const { tr } = useLocale();
  const known = (Object.keys(BOOKING_TONE) as BookingStatus[]).includes(status as BookingStatus);
  const s = (known ? status : 'expired') as BookingStatus;
  return <StatusBadge tone={BOOKING_TONE[s]} label={known ? tr(`ws.kit.bookingStatus.${s}`) : status} size={size} />;
}

export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded' | 'unknown';
const PAYMENT_TONE: Record<PaymentStatus, Tone> = { unpaid: 'warn', partial: 'info', paid: 'success', refunded: 'neutral', unknown: 'neutral' };
export function PaymentStatusIndicator({ paymentStatus, size }: { paymentStatus: PaymentStatus; size?: 'sm' | 'md' }) {
  const { tr } = useLocale();
  return <StatusBadge tone={PAYMENT_TONE[paymentStatus]} label={tr(`ws.kit.paymentStatus.${paymentStatus}`)} size={size} icon={paymentStatus === 'paid' ? 'check' : undefined} />;
}

export type TicketState = 'queued' | 'preparing' | 'ready' | 'completed' | 'voided';
const TICKET_TONE: Record<TicketState, Tone> = { queued: 'accent', preparing: 'warn', ready: 'success', completed: 'neutral', voided: 'danger' };
export function TicketStateIndicator({ state, size }: { state: TicketState; size?: 'sm' | 'md' }) {
  const { tr } = useLocale();
  return <StatusBadge tone={TICKET_TONE[state]} label={tr(`ws.kit.ticketState.${state}`)} size={size} />;
}

export type TabStatus = 'open' | 'awaiting_payment' | 'settled' | 'void';
const TAB_TONE: Record<TabStatus, Tone> = { open: 'accent', awaiting_payment: 'warn', settled: 'success', void: 'danger' };
export function TabStatusIndicator({ status, size }: { status: TabStatus | string; size?: 'sm' | 'md' }) {
  const { tr } = useLocale();
  const known = (Object.keys(TAB_TONE) as TabStatus[]).includes(status as TabStatus);
  const s = (known ? status : 'open') as TabStatus;
  return <StatusBadge tone={TAB_TONE[s]} label={known ? tr(`ws.kit.tabStatus.${s}`) : status} size={size} />;
}

export type CustomerFlagType = 'vip' | 'birthday' | 'payment_note' | 'special_request';
const FLAG_META: Record<CustomerFlagType, { tone: Tone; icon: IconName }> = {
  vip: { tone: 'accent', icon: 'star' },
  birthday: { tone: 'success', icon: 'cake' },
  payment_note: { tone: 'warn', icon: 'banknote' },
  special_request: { tone: 'info', icon: 'note' },
};
/** Surfaces wherever a customer appears (spec 06.9). */
export function CustomerFlagBadge({ flag, size = 'sm' }: { flag: { type: CustomerFlagType | string; label?: string | null }; size?: 'sm' | 'md' }) {
  const { tr } = useLocale();
  const known = flag.type in FLAG_META;
  const meta = known ? FLAG_META[flag.type as CustomerFlagType] : { tone: 'neutral' as Tone, icon: 'tag' as IconName };
  const base = known ? tr(`ws.kit.flags.${flag.type as CustomerFlagType}`) : flag.type;
  const label = flag.label ? `${base} · ${flag.label}` : base;
  return <StatusBadge tone={meta.tone} icon={meta.icon} label={label} size={size} title={label} />;
}

// ---------------------------------------------------------------------------
// Data table (the base under stock, audit and reporting screens)
// ---------------------------------------------------------------------------

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  align?: 'start' | 'end' | 'center';
  width?: string;
  sortable?: boolean;
  /** Number-ish columns get tabular numerals and end alignment by default. */
  numeric?: boolean;
  /**
   * The plain text a truncated cell reveals on hover. Needed whenever `render`
   * is set, because the row value behind a rendered column is rarely a string.
   */
  truncateTitle?: (row: T) => string;
  /**
   * Rulebook 6.11. One long guest name used to widen its column until the whole
   * table scrolled sideways, which rule 6.1 forbids at 1366px; the value now
   * ellipsises and reveals in full on hover.
   */
  truncate?: boolean;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

/**
 * Anything inside a cell that owns its own click. Without this guard the row's
 * onClick fired as well, so a manager switching a promotion off also opened the
 * editor — which is exactly why PromotionsList grew a private stopPropagation
 * wrapper. The guard belongs in the primitive so no screen has to fork one.
 */
const CELL_CONTROL = 'button, a, input, select, textarea, label, [role="switch"]';

function fromCellControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CELL_CONTROL) !== null;
}

/**
 * A header that sorts is a control, so it must be tabbable and take the focus
 * ring; it was a bare `<th onClick>`, unreachable by keyboard on every report
 * and every admin list. `aria-sort` stays on the <th>, because the state
 * belongs to the column and not to the button that changes it.
 */
const sortHeaderButton: CSSProperties = {
  // Fills the cell: .tp-table th[data-sortable] already paints cursor:pointer
  // across the whole header, so a small button inside it would advertise a
  // target the operator cannot hit — and the focus ring now frames the column.
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--tp-sp-1)',
  inlineSize: '100%',
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'start',
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  onRowClick,
  selectedKey,
  emptyContent,
  dense,
  maxBlockSize,
  footer,
  'aria-label': ariaLabel,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  sort?: SortState | null;
  onSort?: (next: SortState) => void;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  emptyContent?: ReactNode;
  dense?: boolean;
  /** Scroll inside the table instead of the page. */
  maxBlockSize?: string;
  footer?: ReactNode;
  'aria-label'?: string;
}) {
  const { tr } = useLocale();
  return (
    <div
      style={{
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-panel)',
        overflow: 'auto',
        maxBlockSize,
        background: 'var(--tp-surface)',
      }}
    >
      <table className="tp-table" data-dense={dense ? 'true' : undefined} aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((c) => {
              const align = c.align ?? (c.numeric ? 'end' : 'start');
              const active = sort?.key === c.key;
              const sortable = Boolean(c.sortable && onSort);
              const inner = (
                <>
                  {c.header}
                  {active && (
                    <Icon
                      name="chevronDown"
                      size={12}
                      label={sort!.dir === 'asc' ? tr('ws.kit.table.sortAsc') : tr('ws.kit.table.sortDesc')}
                      style={{ transform: sort!.dir === 'asc' ? 'rotate(180deg)' : undefined }}
                    />
                  )}
                </>
              );
              return (
                <th
                  key={c.key}
                  data-align={align}
                  data-sortable={sortable ? 'true' : undefined}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  style={{ inlineSize: c.width }}
                >
                  {sortable ? (
                    <button
                      type="button"
                      style={{
                        ...sortHeaderButton,
                        justifyContent: align === 'end' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
                      }}
                      onClick={() => onSort!({ key: c.key, dir: active && sort!.dir === 'asc' ? 'desc' : 'asc' })}
                    >
                      {inner}
                    </button>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>{inner}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} style={{ color: 'var(--tp-muted-fg)', textAlign: 'center', paddingBlock: '1.25rem' }}>
                {emptyContent ?? tr('ws.kit.table.noRows')}
              </td>
            </tr>
          )}
          {rows.map((row, i) => {
            const key = rowKey(row, i);
            return (
              <tr
                key={key}
                data-clickable={onRowClick ? 'true' : undefined}
                data-selected={selectedKey === key ? 'true' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={
                  onRowClick
                    ? (e) => {
                        if (fromCellControl(e.target)) return;
                        onRowClick(row);
                      }
                    : undefined
                }
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        // Space on a switch, Enter on a link in a cell: the
                        // control's key, not the row's.
                        if (fromCellControl(e.target)) return;
                        e.preventDefault();
                        onRowClick(row);
                      }
                    : undefined
                }
              >
                {columns.map((c) => {
                  const raw = (row as Record<string, unknown>)[c.key];
                  const content = c.render ? c.render(row) : String(raw ?? '');
                  // A percentage column width would resolve against the cell
                  // rather than the table and clamp far tighter than asked; only
                  // an absolute width can drive the cap, otherwise a measure.
                  const clamp = c.width && !c.width.includes('%') ? c.width : '24ch';
                  return (
                    <td
                      key={c.key}
                      data-align={c.align ?? (c.numeric ? 'end' : 'start')}
                      style={c.numeric ? { fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums' } : undefined}
                    >
                      {c.truncate ? (
                        <span
                          // Prefer the caller's plain text. Every identifying
                          // column in this app is built with a custom `render`,
                          // and for those `raw` is an object or undefined — so
                          // reading it alone clamped the value with no way to
                          // see it, shipping half of rulebook 6.11.
                          title={
                            c.truncateTitle
                              ? c.truncateTitle(row)
                              : typeof raw === 'string' || typeof raw === 'number'
                                ? String(raw)
                                : undefined
                          }
                          style={{
                            // The clamp sits on an inner block, not on the <td>:
                            // an auto table layout treats max-inline-size on a
                            // cell as a hint, and the column widened anyway.
                            display: 'block',
                            maxInlineSize: clamp,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {content}
                        </span>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  onChange,
  style,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  // Rulebook 11.5. This used to return null below two pages, so narrowing a
  // filter to a single page collapsed the footer and pulled the table down
  // under the pointer. The nav keeps its height with both arrows dead instead.
  const count = Math.max(1, pageCount);
  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', marginBlockStart: 'var(--tp-sp-2-5)', ...style }}>
      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
        {tr('ws.kit.table.page', { page: Math.min(page, count), count })}
      </span>
      <Button size="sm" icon="chevronStart" aria-label={tr('ws.kit.table.prev')} disabled={page <= 1} onClick={() => onChange(page - 1)} />
      <Button size="sm" icon="chevronEnd" aria-label={tr('ws.kit.table.next')} disabled={page >= count} onClick={() => onChange(page + 1)} />
    </nav>
  );
}

// ---------------------------------------------------------------------------
// The §6 list primitives every screen was improvising
// ---------------------------------------------------------------------------

export interface RowAction {
  id: string;
  /** Verb + object (rulebook 8.3). Carries the accessible name in both shapes. */
  label: string;
  icon: IconName;
  onSelect: () => void;
  disabled?: boolean;
  /** Rulebook 4.3: a disabled control is never a dead end. */
  disabledReason?: string;
  /** Sorted last inside the overflow menu and separated from the rest (8.4). */
  danger?: boolean;
}

const menuItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--tp-sp-2)',
  inlineSize: '100%',
  minBlockSize: 'var(--tp-touch)',
  paddingBlock: 'var(--tp-sp-2)',
  paddingInline: 'var(--tp-sp-3)',
  background: 'none',
  border: 'none',
  font: 'inherit',
  textAlign: 'start',
  whiteSpace: 'nowrap',
};

/**
 * Rulebook 6.4: up to two row actions are inline icon buttons; three or more
 * collapse into one overflow menu whose position never varies. The menu's
 * contents may differ by role, its anchor may not — so the operator's hand
 * learns one target per table rather than one per row shape.
 *
 * Presentational only: the caller owns every piece of state behind `actions`.
 * `icon="more"` has existed in icons.tsx since day one and had zero call sites,
 * which is why rule 6.4 was unsatisfiable by any screen in the app.
 */
export function RowActions({
  actions,
  label,
  style,
}: {
  actions: readonly RowAction[];
  /** The row's own name, so the overflow trigger is not the forty-first "More". */
  label?: string;
  style?: CSSProperties;
}) {
  const { tr, dir } = useLocale();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ inlineEnd: number; blockStart: number } | null>(null);

  function dismiss() {
    setMenu(null);
    anchorRef.current?.querySelector('button')?.focus();
  }

  function openMenu() {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    // `position: fixed`, because the table's own scroll container would clip an
    // absolutely-positioned menu. Logical insets against the viewport mirror
    // for free: in Arabic inset-inline-end resolves to the left edge, so the
    // one arithmetic below is direction-correct with a single sign flip.
    setMenu({
      inlineEnd: dir === 'rtl' ? rect.left : window.innerWidth - rect.right,
      blockStart: rect.bottom,
    });
  }

  useEffect(() => {
    if (!menu) return;
    // The anchor rect is measured once; a scroll would leave the menu hovering
    // over a different row, so movement dismisses rather than chases.
    const close = () => setMenu(null);
    const onPointerDown = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !anchorRef.current?.contains(t)) close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [menu]);

  useEffect(() => {
    if (menu) menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, [menu]);

  if (actions.length === 0) return null;

  const container: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 'var(--tp-sp-1)',
    ...style,
  };

  if (actions.length <= 2) {
    return (
      <div role="group" aria-label={tr('ws.kit.table.rowActions')} style={container}>
        {actions.map((a) => (
          <Button
            key={a.id}
            size="sm"
            // Ghost even when destructive: a solid red button repeated down
            // every row would put one "primary" per record on the screen, and
            // rule 8.1 allows exactly one. The hue carries it at row level.
            kind="ghost"
            icon={a.icon}
            aria-label={a.label}
            title={a.disabled && a.disabledReason ? a.disabledReason : a.label}
            disabled={a.disabled}
            onClick={a.onSelect}
            style={a.danger ? { color: 'var(--tp-danger-fg)' } : undefined}
          />
        ))}
      </div>
    );
  }

  // Stable sort: destructive last, the order the caller gave otherwise.
  const ordered = [...actions].sort((a, b) => Number(a.danger ?? false) - Number(b.danger ?? false));

  return (
    <div role="group" aria-label={tr('ws.kit.table.rowActions')} style={container}>
      <span ref={anchorRef} style={{ display: 'inline-flex' }}>
        <Button
          size="sm"
          kind="ghost"
          icon="more"
          // Verb + object (rulebook 8.3). Without `label`, a screen-reader
          // user in a 40-row table hears forty buttons called "More".
          aria-label={label ? tr('ws.kit.table.rowActionsFor', { name: label }) : tr('ws.kit.actions.more')}
          title={tr('ws.kit.actions.more')}
          onClick={() => (menu ? dismiss() : openMenu())}
        />
      </span>
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={tr('ws.kit.table.rowActions')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              dismiss();
              return;
            }
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
            if (items.length === 0) return;
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
            items[next]?.focus();
          }}
          style={{
            position: 'fixed',
            insetInlineEnd: `${menu.inlineEnd}px`,
            insetBlockStart: `${menu.blockStart}px`,
            marginBlockStart: 'var(--tp-sp-1)',
            zIndex: 'var(--tp-z-popover)',
            display: 'grid',
            minInlineSize: '11rem',
            background: 'var(--tp-surface)',
            border: '1px solid var(--tp-border)',
            borderRadius: 'var(--tp-radius-ctl)',
            boxShadow: 'var(--tp-shadow-popover)',
            paddingBlock: 'var(--tp-sp-1)',
          }}
        >
          {ordered.map((a, i) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              className="tp-row"
              data-clickable={a.disabled ? undefined : 'true'}
              disabled={a.disabled}
              title={a.disabled ? a.disabledReason : undefined}
              onClick={() => {
                dismiss();
                a.onSelect();
              }}
              style={{
                ...menuItemStyle,
                color: a.danger ? 'var(--tp-danger-fg)' : 'var(--tp-fg)',
                borderBlockStart: a.danger && i > 0 && !ordered[i - 1]?.danger ? '1px solid var(--tp-border)' : undefined,
                opacity: a.disabled ? 'var(--tp-opacity-disabled)' : undefined,
                cursor: a.disabled ? 'not-allowed' : 'pointer',
              }}
            >
              <Icon name={a.icon} size={16} />
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface FilterChip {
  id: string;
  /** What the chip shows. May be a node (a badge, a bidi-isolated name). */
  label: ReactNode;
  /** The same filter as plain text, for the remove button's accessible name. */
  text: string;
  onRemove: () => void;
}

/**
 * Rulebook 6.6: an active filter is visible and removable where the results
 * are, not only inside the control that set it. The array is the caller's —
 * this decides nothing about what a filter means.
 */
export function FilterChips({
  chips,
  onClearAll,
  style,
}: {
  chips: readonly FilterChip[];
  onClearAll?: () => void;
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  if (chips.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={tr('ws.kit.filters.active')}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', ...style }}
    >
      {chips.map((c) => (
        <span
          key={c.id}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-1)',
            background: 'var(--tp-accent-soft)',
            color: 'var(--tp-accent-soft-fg)',
            borderRadius: 'var(--tp-radius-pill)',
            paddingBlock: 'var(--tp-sp-0)',
            paddingInlineStart: 'var(--tp-sp-2-5)',
            paddingInlineEnd: 'var(--tp-sp-1)',
            fontSize: 'var(--tp-fs-sm)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {c.label}
          <Button
            kind="ghost"
            size="sm"
            icon="x"
            // `text`, never the id: a chip whose label is a ReactNode used to
            // announce an internal identifier as user-facing copy, untranslated
            // in both locales.
            aria-label={tr('ws.kit.filters.remove', { label: c.text })}
            onClick={c.onRemove}
            style={{
              // The sm button keeps its own 1.85rem floor. Overriding it left a
              // ~14px target, under WCAG 2.2's 24px and far under --tp-touch.
              inlineSize: 'auto',
              paddingBlock: 0,
              paddingInline: 'var(--tp-sp-1)',
              background: 'none',
              border: 'none',
              color: 'inherit',
            }}
          />
        </span>
      ))}
      {onClearAll && (
        <Button kind="ghost" size="sm" onClick={onClearAll}>
          {tr('ws.kit.filters.clearAll')}
        </Button>
      )}
    </div>
  );
}

/**
 * Rulebook 6.10: the count belongs at the top, beside the title, not only in
 * the pagination footer. Wraps `ws.kit.table.rowsOf`, which was in the catalog
 * with no consumer, and routes both figures through the shared formatter so
 * Arabic does not get one grouped number and one bare one.
 */
export function ResultCount({ shown, total, style }: { shown: number; total: number; style?: CSSProperties }) {
  const { tr, locale } = useLocale();
  return (
    <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums', ...style }}>
      {tr('ws.kit.table.rowsOf', { shown: formatNumber(shown, locale), total: formatNumber(total, locale) })}
    </span>
  );
}

/**
 * Rulebook 9.1: a skeleton matches the layout it replaces, so nothing moves
 * when the rows arrive. Built from the same `Column[]` the caller already hands
 * DataTable, which is what keeps the two in step. Announcement is the caller's
 * job — AsyncStateWrapper's loading branch owns the live region.
 */
export function TableSkeleton<T>({
  columns,
  rows = 5,
  dense,
  maxBlockSize,
  style,
}: {
  columns: readonly Column<T>[];
  rows?: number;
  dense?: boolean;
  maxBlockSize?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-panel)',
        overflow: 'hidden',
        maxBlockSize,
        background: 'var(--tp-surface)',
        ...style,
      }}
    >
      <table className="tp-table" data-dense={dense ? 'true' : undefined}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} data-align={c.align ?? (c.numeric ? 'end' : 'start')} style={{ inlineSize: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.max(1, rows) }, (_, r) => (
            <tr key={r}>
              {columns.map((c) => {
                const toEnd = (c.align ?? (c.numeric ? 'end' : 'start')) === 'end';
                return (
                  <td key={c.key}>
                    <span
                      className="tp-skel"
                      style={{
                        display: 'block',
                        // As tall as the line it stands in for, so the row
                        // height is the real one before the data lands.
                        blockSize: 'var(--tp-fs-md)',
                        inlineSize: c.numeric ? '45%' : r % 3 === 0 ? '80%' : '60%',
                        borderRadius: 'var(--tp-radius-sm)',
                        marginInlineStart: toEnd ? 'auto' : undefined,
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Key/value rows for a record's summary. */
export function DescriptionList({
  items,
  columns = 1,
  style,
}: {
  items: readonly { label: ReactNode; value: ReactNode; numeric?: boolean }[];
  columns?: 1 | 2 | 3;
  style?: CSSProperties;
}) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: '0.6rem 1.25rem',
        margin: 0,
        ...style,
      }}
    >
      {items.map((it, i) => (
        <div key={i} style={{ minInlineSize: 0 }}>
          {/* Was 12px all-caps with tracking, the worst case for arm's-length
              reading; rulebook 6.2 wants this to read as the same words as the
              table header above it. Weight and colour carry it instead. */}
          <dt style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>
            {it.label}
          </dt>
          <dd style={{ margin: 0, fontVariantNumeric: it.numeric ? 'tabular-nums' : undefined, overflowWrap: 'anywhere' }}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Reporting (spec §07 Reporting)
// ---------------------------------------------------------------------------

export interface Comparison {
  previous?: number | null;
  changeAbs?: number | null;
  changePct?: number | null;
  label?: string;
}

/** Renders both the absolute change and the percentage; sign carried by an icon and text, not colour alone. */
export function ComparisonDelta({
  changeAbs,
  changePct,
  format,
  invert,
}: {
  changeAbs: number | null | undefined;
  changePct: number | null | undefined;
  format?: (n: number) => string;
  /** For figures where a rise is bad (waste, refunds). */
  invert?: boolean;
}) {
  const { tr, locale } = useLocale();
  if (changeAbs == null && changePct == null) {
    return <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.kit.comparison.noPrevious')}</span>;
  }
  const abs = changeAbs ?? 0;
  const up = abs > 0;
  const flat = abs === 0;
  const good = flat ? null : invert ? !up : up;
  const color = flat ? 'var(--tp-muted-fg)' : good ? 'var(--tp-success-fg)' : 'var(--tp-danger-fg)';
  const fmt = format ?? ((n: number) => formatNumber(n, locale));
  // The absolute change went through the shared formatter and the percentage
  // through toFixed + a literal '%', so one number on the line was localised
  // and the other was not — in Arabic, grouped digits beside ungrouped ones and
  // a Latin percent sign. The rounding is display rounding, nothing is computed.
  // formatPercent, not formatNumber: Intl's 0-3 default made the precision
  // value-dependent, so a KPI column printed 25%, 12.3%, 0% with ragged
  // decimals where it used to align. One decimal, always, in one place.
  const pct =
    changePct == null
      ? null
      : `${up ? '+' : ''}${formatPercent(changePct, locale)}${tr('ws.kit.common.percent')}`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }} dir="ltr">
      {!flat && <Icon name={up ? 'trendUp' : 'trendDown'} size={13} />}
      <span>
        {up ? '+' : ''}
        {fmt(abs)}
      </span>
      {pct && <span style={{ opacity: 0.85 }}>({pct})</span>}
    </span>
  );
}

export function HeadlineFigure({
  label,
  value,
  comparison,
  drillable,
  onDrill,
  hint,
  tone = 'neutral',
  format,
  invert,
  busy,
}: {
  label: string;
  value: ReactNode;
  comparison?: Comparison | null;
  drillable?: boolean;
  onDrill?: () => void;
  hint?: ReactNode;
  tone?: Tone;
  format?: (n: number) => string;
  invert?: boolean;
  busy?: boolean;
}) {
  const { tr } = useLocale();
  const clickable = Boolean(drillable && onDrill && !busy);
  const inner = (
    <>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        {clickable && <Icon name="arrowUpRight" size={14} style={{ color: 'var(--tp-muted-fg)' }} />}
      </span>
      <span
        style={{
          display: 'block',
          fontSize: 'var(--tp-fs-2xl)',
          fontWeight: 700,
          lineHeight: 1.15,
          fontVariantNumeric: 'tabular-nums',
          color: tone === 'danger' ? 'var(--tp-danger-fg)' : tone === 'warn' ? 'var(--tp-warn-fg)' : 'var(--tp-fg)',
          marginBlockStart: '0.3rem',
        }}
      >
        {busy ? <Skeleton lines={1} blockSize="1.6rem" style={{ inlineSize: '60%' }} /> : value}
      </span>
      <span style={{ display: 'block', marginBlockStart: '0.3rem', minBlockSize: '1rem' }}>
        {comparison ? (
          <ComparisonDelta changeAbs={comparison.changeAbs} changePct={comparison.changePct} format={format} invert={invert} />
        ) : hint ? (
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{hint}</span>
        ) : null}
      </span>
    </>
  );
  const base: CSSProperties = {
    ...card,
    display: 'block',
    textAlign: 'start',
    inlineSize: '100%',
    minInlineSize: 0,
  };
  return clickable ? (
    <button type="button" className="tp-tile" onClick={onDrill} style={base} title={tr('ws.kit.drill.title')}>
      {inner}
    </button>
  ) : (
    <div style={base}>{inner}</div>
  );
}

export type ComparisonMode = 'previousPeriod' | 'sameLastYear' | 'none';
export function ComparisonControl({ mode, onChange, disabled }: { mode: ComparisonMode; onChange: (m: ComparisonMode) => void; disabled?: boolean }) {
  const { tr } = useLocale();
  return (
    <Select<ComparisonMode>
      value={mode}
      onChange={onChange}
      disabled={disabled}
      aria-label={tr('ws.kit.comparison.vs', { label: '' })}
      style={{ inlineSize: 'auto' }}
      options={[
        { value: 'none', label: tr('ws.kit.comparison.none') },
        { value: 'previousPeriod', label: tr('ws.kit.comparison.previousPeriod') },
        { value: 'sameLastYear', label: tr('ws.kit.comparison.sameLastYear') },
      ]}
    />
  );
}

export interface Period {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD inclusive
}
export type PeriodPreset = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'last30' | 'custom';

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Presets resolved on the station clock; the server re-anchors to the venue's business day. */
export function presetPeriod(preset: Exclude<PeriodPreset, 'custom'>, now = new Date()): Period {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 86_400_000;
  const dow = (d.getDay() + 7) % 7; // 0 = Sunday
  switch (preset) {
    case 'today':
      return { from: isoDate(d), to: isoDate(d) };
    case 'yesterday': {
      const y = new Date(d.getTime() - day);
      return { from: isoDate(y), to: isoDate(y) };
    }
    case 'thisWeek': {
      const start = new Date(d.getTime() - dow * day);
      return { from: isoDate(start), to: isoDate(d) };
    }
    case 'lastWeek': {
      const start = new Date(d.getTime() - (dow + 7) * day);
      const end = new Date(start.getTime() + 6 * day);
      return { from: isoDate(start), to: isoDate(end) };
    }
    case 'thisMonth':
      return { from: isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), to: isoDate(d) };
    case 'lastMonth': {
      const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const end = new Date(d.getFullYear(), d.getMonth(), 0);
      return { from: isoDate(start), to: isoDate(end) };
    }
    case 'last30':
      return { from: isoDate(new Date(d.getTime() - 29 * day)), to: isoDate(d) };
  }
}

export function DateRangeControl({
  period,
  onChange,
  presets = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'last30'],
  disabled,
}: {
  period: Period;
  onChange: (p: Period) => void;
  presets?: readonly Exclude<PeriodPreset, 'custom'>[];
  disabled?: boolean;
}) {
  const { tr } = useLocale();
  const [draft, setDraft] = useState<Period>(period);
  useEffect(() => setDraft(period), [period]);
  const active = useMemo(() => presets.find((p) => {
    const pp = presetPeriod(p);
    return pp.from === period.from && pp.to === period.to;
  }), [presets, period]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }} role="group">
      {presets.map((p) => (
        <Button key={p} size="sm" aria-pressed={active === p} disabled={disabled} onClick={() => onChange(presetPeriod(p))}>
          {tr(`ws.kit.dateRange.${p}`)}
        </Button>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginInlineStart: '0.4rem' }}>
        <input
          type="date"
          aria-label={tr('ws.kit.dateRange.from')}
          value={draft.from}
          disabled={disabled}
          onChange={(e) => e.target.value && setDraft((d) => ({ ...d, from: e.target.value }))}
          style={{ ...inputStyle, inlineSize: 'auto', minBlockSize: '1.85rem', paddingBlock: '0.2rem' }}
        />
        <span style={{ color: 'var(--tp-muted-fg)' }}>–</span>
        <input
          type="date"
          aria-label={tr('ws.kit.dateRange.to')}
          value={draft.to}
          disabled={disabled}
          onChange={(e) => e.target.value && setDraft((d) => ({ ...d, to: e.target.value }))}
          style={{ ...inputStyle, inlineSize: 'auto', minBlockSize: '1.85rem', paddingBlock: '0.2rem' }}
        />
        {(draft.from !== period.from || draft.to !== period.to) && (
          <Button size="sm" kind="soft" disabled={disabled || draft.from > draft.to} onClick={() => onChange(draft)}>
            {tr('ws.kit.dateRange.apply')}
          </Button>
        )}
      </span>
    </div>
  );
}

export function ExportButton({ busy, onExport, scope, disabled }: { busy?: boolean; onExport: () => void; scope?: string; disabled?: boolean }) {
  const { tr } = useLocale();
  return (
    <Button icon="fileText" busy={busy} disabled={disabled} onClick={onExport} title={scope ?? tr('ws.kit.export.scope')}>
      {busy ? tr('ws.kit.export.exporting') : tr('ws.kit.export.csv')}
    </Button>
  );
}

/** The individual transactions behind a figure (spec: DrillThroughPanel). */
export function DrillThroughPanel<T>({
  title,
  status,
  transactions,
  columns,
  rowKey,
  onClose,
  onRetry,
  error,
}: {
  title?: string;
  status: AsyncStatus;
  transactions: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T, i: number) => string;
  onClose: () => void;
  onRetry?: () => void;
  error?: unknown;
}) {
  const { tr } = useLocale();
  return (
    <Modal title={title ?? tr('ws.kit.drill.title')} onClose={onClose} size="lg" footer={<Button onClick={onClose}>{tr('ws.kit.drill.close')}</Button>}>
      <AsyncStateWrapper
        status={status}
        onRetry={onRetry}
        error={error}
        emptyContent={<EmptyState compact icon="receipt" title={tr('ws.kit.drill.empty')} />}
      >
        <DataTable columns={columns} rows={transactions} rowKey={rowKey} dense maxBlockSize="60vh" />
      </AsyncStateWrapper>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Governance (spec R7/R8/R9)
// ---------------------------------------------------------------------------

/** Presentation only; the PIN is verified server-side by the caller's RPC. */
export function PinPromptOverlay({
  action,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  action: string;
  busy?: boolean;
  error?: unknown;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const { tr } = useLocale();
  const [pin, setPin] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (error != null) setPin('');
  }, [error]);
  return (
    <Modal
      title={tr('ws.kit.pin.title')}
      subtitle={tr('ws.kit.pin.lead', { action })}
      onClose={busy ? () => {} : onCancel}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {tr('ws.kit.pin.cancel')}
          </Button>
          <Button kind="primary" busy={busy} disabled={pin.length < 4} onClick={() => onSubmit(pin)} icon="lock">
            {tr('ws.kit.pin.confirm')}
          </Button>
        </>
      }
    >
      <Field label={tr('ws.kit.pin.pin')}>
        <input
          ref={ref}
          style={{ ...inputStyle, fontSize: 'var(--tp-fs-2xl)', letterSpacing: '0.35em', textAlign: 'center' }}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          dir="ltr"
          value={pin}
          maxLength={6}
          disabled={busy}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && pin.length >= 4 && !busy && onSubmit(pin)}
        />
      </Field>
      <ErrorText error={error} />
    </Modal>
  );
}

/** Mandatory on discounts, voids, price overrides, stock adjustments and reservation overrides. */
export function ReasonCodePrompt({
  action,
  reasonCodes = REASON_CODES,
  busy,
  error,
  withNote = true,
  onSubmit,
  onCancel,
  children,
}: {
  action: string;
  reasonCodes?: readonly ReasonCode[];
  busy?: boolean;
  error?: unknown;
  withNote?: boolean;
  onSubmit: (code: ReasonCode, note: string) => void;
  onCancel: () => void;
  /** Consequence copy rendered above the reason picker (e.g. "recorded as waste"). */
  children?: ReactNode;
}) {
  const { tr } = useLocale();
  const [code, setCode] = useState<ReasonCode>(reasonCodes[0] ?? 'other');
  const [note, setNote] = useState('');
  const id = useId();
  return (
    <Modal
      title={tr('ws.kit.reason.title')}
      subtitle={tr('ws.kit.reason.lead', { action })}
      onClose={busy ? () => {} : onCancel}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {tr('ws.kit.reason.cancel')}
          </Button>
          <Button kind="primary" busy={busy} onClick={() => onSubmit(code, note.trim())}>
            {tr('ws.kit.reason.confirm')}
          </Button>
        </>
      }
    >
      {children}
      <div role="radiogroup" aria-labelledby={`${id}-label`} style={{ display: 'grid', gap: '0.3rem', marginBlockEnd: '0.85rem' }}>
        <span id={`${id}-label`} style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
          {tr('ws.kit.reason.code')}
        </span>
        {reasonCodes.map((r) => (
          <label
            key={r}
            className="tp-row"
            data-clickable="true"
            data-selected={code === r ? 'true' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBlock: '0.35rem', paddingInline: '0.5rem', borderRadius: 'var(--tp-radius-ctl)', cursor: 'pointer' }}
          >
            <input type="radio" name={`${id}-reason`} value={r} checked={code === r} disabled={busy} onChange={() => setCode(r)} />
            {tr(`op.reasons.${r}`)}
          </label>
        ))}
      </div>
      {withNote && (
        <Field label={tr('ws.kit.reason.note')}>
          <input style={inputStyle} value={note} disabled={busy} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
      <ErrorText error={error} />
    </Modal>
  );
}

/** A refused action stays present and states its reason (spec R9). */
export function PermissionRefusedNotice({ action, requiredRole, style }: { action: string; requiredRole: StaffRole; style?: CSSProperties }) {
  const { tr } = useLocale();
  const role = tr(`op.roles.${requiredRole}`);
  return (
    <div
      role="note"
      style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'flex-start',
        background: 'var(--tp-neutral-soft)',
        color: 'var(--tp-neutral-fg)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-ctl)',
        paddingBlock: '0.5rem',
        paddingInline: '0.7rem',
        fontSize: 'var(--tp-fs-sm)',
        ...style,
      }}
    >
      <Icon name="shield" size={16} style={{ marginBlockStart: '0.1rem', flexShrink: 0 }} />
      <span>
        <strong>{tr('ws.kit.refused.title')}</strong> — {tr('ws.kit.refused.body', { action, role })}
      </span>
    </div>
  );
}

export type MessageTone = 'success' | 'refused' | 'error' | 'info';

/**
 * The four message tones in one table. Exported so toast.tsx can stop keeping a
 * private copy — two vocabularies for "this worked" put the marketing green and
 * the semantic green on one screen at the same time.
 */
export const MESSAGE_TONE: Record<MessageTone, { tone: Tone; icon: IconName }> = {
  success: { tone: 'success', icon: 'checkCircle' },
  refused: { tone: 'warn', icon: 'ban' },
  error: { tone: 'danger', icon: 'alert' },
  info: { tone: 'info', icon: 'info' },
};

export function MessagePresenter({ message, tone, icon, rise, style }: { message: ReactNode; tone: MessageTone; icon?: IconName; /** Settle in on mount. Only for a message that ARRIVED unprompted — never for static copy or a direct answer to a click. */ rise?: boolean; style?: CSSProperties }) {
  const meta = MESSAGE_TONE[tone];
  const s = TONE_STYLE[meta.tone];
  const ic: IconName = icon ?? meta.icon;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      // Opt-in, NOT default. Roughly thirty of this component's call sites are
      // static explanatory copy that is part of the page's first paint, or a
      // direct answer to the operator's own click — and motion is reserved for
      // what the SERVER did while they were looking somewhere else. Putting the
      // class in the primitive also made the trigger uninspectable from the
      // call site. Pass `rise` only where the message genuinely arrives
      // unprompted: a refusal, a conflict, a queued write coming back.
      className={rise ? 'tp-rise' : undefined}
      style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'flex-start',
        background: s.bg,
        color: s.fg,
        borderRadius: 'var(--tp-radius-ctl)',
        paddingBlock: '0.5rem',
        paddingInline: '0.7rem',
        fontSize: 'var(--tp-fs-sm)',
        ...style,
      }}
    >
      <Icon name={ic} size={16} style={{ marginBlockStart: '0.1rem', flexShrink: 0 }} />
      <span>{message}</span>
    </div>
  );
}

/** A rejected write, not a warning. */
export function ConflictNotice({ body, onResolve, resolveLabel, children, style }: { body?: ReactNode; onResolve?: () => void; resolveLabel?: string; children?: ReactNode; style?: CSSProperties }) {
  const { tr } = useLocale();
  return (
    <div
      role="alert"
      style={{
        border: '1px solid var(--tp-danger)',
        background: 'var(--tp-danger-soft)',
        color: 'var(--tp-danger-fg)',
        borderRadius: 'var(--tp-radius-panel)',
        paddingBlock: '0.7rem',
        paddingInline: '0.85rem',
        display: 'grid',
        gap: '0.5rem',
        ...style,
      }}
    >
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 700 }}>
        <Icon name="ban" size={18} /> {tr('ws.kit.conflict.title')}
      </div>
      <p style={{ fontSize: 'var(--tp-fs-sm)' }}>{body ?? tr('ws.kit.conflict.body')}</p>
      {children}
      {onResolve && (
        <div>
          <Button size="sm" onClick={onResolve}>
            {resolveLabel ?? tr('ws.kit.conflict.dismiss')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search, segmented controls
// ---------------------------------------------------------------------------

export function SearchField({
  value,
  onChange,
  placeholder,
  busy,
  autoFocus,
  inputRef,
  style,
  size = 'md',
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  busy?: boolean;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  style?: CSSProperties;
  size?: 'md' | 'lg';
  'aria-label'?: string;
}) {
  const { tr } = useLocale();
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', inlineSize: '100%', ...style }}>
      <Icon name="search" size={16} style={{ position: 'absolute', insetInlineStart: '0.65rem', color: 'var(--tp-muted-fg)', pointerEvents: 'none' }} />
      <input
        ref={inputRef}
        type="search"
        role="searchbox"
        aria-label={ariaLabel ?? placeholder ?? tr('ws.kit.search.placeholder')}
        autoFocus={autoFocus}
        placeholder={placeholder ?? tr('ws.kit.search.placeholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation();
            onChange('');
          }
        }}
        style={{
          ...inputStyle,
          paddingInlineStart: '2.1rem',
          // Reserved unconditionally: it used to appear with the first
          // character typed, shifting the text out from under the cursor.
          paddingInlineEnd: '2.1rem',
          minBlockSize: size === 'lg' ? '2.75rem' : undefined,
          fontSize: size === 'lg' ? 'var(--tp-fs-lg)' : undefined,
        }}
      />
      <span style={{ position: 'absolute', insetInlineEnd: '0.4rem', display: 'inline-flex', alignItems: 'center' }}>
        {busy ? (
          <Spinner size="xs" />
        ) : value ? (
          <Button kind="ghost" size="sm" icon="x" aria-label={tr('ws.kit.search.clear')} onClick={() => onChange('')} />
        ) : null}
      </span>
    </span>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  'aria-label': ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: ReactNode; icon?: IconName; disabled?: boolean }[];
  size?: 'sm' | 'md';
  'aria-label'?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        background: 'var(--tp-surface-2)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-ctl)',
        padding: 'var(--tp-sp-0)',
        gap: 'var(--tp-sp-0)',
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              border: 'none',
              borderRadius: 'var(--tp-radius-sm)',
              paddingBlock: size === 'sm' ? '0.2rem' : '0.35rem',
              paddingInline: size === 'sm' ? '0.55rem' : '0.8rem',
              fontSize: size === 'sm' ? 'var(--tp-fs-sm)' : 'var(--tp-fs-md)',
              fontWeight: 600,
              background: active ? 'var(--tp-surface)' : 'transparent',
              color: active ? 'var(--tp-fg)' : 'var(--tp-muted-fg)',
              boxShadow: active ? 'var(--tp-shadow-raised)' : undefined,
              cursor: o.disabled ? 'not-allowed' : 'pointer',
              opacity: o.disabled ? 'var(--tp-opacity-disabled)' : 1,
              transition: 'background var(--tp-dur-fast) var(--tp-ease-out), color var(--tp-dur-fast) var(--tp-ease-out)',
              whiteSpace: 'nowrap',
            }}
          >
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money helpers for display (formatting only; no arithmetic)
// ---------------------------------------------------------------------------

export function Money({ amount, style, strong }: { amount: number | null | undefined; style?: CSSProperties; strong?: boolean }) {
  const { locale } = useLocale();
  if (amount == null) return <span style={{ color: 'var(--tp-muted-fg)', ...style }}>—</span>;
  return (
    <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--tp-font-numeric)', fontWeight: strong ? 700 : undefined, ...style }}>
      {formatIQD(amount, locale)}
    </span>
  );
}

/** Change-due readout: server figures in, nothing computed here. */
export function ChangeDueDisplay({ due, tendered, change, short }: { due: number; tendered: number | null; change: number | null; short?: number | null }) {
  const { tr } = useLocale();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem' }}>
      {[
        { label: tr('ws.kit.change.due'), value: due, tone: 'neutral' as Tone },
        { label: tr('ws.kit.change.tendered'), value: tendered, tone: 'neutral' as Tone },
        { label: tr('ws.kit.change.change'), value: change, tone: (change ?? 0) > 0 ? ('success' as Tone) : ('neutral' as Tone) },
      ].map((cell) => (
        <div key={cell.label} style={{ ...card, background: TONE_STYLE[cell.tone].bg, borderColor: 'transparent', textAlign: 'center' }}>
          <span style={{ display: 'block', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>
            {cell.label}
          </span>
          <span style={{ display: 'block', fontSize: 'var(--tp-fs-2xl)', fontWeight: 700, color: TONE_STYLE[cell.tone].fg }}>
            <Money amount={cell.value} />
          </span>
        </div>
      ))}
      {short != null && short > 0 && (
        <div style={{ gridColumn: '1 / -1' }}>
          <MessagePresenter tone="refused" message={<>{tr('ws.kit.change.short', { amount: '' })}<Money amount={short} /></>} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bilingual editing (spec R5)
// ---------------------------------------------------------------------------

export interface Bilingual {
  en: string;
  ar: string;
}

/** The only route for editing a bilingual record. */
export function BilingualFieldPair({
  label,
  value,
  onChange,
  error,
  multiline,
  maxLength,
  disabled,
  required,
}: {
  label: string;
  value: Bilingual;
  onChange: (next: Bilingual) => void;
  error?: ReactNode;
  multiline?: boolean;
  maxLength?: number;
  disabled?: boolean;
  required?: boolean;
}) {
  const { tr } = useLocale();
  return (
    <div style={{ marginBlockEnd: '0.5rem' }}>
      <span
        className={required ? 'tp-req' : undefined}
        style={{ display: 'block', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, marginBlockEnd: '0.3rem' }}
      >
        {label}
      </span>
      <BilingualFields
        labelEn={tr('ws.kit.bilingual.en')}
        labelAr={tr('ws.kit.bilingual.ar')}
        en={value.en}
        ar={value.ar}
        onEn={(en) => onChange({ ...value, en })}
        onAr={(ar) => onChange({ ...value, ar })}
        multiline={multiline}
        maxLength={maxLength}
        disabled={disabled}
      />
      {error && (
        <span role="alert" style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-danger-fg)' }}>
          {error}
        </span>
      )}
    </div>
  );
}

/** Picks the active language and falls back to the other when empty. */
export function LocalizedRecordText({ record, style }: { record: { en?: string | null; ar?: string | null } | null | undefined; style?: CSSProperties }) {
  const { locale } = useLocale();
  if (!record) return null;
  const primary = locale === 'ar' ? record.ar : record.en;
  const fallback = locale === 'ar' ? record.en : record.ar;
  const text = primary && primary.trim() ? primary : (fallback ?? '');
  const usedFallback = !(primary && primary.trim()) && Boolean(fallback && fallback.trim());
  return (
    <span dir={usedFallback ? (locale === 'ar' ? 'ltr' : 'rtl') : undefined} style={{ unicodeBidi: 'isolate', ...style }}>
      {text}
    </span>
  );
}

/** Mixed-direction text: each part isolated so numbers and Latin codes keep their order in Arabic. */
export function BidirectionalTextRenderer({ parts, separator = ' · ', style }: { parts: readonly (string | number | ReactNode)[]; separator?: string; style?: CSSProperties }) {
  return (
    <span style={style}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true">{separator}</span>}
          <bdi>{p}</bdi>
        </span>
      ))}
    </span>
  );
}
