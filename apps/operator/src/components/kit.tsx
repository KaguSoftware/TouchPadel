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
import { formatIQD, formatNumber } from '@touch/i18n';
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
  style,
  'data-testid': testId,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  muted?: boolean;
  padded?: boolean;
  style?: CSSProperties;
  'data-testid'?: string;
}) {
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
          {title && <h2 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700 }}>{title}</h2>}
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
        borderRadius: '4px',
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

export function AsyncStateWrapper({
  status,
  onRetry,
  emptyContent,
  errorContent,
  error,
  skeleton,
  children,
  compact,
}: {
  status: AsyncStatus;
  onRetry?: () => void;
  emptyContent?: ReactNode;
  errorContent?: ReactNode;
  error?: unknown;
  skeleton?: ReactNode;
  children: ReactNode;
  compact?: boolean;
}) {
  const { tr } = useLocale();
  if (status === 'loading') return <>{skeleton ?? <Skeleton lines={compact ? 2 : 5} />}</>;
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
  if (status === 'empty') return <>{emptyContent ?? <EmptyState title={tr('ws.kit.async.empty')} compact={compact} />}</>;
  return <>{children}</>;
}

/** Empty states teach the next action rather than saying "nothing here". */
export function EmptyState({
  icon = 'layers',
  title,
  body,
  action,
  compact,
  style,
}: {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: '0.5rem',
        paddingBlock: compact ? '1.25rem' : '2.5rem',
        paddingInline: '1rem',
        border: '1px dashed var(--tp-border-strong)',
        borderRadius: 'var(--tp-radius-panel)',
        color: 'var(--tp-muted-fg)',
        ...style,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          inlineSize: compact ? '2rem' : '2.75rem',
          blockSize: compact ? '2rem' : '2.75rem',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'var(--tp-surface-2)',
          color: 'var(--tp-accent)',
        }}
      >
        <Icon name={icon} size={compact ? 16 : 22} />
      </span>
      <p style={{ color: 'var(--tp-fg)', fontWeight: 600 }}>{title}</p>
      {body && <p style={{ maxInlineSize: '46ch', fontSize: 'var(--tp-fs-sm)' }}>{body}</p>}
      {action && <div style={{ marginBlockStart: '0.4rem' }}>{action}</div>}
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
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

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
              return (
                <th
                  key={c.key}
                  data-align={align}
                  data-sortable={sortable ? 'true' : undefined}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  style={{ inlineSize: c.width }}
                  onClick={
                    sortable
                      ? () => onSort!({ key: c.key, dir: active && sort!.dir === 'asc' ? 'desc' : 'asc' })
                      : undefined
                  }
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    {c.header}
                    {active && (
                      <Icon
                        name="chevronDown"
                        size={12}
                        label={sort!.dir === 'asc' ? tr('ws.kit.table.sortAsc') : tr('ws.kit.table.sortDesc')}
                        style={{ transform: sort!.dir === 'asc' ? 'rotate(180deg)' : undefined }}
                      />
                    )}
                  </span>
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
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    data-align={c.align ?? (c.numeric ? 'end' : 'start')}
                    style={c.numeric ? { fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums' } : undefined}
                  >
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
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
  if (pageCount <= 1) return null;
  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end', marginBlockStart: '0.6rem', ...style }}>
      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        {tr('ws.kit.table.page', { page, count: pageCount })}
      </span>
      <Button size="sm" icon="chevronStart" aria-label={tr('ws.kit.table.prev')} disabled={page <= 1} onClick={() => onChange(page - 1)} />
      <Button size="sm" icon="chevronEnd" aria-label={tr('ws.kit.table.next')} disabled={page >= pageCount} onClick={() => onChange(page + 1)} />
    </nav>
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
          <dt style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }} dir="ltr">
      {!flat && <Icon name={up ? 'trendUp' : 'trendDown'} size={13} />}
      <span>
        {up ? '+' : ''}
        {fmt(abs)}
      </span>
      {changePct != null && <span style={{ opacity: 0.85 }}>({up ? '+' : ''}{changePct.toFixed(1)}%)</span>}
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

export function MessagePresenter({ message, tone, icon, style }: { message: ReactNode; tone: 'success' | 'refused' | 'error' | 'info'; icon?: IconName; style?: CSSProperties }) {
  const t: Tone = tone === 'success' ? 'success' : tone === 'error' ? 'danger' : tone === 'refused' ? 'warn' : 'info';
  const s = TONE_STYLE[t];
  const ic: IconName = icon ?? (tone === 'success' ? 'checkCircle' : tone === 'error' ? 'alert' : tone === 'refused' ? 'ban' : 'info');
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
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
          paddingInlineEnd: busy || value ? '2.1rem' : undefined,
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
        padding: '2px',
        gap: '2px',
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
              borderRadius: '4px',
              paddingBlock: size === 'sm' ? '0.2rem' : '0.35rem',
              paddingInline: size === 'sm' ? '0.55rem' : '0.8rem',
              fontSize: size === 'sm' ? 'var(--tp-fs-sm)' : 'var(--tp-fs-md)',
              fontWeight: 600,
              background: active ? 'var(--tp-surface)' : 'transparent',
              color: active ? 'var(--tp-fg)' : 'var(--tp-muted-fg)',
              boxShadow: active ? '0 1px 2px oklch(20% 0.03 262 / 0.12)' : undefined,
              cursor: o.disabled ? 'not-allowed' : 'pointer',
              opacity: o.disabled ? 0.5 : 1,
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
          <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
