/**
 * 06.8 CustomerSearchScreen — the customer book, listed, with one big search
 * box that narrows it as you type.
 *
 * The list (owner call, 2026-09-22) comes from 0144 `customer_directory`: the
 * whole book in one lean read, kept in memory for
 * CUSTOMER_DIRECTORY_STALE_MS, so opening this screen again — or typing — does
 * not fetch anything. Typing filters that copy locally with the server
 * search's own matching rules (customerDirectoryLogic.ts). A book larger than
 * the directory's cap cannot be filtered locally without missing people, so
 * then the box falls back to `customer_search`, as it always used to.
 * A customer created, edited or flagged here invalidates the list; the foot
 * says how old it is and offers a Refresh for changes made elsewhere.
 *
 * Attach mode (`?attach=booking&reservation=<id>` / `?attach=tab&tab=<id>`):
 * no reservation RPC accepts a guest id after creation, so "Attach" hands the
 * chosen customer back to the caller in the URL (`?customer=<id>`) and the
 * caller decides what it can do with it. The booking screen currently states
 * that attaching is not available; the till lane owns the tab side.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { formatNumber, formatTime } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { canAccess, useAuth } from '../../../lib/auth';
import { Button, Skeleton } from '../../../components/ui';
import { AsyncStateWrapper, CustomerFlagBadge, EmptyState, FilterChips, MessagePresenter, PageHeader, ResultCount, SearchField, SegmentedControl, type AsyncStatus } from '../../../components/kit';
import { Icon } from '../../../components/icons';
import type { CustomerSearchRow } from '../deskTypes';
import { CUSTOMER_SEARCH_MIN, useCustomerSearch } from './CustomerPicker';
import {
  CUSTOMER_DIRECTORY_KEY,
  CUSTOMER_DIRECTORY_STALE_MS,
  CUSTOMER_PAGE,
  filterCustomers,
  type CustomerDirectory,
  type CustomerSort,
} from './customerDirectoryLogic';

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

/** What `customer_search` returns at most when the book is too big to list; the screen states when it is hit. */
const CUSTOMER_SEARCH_LIMIT = 12;

