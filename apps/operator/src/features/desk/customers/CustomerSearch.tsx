/**
 * 06.8 CustomerSearchScreen — one big search box, results as you type
 * (200 ms debounce, customer_search). Matching tolerance is server-side; we
 * render what comes back, flags and counts included.
 * States: idle · searching · ready · empty (offers create) · error.
 *
 * Attach mode (`?attach=booking&reservation=<id>` / `?attach=tab&tab=<id>`):
 * no reservation RPC accepts a guest id after creation, so "Attach" hands the
 * chosen customer back to the caller in the URL (`?customer=<id>`) and the
 * caller decides what it can do with it. The booking screen currently states
 * that attaching is not available; the till lane owns the tab side.
 */
import { useRef, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { Button, Skeleton } from '../../../components/ui';
import { AsyncStateWrapper, CustomerFlagBadge, EmptyState, MessagePresenter, PageHeader, SearchField, type AsyncStatus } from '../../../components/kit';
import { Icon } from '../../../components/icons';
import type { CustomerSearchRow } from '../deskTypes';
import { CUSTOMER_SEARCH_MIN, useCustomerSearch } from './CustomerPicker';

export interface CustomerSearchParams {
  attach?: 'booking' | 'tab';
  reservation?: string;
  tab?: string;
}

/** Route-level search validation (routes/desk/_children.ts). */
export function validateCustomerSearch(raw: Record<string, unknown>): CustomerSearchParams {
  const attach = raw.attach === 'booking' || raw.attach === 'tab' ? raw.attach : undefined;
  return {
    ...(attach ? { attach } : {}),
    ...(typeof raw.reservation === 'string' ? { reservation: raw.reservation } : {}),
    ...(typeof raw.tab === 'string' ? { tab: raw.tab } : {}),
  };
}

export function CustomerSearchScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const params = useSearch({ strict: false }) as CustomerSearchParams;
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useCustomerSearch(query, 12);

  const status: AsyncStatus | 'idle' | 'searching' = !search.enabled
    ? 'idle'
    : search.isError
      ? 'error'
      : search.data === undefined
        ? 'searching'
        : search.data.length === 0
          ? 'empty'
          : 'ready';

  function attach(c: CustomerSearchRow) {
    if (params.attach === 'booking' && params.reservation) {
      void navigate({ to: '/desk/bookings/$id', params: { id: params.reservation }, search: { customer: c.id } as never });
    } else if (params.attach === 'tab') {
      void navigate({ to: '/till', search: { tab: params.tab, customer: c.id } as never });
    }
  }

  const createLink = (
    <Link to="/desk/customers/new" className="tp-btn" data-kind="primary" data-size="md">
      <Icon name="userPlus" size={16} /> {tr('ws.courtDesk.customers.create')}
    </Link>
  );

  return (
    <div style={{ maxInlineSize: '56rem' }}>
      <PageHeader title={tr('ws.courtDesk.customers.title')} subtitle={tr('ws.courtDesk.customers.lead')} actions={createLink} />
      {params.attach && (
        <MessagePresenter
          tone="info"
          icon="userPlus"
          message={params.attach === 'booking' ? tr('ws.courtDesk.customers.attachingBooking') : tr('ws.courtDesk.customers.attachingTab')}
          style={{ marginBlockEnd: '0.75rem' }}
        />
      )}
      <SearchField
        value={query}
        onChange={setQuery}
        size="lg"
        autoFocus
        inputRef={inputRef}
        placeholder={tr('ws.courtDesk.customers.placeholder')}
        aria-label={tr('ws.courtDesk.customers.title')}
        busy={search.isFetching}
        style={{ marginBlockEnd: '1rem' }}
      />

      {status === 'idle' && <EmptyState icon="search" title={tr('ws.courtDesk.customers.idle')} body={tr('ws.courtDesk.customers.idleBody')} compact />}
      {status === 'searching' && <Skeleton lines={4} blockSize="2.6rem" />}
      {(status === 'ready' || status === 'empty' || status === 'error') && (
        <AsyncStateWrapper
          status={status}
          error={search.error}
          onRetry={() => void search.refetch()}
          emptyContent={
            <EmptyState icon="users" title={tr('ws.courtDesk.customers.noMatch', { query: search.debouncedQuery })} body={tr('ws.courtDesk.customers.noMatchBody')} action={createLink} />
          }
        >
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', background: 'var(--tp-surface)', overflow: 'hidden' }}>
            {(search.data ?? []).map((c) => (
              <CustomerResultRow key={c.id} customer={c} attachLabel={params.attach ? (params.attach === 'booking' ? tr('ws.courtDesk.customers.attachBooking') : tr('ws.courtDesk.customers.attachTab')) : null} onAttach={() => attach(c)} onSelect={() => void navigate({ to: '/desk/customers/$id', params: { id: c.id } })} />
            ))}
          </ul>
          <p style={{ marginBlockStart: '0.5rem', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {formatNumber((search.data ?? []).length, locale)} · {tr('ws.courtDesk.customers.lead')}
          </p>
        </AsyncStateWrapper>
      )}
      {query.trim().length > 0 && query.trim().length < CUSTOMER_SEARCH_MIN && <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.courtDesk.customers.idle')}</p>}
    </div>
  );
}

/** CustomerResultRow (spec §07): customer + flags + counts; Open, and Attach when in attach mode. */
export function CustomerResultRow({
  customer: c,
  attachLabel,
  onAttach,
  onSelect,
}: {
  customer: CustomerSearchRow;
  attachLabel: string | null;
  onAttach: () => void;
  onSelect: () => void;
}) {
  const { tr, locale } = useLocale();
  const counts = c.counts ?? { bookings: 0, cancellations: 0, noShows: 0 };
  return (
    <li
      className="tp-row"
      data-clickable="true"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingBlock: '0.55rem', paddingInline: '0.85rem', borderBlockEnd: '1px solid var(--tp-border)', minBlockSize: '3rem' }}
    >
      <span style={{ display: 'inline-flex', inlineSize: '2rem', blockSize: '2rem', borderRadius: '50%', background: 'var(--tp-accent-soft)', color: 'var(--tp-accent-soft-fg)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="user" size={16} />
      </span>
      <div style={{ minInlineSize: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>
            <bdi>{c.full_name}</bdi>
          </strong>
          {(c.flags ?? []).map((f, i) => (
            <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: '0.15rem' }}>
          {c.phone && (
            <bdi dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {c.phone}
            </bdi>
          )}
          {c.email && <bdi dir="ltr">{c.email}</bdi>}
          <span>{tr('ws.courtDesk.customers.counts.bookings', { count: formatNumber(counts.bookings, locale) })}</span>
          <span>{tr('ws.courtDesk.customers.counts.cancellations', { count: formatNumber(counts.cancellations, locale) })}</span>
          <span>{tr('ws.courtDesk.customers.counts.noShows', { count: formatNumber(counts.noShows, locale) })}</span>
        </div>
      </div>
      <span style={{ display: 'inline-flex', gap: '0.3rem' }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {attachLabel && (
          <Button size="sm" kind="primary" icon="userPlus" onClick={onAttach}>
            {attachLabel}
          </Button>
        )}
        <Button size="sm" kind="ghost" iconEnd="chevronEnd" onClick={onSelect}>
          {tr('ws.courtDesk.customers.open')}
        </Button>
      </span>
    </li>
  );
}
