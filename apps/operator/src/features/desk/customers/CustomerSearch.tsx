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
import { AsyncStateWrapper, CustomerFlagBadge, EmptyState, FilterChips, MessagePresenter, PageHeader, ResultCount, SearchField, type AsyncStatus } from '../../../components/kit';
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

/** What `customer_search` returns at most; the screen states when it is hit. */
const CUSTOMER_SEARCH_LIMIT = 12;

export function CustomerSearchScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const params = useSearch({ strict: false }) as CustomerSearchParams;
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useCustomerSearch(query, CUSTOMER_SEARCH_LIMIT);
  const results = search.data ?? [];

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
    <Link to="/desk/customers/new" className="tp-btn" data-kind="primary" data-size="lg">
      <Icon name="userPlus" size={20} /> {tr('ws.courtDesk.customers.create')}
    </Link>
  );

  return (
    /* The desk runs this screen on a wide till monitor: capping it at
       --tp-measure-wide left half the glass empty while the result rows —
       the things actually being aimed at — stayed narrow. Prose measure is
       for reading; this is a targeting surface, so it takes the width. */
    <div style={{ inlineSize: '100%' }}>
      <PageHeader
        title={tr('ws.courtDesk.customers.title')}
        subtitle={
          /* Rulebook 6.10: the count belongs beside the title, not only in a
             footer line the eye reaches last. */
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
            {tr('ws.courtDesk.customers.lead')}
            {status === 'ready' && <ResultCount shown={results.length} total={results.length} />}
          </span>
        }
        actions={createLink}
      />
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

      {/* Rulebook 6.6: the filter actually behind the results is the DEBOUNCED
          query, which can differ from what is still being typed. Showing it
          removably is also the one-click way back to an empty screen. */}
      <FilterChips
        chips={
          search.enabled
            ? [
                {
                  id: 'query',
                  label: tr('ws.courtDesk.customers.queryChip', { query: search.debouncedQuery }),
                  text: search.debouncedQuery,
                  onRemove: () => {
                    setQuery('');
                    inputRef.current?.focus();
                  },
                },
              ]
            : []
        }
        style={{ marginBlockEnd: 'var(--tp-sp-2)' }}
      />

      {status === 'idle' && <EmptyState icon="search" title={tr('ws.courtDesk.customers.idle')} body={tr('ws.courtDesk.customers.idleBody')} compact />}
      {status === 'searching' && <Skeleton lines={5} blockSize="4.1rem" />}
      {(status === 'ready' || status === 'empty' || status === 'error') && (
        <AsyncStateWrapper
          status={status}
          error={search.error}
          onRetry={() => void search.refetch()}
          emptyContent={
            /* 'filtered', not 'initial': the desk did not arrive at an empty
               customer book, it typed something that matched nothing, and the
               way back is clearing the search — not only creating a record. */
            <EmptyState
              kind="filtered"
              icon="users"
              title={tr('ws.courtDesk.customers.noMatch', { query: search.debouncedQuery })}
              body={tr('ws.courtDesk.customers.noMatchBody')}
              onClearFilters={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              action={createLink}
            />
          }
        >
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', background: 'var(--tp-surface)', overflow: 'hidden' }}>
            {results.map((c) => (
              <CustomerResultRow key={c.id} customer={c} attachLabel={params.attach ? (params.attach === 'booking' ? tr('ws.courtDesk.customers.attachBooking') : tr('ws.courtDesk.customers.attachTab')) : null} onAttach={() => attach(c)} onSelect={() => void navigate({ to: '/desk/customers/$id', params: { id: c.id } })} />
            ))}
          </ul>
          {/* The RPC caps the list, so a full page is never "all of them" —
              say so rather than letting the count imply a complete answer. */}
          {results.length === CUSTOMER_SEARCH_LIMIT && (
            <p style={{ marginBlockStart: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {tr('ws.courtDesk.customers.capped', { count: formatNumber(CUSTOMER_SEARCH_LIMIT, locale) })}
            </p>
          )}
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
      /* Three zones rather than one stretched line: who they are, how often
         they come, and what you can do about it. On the width this screen now
         gets, the counts and the actions stay parked where the eye already
         learned to find them instead of drifting apart per row; the wrap
         keeps the same row usable on a narrow tablet. */
      style={{ display: 'flex', alignItems: 'center', gap: '1rem', rowGap: '0.5rem', flexWrap: 'wrap', paddingBlock: '0.7rem', paddingInline: '1.1rem', borderBlockEnd: '1px solid var(--tp-border)', minBlockSize: '3.75rem' }}
    >
      <span style={{ display: 'inline-flex', inlineSize: '2.5rem', blockSize: '2.5rem', borderRadius: '50%', background: 'var(--tp-accent-soft)', color: 'var(--tp-accent-soft-fg)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="user" size={20} />
      </span>
      <div style={{ minInlineSize: 0, flex: '1 1 18rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 'var(--tp-fs-lg)' }}>
            <bdi>{c.full_name}</bdi>
          </strong>
          {(c.flags ?? []).map((f, i) => (
            <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} size="md" />
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockStart: '0.2rem' }}>
          {c.phone && (
            <bdi dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {c.phone}
            </bdi>
          )}
          {c.email && <bdi dir="ltr">{c.email}</bdi>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '1.1rem', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', flex: '0 1 auto' }}>
        <span>{tr('ws.courtDesk.customers.counts.bookings', { count: formatNumber(counts.bookings, locale) })}</span>
        <span>{tr('ws.courtDesk.customers.counts.cancellations', { count: formatNumber(counts.cancellations, locale) })}</span>
        <span>{tr('ws.courtDesk.customers.counts.noShows', { count: formatNumber(counts.noShows, locale) })}</span>
      </div>
      <span style={{ display: 'inline-flex', gap: '0.5rem', marginInlineStart: 'auto', flexShrink: 0 }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {attachLabel && (
          <Button size="lg" kind="primary" icon="userPlus" onClick={onAttach}>
            {attachLabel}
          </Button>
        )}
        <Button size="lg" kind="soft" iconEnd="chevronEnd" onClick={onSelect}>
          {tr('ws.courtDesk.customers.open')}
        </Button>
      </span>
    </li>
  );
}