export function useCustomerDirectory() {
  return useQuery({
    queryKey: CUSTOMER_DIRECTORY_KEY,
    queryFn: () => appRpc<CustomerDirectory>('customer_directory', {}),
    staleTime: CUSTOMER_DIRECTORY_STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

export function CustomerSearchScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const params = useSearch({ strict: false }) as CustomerSearchParams;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CustomerSort>('name');
  const [shown, setShown] = useState(CUSTOMER_PAGE);
  const inputRef = useRef<HTMLInputElement>(null);
  const directory = useCustomerDirectory();
  const book = directory.data;
  // Only a book the directory could not hold whole goes back to the server
  // per query; otherwise the search below never fires.
  const serverMode = book?.truncated === true;
  const search = useCustomerSearch(serverMode ? query : '', CUSTOMER_SEARCH_LIMIT);
  // The cashier searches customers too, and cannot open the desk calendar.
  const { staff } = useAuth();
  const canBook = canAccess(staff?.role, '/desk');

  const trimmed = query.trim();
  const filtering = trimmed.length >= CUSTOMER_SEARCH_MIN;
  const local = useMemo(() => (book ? filterCustomers(book.rows, query, sort, CUSTOMER_SEARCH_MIN) : []), [book, query, sort]);
  const results: CustomerSearchRow[] = serverMode && filtering ? (search.data ?? []) : local;
  const visible = serverMode && filtering ? results : results.slice(0, shown);

  const status: AsyncStatus | 'loading' = directory.isError && !book
    ? 'error'
    : !book
      ? 'loading'
      : serverMode && filtering
        ? search.isError
          ? 'error'
          : search.data === undefined
            ? 'loading'
            : search.data.length === 0
              ? 'empty'
              : 'ready'
        : results.length === 0
          ? 'empty'
          : 'ready';

  const clear = () => {
    setQuery('');
    setShown(CUSTOMER_PAGE);
    inputRef.current?.focus();
  };

  function attach(c: CustomerSearchRow) {
    if (params.attach === 'booking' && params.reservation) {
      void navigate({ to: '/desk/bookings/$id', params: { id: params.reservation }, search: { customer: c.id } as never });
    } else if (params.attach === 'tab') {
      void navigate({ to: '/till', search: { tab: params.tab, customer: c.id } as never });
    }
  }

  const createLink = (
    <Link to="/desk/customers/new" className="tp-btn" data-kind="primary" data-size="lg" style={{ textDecoration: 'none' }}>
      <Icon name="userPlus" size={20} /> {tr('ws.courtDesk.customers.create')}
    </Link>
  );
  const emptyBook = book !== undefined && book.total === 0;

  return (
    /* The desk runs this screen on a wide till monitor: capping it at
       --tp-measure-wide left half the glass empty while the result rows —
       the things actually being aimed at — stayed narrow. Prose measure is
       for reading; this is a targeting surface, so it takes the width. */
    <div style={{ inlineSize: '100%' }}>
      <PageHeader
        title={tr('ws.courtDesk.customers.title')}
        subtitle={
          /* Rulebook 6.10: the count belongs beside the title. With no query
             it is the size of the book; with one, how many of it match. */
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
            {tr('ws.courtDesk.customers.lead')}
            {book && !filtering && !emptyBook && (
              <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
                {tr('ws.courtDesk.customers.countAll', { count: formatNumber(book.total, locale) })}
              </span>
            )}
            {filtering && status === 'ready' && !serverMode && <ResultCount shown={results.length} total={book?.rows.length ?? results.length} />}
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
      {/* The box and the order of the list sit on one line: both change what
          the list below shows, and neither is worth a row of its own. */}
      <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'center', flexWrap: 'wrap', marginBlockEnd: '1rem' }}>
        <SearchField
          value={query}
          onChange={(v) => {
            setQuery(v);
            setShown(CUSTOMER_PAGE);
          }}
          size="lg"
          autoFocus
          inputRef={inputRef}
          placeholder={tr('ws.courtDesk.customers.placeholder')}
          aria-label={tr('ws.courtDesk.customers.title')}
          busy={serverMode ? search.isFetching : false}
          style={{ flex: '1 1 22rem', minInlineSize: 0 }}
        />
        {!emptyBook && (
          <SegmentedControl<CustomerSort>
            value={sort}
            onChange={(v) => {
              setSort(v);
              setShown(CUSTOMER_PAGE);
            }}
            aria-label={tr('ws.courtDesk.customers.sortLabel')}
            options={[
              { value: 'name', label: tr('ws.courtDesk.customers.sortName') },
              { value: 'bookings', label: tr('ws.courtDesk.customers.sortBookings') },
            ]}
          />
        )}
      </div>

      {/* Rulebook 6.6: the filter behind the results, removable — the
          one-press way back to the whole list. */}
      <FilterChips
        chips={
          filtering
            ? [{ id: 'query', label: tr('ws.courtDesk.customers.queryChip', { query: trimmed }), text: trimmed, onRemove: clear }]
            : []
        }
        style={{ marginBlockEnd: 'var(--tp-sp-2)' }}
      />

      {serverMode && !filtering && book && (
        <MessagePresenter
          tone="info"
          message={tr('ws.courtDesk.customers.truncated', { shown: formatNumber(book.rows.length, locale), total: formatNumber(book.total, locale) })}
          style={{ marginBlockEnd: 'var(--tp-sp-2)' }}
        />
      )}

      {status === 'loading' && <Skeleton lines={6} blockSize="4.1rem" />}
      {status !== 'loading' && (
        <AsyncStateWrapper
          status={status}
          error={serverMode && filtering ? search.error : directory.error}
          onRetry={() => void (serverMode && filtering ? search.refetch() : directory.refetch())}
          emptyContent={
            emptyBook ? (
              <EmptyState icon="users" title={tr('ws.courtDesk.customers.emptyBook')} body={tr('ws.courtDesk.customers.emptyBookBody')} action={createLink} />
            ) : (
              /* 'filtered', not 'initial': the desk typed something that
                 matched nothing, and the way back is clearing the search —
                 not only creating a record. */
              <EmptyState
                kind="filtered"
                icon="users"
                title={tr('ws.courtDesk.customers.noMatch', { query: trimmed })}
                body={tr('ws.courtDesk.customers.noMatchBody')}
                onClearFilters={clear}
                action={createLink}
              />
            )
          }
        >
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', background: 'var(--tp-surface)', overflow: 'hidden' }}>
            {visible.map((c) => (
              <CustomerResultRow
                key={c.id}
                customer={c}
                attachLabel={params.attach ? (params.attach === 'booking' ? tr('ws.courtDesk.customers.attachBooking') : tr('ws.courtDesk.customers.attachTab')) : null}
                onAttach={() => attach(c)}
                onBook={canBook && !params.attach ? () => void navigate({ to: '/desk', search: { customer: c.id } as never }) : undefined}
                onSelect={() => void navigate({ to: '/desk/customers/$id', params: { id: c.id } })}
              />
            ))}
          </ul>
          {visible.length < results.length && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBlockStart: 'var(--tp-sp-3)' }}>
              <Button size="lg" kind="soft" icon="chevronDown" onClick={() => setShown((n) => n + CUSTOMER_PAGE)}>
                {tr('ws.courtDesk.customers.showMore', { count: formatNumber(Math.min(CUSTOMER_PAGE, results.length - visible.length), locale), remaining: formatNumber(results.length - visible.length, locale) })}
              </Button>
            </div>
          )}
          {/* The server search caps its answer, so a full page is never "all
              of them" — say so rather than letting the count imply it. */}
          {serverMode && filtering && results.length === CUSTOMER_SEARCH_LIMIT && (
            <p style={{ marginBlockStart: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {tr('ws.courtDesk.customers.capped', { count: formatNumber(CUSTOMER_SEARCH_LIMIT, locale) })}
            </p>
          )}
        </AsyncStateWrapper>
      )}
      {trimmed.length > 0 && !filtering && (
        <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockStart: 'var(--tp-sp-2)' }}>{tr('ws.courtDesk.customers.keepTyping')}</p>
      )}
      {/* How old the copy on screen is, and the way to fetch a new one: the
          list is kept for a while on purpose, and a customer added on another
          till will not be in it until then. */}
      {book && (
        <p style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-4)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.courtDesk.customers.asOf', { time: formatTime(new Date(directory.dataUpdatedAt), locale) })}
          <Button size="sm" kind="ghost" icon="refresh" busy={directory.isFetching} onClick={() => void directory.refetch()}>
            {tr('ws.courtDesk.customers.refresh')}
          </Button>
        </p>
      )}
    </div>
  );
}

