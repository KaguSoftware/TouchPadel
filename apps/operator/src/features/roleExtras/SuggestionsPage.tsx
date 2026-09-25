/**
 * Suggestions (/suggestions) — the staff suggestion box (role spec #63),
 * manager and owner.
 *
 * Every role posts from the phone; this page is where management reads them.
 * A suggestion is signed (its author's name and role), so a manager can follow
 * one up, and "Mark as seen" is the only answer the box has: the author sees
 * that it was seen, and the rail badge counts the ones nobody has marked yet.
 * There is no reply, no photo and no push (build-contracts-2026-09-23 §2.24.4).
 *
 * New, Seen and All come from app.suggestions_page. The New tab's first page
 * is the rail badge's own read (QK.suggestionsNew), so marking one seen moves
 * the badge and the list together.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { QK } from '../../lib/queryKeys';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText } from '../../components/ui';
import { AsyncStateWrapper, EmptyState, PageHeader, Pagination, SegmentedControl, StatusBadge, asyncStatus } from '../../components/kit';
import { RK } from './keys';
import { fetchSuggestionsNew } from './api';
import {
  SUGGESTIONS_PAGE_SIZE,
  readSuggestionsPage,
  type SuggestionFilter,
  type SuggestionRow,
} from './roleExtrasLogic';

export function SuggestionsPageScreen() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<SuggestionFilter>('new');
  const [page, setPage] = useState(1);
  const offset = (page - 1) * SUGGESTIONS_PAGE_SIZE;
  const shared = filter === 'new' && offset === 0;

  const newQ = useQuery({ queryKey: QK.suggestionsNew, queryFn: fetchSuggestionsNew, refetchInterval: 60_000 });
  const listQ = useQuery({
    queryKey: RK.suggestions(filter, offset),
    queryFn: () => appRpc<unknown>('suggestions_page', { p_filter: filter, p_limit: SUGGESTIONS_PAGE_SIZE, p_offset: offset }),
    enabled: !shared,
    refetchInterval: 60_000,
  });
  const q = shared ? newQ : listQ;
  const data = readSuggestionsPage(q.data);
  const newCount = readSuggestionsPage(newQ.data).newCount;

  const seen = useMutation({
    mutationFn: (id: string) => appRpc('mark_suggestion_seen', { p_id: id }),
    onSuccess: () => {
      toast.ok(tr('ws.rolePages.suggestions.marked'));
      void qc.invalidateQueries({ queryKey: ['suggestions'] });
    },
  });

  const pageCount = Math.ceil(data.total / SUGGESTIONS_PAGE_SIZE);

  return (
    <div style={{ maxInlineSize: '56rem' }}>
      <PageHeader title={tr('ws.rolePages.suggestions.title')} subtitle={tr('ws.rolePages.suggestions.lead')} />
      <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
        <SegmentedControl<SuggestionFilter>
          aria-label={tr('ws.rolePages.suggestions.filterLabel')}
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setPage(1);
          }}
          options={[
            {
              value: 'new',
              label: newCount > 0 ? tr('ws.rolePages.suggestions.filter.newCount', { count: formatNumber(newCount, locale) }) : tr('ws.rolePages.suggestions.filter.new'),
            },
            { value: 'seen', label: tr('ws.rolePages.suggestions.filter.seen') },
            { value: 'all', label: tr('ws.rolePages.suggestions.filter.all') },
          ]}
        />
      </div>
      <ErrorText error={seen.error} />
      <AsyncStateWrapper
        status={asyncStatus(q, () => data.rows.length === 0)}
        error={q.error}
        onRetry={() => void q.refetch()}
        emptyContent={
          <EmptyState
            icon="note"
            kind="nothingToDo"
            title={tr(`ws.rolePages.suggestions.empty.${filter}`)}
            body={filter === 'new' ? tr('ws.rolePages.suggestions.empty.newBody') : undefined}
          />
        }
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {data.rows.map((row) => (
            <SuggestionItem key={row.id} row={row} markUnseen={filter === 'all'} busy={seen.isPending && seen.variables === row.id} onSeen={() => seen.mutate(row.id)} />
          ))}
        </ul>
        {pageCount > 1 && <Pagination page={page} pageCount={pageCount} onChange={setPage} />}
      </AsyncStateWrapper>
    </div>
  );
}

/**
 * One suggestion. `markUnseen` puts "Not seen yet" on an unmarked one; under
 * New every row is unmarked by definition, so there the tab says it once.
 */
function SuggestionItem({ row, markUnseen, busy, onSeen }: { row: SuggestionRow; markUnseen: boolean; busy: boolean; onSeen: () => void }) {
  const { tr, locale } = useLocale();
  const when = row.createdAt ? formatDateTime(new Date(row.createdAt), locale) : '';
  const who = row.authorName ?? tr('ws.rolePages.suggestions.someone');
  return (
    <li
      data-testid={`suggestion-${row.id}`}
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-2)',
        paddingBlock: 'var(--tp-sp-3)',
        paddingInline: 'var(--tp-sp-3)',
        borderRadius: 'var(--tp-radius-panel)',
        border: '1px solid var(--tp-border)',
        background: 'var(--tp-surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <strong>
          <bdi>{who}</bdi>
        </strong>
        {row.authorRole && <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr(`op.roles.${row.authorRole}`)}</span>}
        <span style={{ marginInlineStart: 'auto', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', fontVariantNumeric: 'tabular-nums' }}>{when}</span>
      </div>
      {/* Staff free text, shown as typed in the writer's language. */}
      <p dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {row.body}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        {row.seenAt ? (
          <StatusBadge
            size="sm"
            tone="success"
            icon="check"
            label={
              row.seenByName
                ? tr('ws.rolePages.suggestions.seenBy', { name: isolate(row.seenByName), time: formatDateTime(new Date(row.seenAt), locale) })
                : tr('ws.rolePages.suggestions.seenAt', { time: formatDateTime(new Date(row.seenAt), locale) })
            }
          />
        ) : (
          <>
            {markUnseen && <StatusBadge size="sm" tone="warn" label={tr('ws.rolePages.suggestions.notSeen')} />}
            <Button size="sm" icon="check" busy={busy} onClick={onSeen} style={{ marginInlineStart: 'auto' }}>
              {tr('ws.rolePages.suggestions.markSeen')}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