/**
 * CustomerResultRow (spec §07): customer + flags + counts; Book, Open, and
 * Attach when in attach mode. "Book" is the reason most searches happen — a
 * regular at the counter — and it opens the calendar already booking for them.
 */
export function CustomerResultRow({
  customer: c,
  attachLabel,
  onAttach,
  onBook,
  onSelect,
}: {
  customer: CustomerSearchRow;
  attachLabel: string | null;
  onAttach: () => void;
  onBook?: () => void;
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
          {c.full_name.trim() ? (
            <strong style={{ fontSize: 'var(--tp-fs-lg)' }}>
              <bdi>{c.full_name}</bdi>
            </strong>
          ) : (
            <span style={{ fontSize: 'var(--tp-fs-lg)', color: 'var(--tp-muted-fg)', fontStyle: 'italic' }}>{tr('ws.courtDesk.customers.noName')}</span>
          )}
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
        <span>
          {tr('ws.courtDesk.customers.counts.bookingsLabel')} <strong style={{ color: 'var(--tp-fg)' }}>{formatNumber(counts.bookings, locale)}</strong>
        </span>
        {/* Only when there are some: "0 cancelled · 0 no-shows" on every row
            was two figures of noise per customer. A no-show record is the
            one the desk should notice, so it is the one that is tinted. */}
        {counts.cancellations > 0 && (
          <span>
            {tr('ws.courtDesk.customers.counts.cancellationsLabel')} <strong style={{ color: 'var(--tp-fg)' }}>{formatNumber(counts.cancellations, locale)}</strong>
          </span>
        )}
        {counts.noShows > 0 && (
          <span>
            {tr('ws.courtDesk.customers.counts.noShowsLabel')} <strong style={{ color: 'var(--tp-warn-fg)' }}>{formatNumber(counts.noShows, locale)}</strong>
          </span>
        )}
      </div>
      <span style={{ display: 'inline-flex', gap: '0.5rem', marginInlineStart: 'auto', flexShrink: 0 }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {attachLabel && (
          <Button size="lg" kind="primary" icon="userPlus" onClick={onAttach}>
            {attachLabel}
          </Button>
        )}
        {onBook && (
          <Button size="lg" icon="calendar" onClick={onBook}>
            {tr('ws.courtDesk.customers.book')}
          </Button>
        )}
        <Button size="lg" kind="soft" iconEnd="chevronEnd" onClick={onSelect}>
          {tr('ws.courtDesk.customers.open')}
        </Button>
      </span>
    </li>
  );
}
