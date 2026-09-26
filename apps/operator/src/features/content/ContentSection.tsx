/**
 * Content for approval (wave5-addendum-2026-09-25 §2.7, §5.1-§5.2), in its two
 * places:
 *
 *  - **On /marketing, the owner’s** (`ContentApprovalPanel`, decideContent): the
 *    first thing on the page, because it waits on the owner. Waiting (oldest
 *    first), Changes asked, Approved, Closed and All; a row opens the sheet
 *    where the owner approves, asks for changes or declines.
 *  - **On /tasks, marketing’s** (`MarketingContentPanel`, submitContent): the
 *    venue's queue, newest first, with "New post" and, from the sheet, Revise,
 *    Withdraw and Send again. The form opens in the panel, in place of the
 *    list.
 *
 * Managers never see either (§8 Q14): /marketing is the owner's, and the
 * reads refuse them. Both lists read app.content_page; the Waiting filter's
 * first page is the owner's rail badge's own read (QK.contentWaiting).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { QK } from '../../lib/queryKeys';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Skeleton } from '../../components/ui';
import { Pagination, Panel, SegmentedControl, StatusBadge } from '../../components/kit';
import { Icon } from '../../components/icons';
import { CardTitle, MARK_FG } from '../ops/OpsVisuals';
import { useSignedPhoto } from '../checklists/StaffPhoto';
import { dayLabel } from '../deductions/venueDate';
import { CK, fetchContentWaiting } from './api';
import { ContentForm, type ContentFormMode } from './ContentForm';
import { ContentSheet } from './ContentSheet';
import {
  CONTENT_FILTERS,
  CONTENT_PAGE_SIZE,
  EMPTY_DRAFT,
  contentTone,
  draftFrom,
  readContentPage,
  type ContentFilter,
  type ContentRow,
} from './contentLogic';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

/** The owner's section on /marketing. */
export function ContentApprovalPanel() {
  const { tr, locale } = useLocale();
  const [filter, setFilter] = useState<ContentFilter>('waiting');
  const [openId, setOpenId] = useState<string | null>(null);
  const waitingQ = useQuery({ queryKey: QK.contentWaiting, queryFn: fetchContentWaiting, refetchInterval: 60_000 });
  const waiting = readContentPage(waitingQ.data).waitingCount;

  return (
    <Panel
      title={<CardTitle icon="spark">{tr('ws.content.title')}</CardTitle>}
      actions={waiting > 0 ? <StatusBadge tone="warn" label={tr('ws.content.waitingBadge', { count: formatNumber(waiting, locale) })} /> : undefined}
      padded={false}
      data-testid="content.approval"
    >
      <ContentList filter={filter} onFilter={setFilter} counts={{ waiting }} onOpen={(r) => setOpenId(r.id)} lead={tr('ws.content.leadOwner')} />
      {openId && <SheetFor id={openId} viewer="owner" filter={filter} onClose={() => setOpenId(null)} />}
    </Panel>
  );
}

/**
 * Marketing's section on /tasks: the queue, and the form in its place while
 * writing. What the owner sent back waits on marketing, so the section opens
 * on "Changes asked" while it holds any, with its count, and on All otherwise.
 */
export function MarketingContentPanel() {
  const { tr } = useLocale();
  const [picked, setPicked] = useState<ContentFilter | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<ContentFormMode | null>(null);
  const waitingQ = useQuery({ queryKey: QK.contentWaiting, queryFn: fetchContentWaiting, refetchInterval: 60_000 });
  const waiting = readContentPage(waitingQ.data).waitingCount;
  // The Changes asked list's own first page (the same key ContentList reads).
  const changesQ = useQuery({ queryKey: CK.page('changes', 0), queryFn: () => fetchContentPage('changes', 0), refetchInterval: 60_000 });
  const changes = readContentPage(changesQ.data).total;
  const filter: ContentFilter = picked ?? (changes > 0 ? 'changes' : 'all');
  const setFilter = setPicked;

  return (
    <Panel
      title={<CardTitle icon="spark">{tr('ws.content.title')}</CardTitle>}
      actions={
        form === null ? (
          <Button size="sm" kind="primary" icon="plus" onClick={() => setForm({ kind: 'new', draft: EMPTY_DRAFT })} data-testid="content.new">
            {tr('ws.content.newPost')}
          </Button>
        ) : undefined
      }
      padded={form !== null}
      data-testid="content.marketing"
    >
      {form ? (
        <ContentForm key={form.kind === 'revise' ? `revise:${form.row.id}` : 'new'} mode={form} onClose={() => setForm(null)} />
      ) : (
        <ContentList filter={filter} onFilter={setFilter} counts={{ waiting, changes }} onOpen={(r) => setOpenId(r.id)} lead={tr('ws.content.leadMarketing')} />
      )}
      {openId && (
        <SheetFor
          id={openId}
          viewer="marketing"
          filter={filter}
          onClose={() => setOpenId(null)}
          onRevise={(detail) => {
            setOpenId(null);
            if (detail.content) setForm({ kind: 'revise', row: detail.content, draft: draftFrom(detail, 'revise') });
          }}
          onSendAgain={(detail) => {
            setOpenId(null);
            setForm({ kind: 'new', draft: draftFrom(detail, 'again') });
          }}
        />
      )}
    </Panel>
  );
}

/** The sheet, fed the list row it was opened from while its own read loads. */
function SheetFor({ id, filter, ...rest }: { id: string; filter: ContentFilter; onClose: () => void } & Pick<Parameters<typeof ContentSheet>[0], 'viewer' | 'onRevise' | 'onSendAgain'>) {
  const qc = useQueryClient();
  const cached = qc.getQueryData(filter === 'waiting' ? QK.contentWaiting : CK.page(filter, 0));
  const fallback = readContentPage(cached).rows.find((r) => r.id === id) ?? null;
  return <ContentSheet id={id} fallback={fallback} {...rest} />;
}

/** The page every filter but Waiting reads, under CK.page (Waiting's first page is QK.contentWaiting). */
function fetchContentPage(filter: ContentFilter, offset: number) {
  return appRpc<unknown>('content_page', { p_filter: filter, p_limit: CONTENT_PAGE_SIZE, p_offset: offset });
}

/** The filters and the rows; the Waiting filter's first page is the badge's own read. */
function ContentList({
  filter,
  onFilter,
  counts,
  onOpen,
  lead,
}: {
  filter: ContentFilter;
  onFilter: (f: ContentFilter) => void;
  /** Counts shown on their filters: the owner's waiting posts, and marketing's sent-back ones. */
  counts: { waiting: number; changes?: number };
  onOpen: (row: ContentRow) => void;
  lead: string;
}) {
  const { tr, locale } = useLocale();
  const [page, setPage] = useState(1);
  const offset = (page - 1) * CONTENT_PAGE_SIZE;
  const shared = filter === 'waiting' && offset === 0;
  const sharedQ = useQuery({ queryKey: QK.contentWaiting, queryFn: fetchContentWaiting, refetchInterval: 60_000, enabled: shared });
  const ownQ = useQuery({
    queryKey: CK.page(filter, offset),
    queryFn: () => fetchContentPage(filter, offset),
    enabled: !shared,
    refetchInterval: 60_000,
  });
  const q = shared ? sharedQ : ownQ;
  const data = readContentPage(q.data);
  const pageCount = Math.ceil(data.total / CONTENT_PAGE_SIZE);
  const pad = { paddingBlock: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-3)' } as const;

  return (
    <>
      <div style={{ ...pad, display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <p style={{ ...muted, margin: 0, maxInlineSize: '70ch' }}>{lead}</p>
        <div>
          <SegmentedControl<ContentFilter>
            size="sm"
            aria-label={tr('ws.content.filterLabel')}
            value={filter}
            onChange={(f) => {
              onFilter(f);
              setPage(1);
            }}
            options={CONTENT_FILTERS.map((f) => ({
              value: f,
              label:
                f === 'waiting' && counts.waiting > 0
                  ? tr('ws.content.filter.waitingCount', { count: formatNumber(counts.waiting, locale) })
                  : f === 'changes' && (counts.changes ?? 0) > 0
                    ? tr('ws.content.filter.changesCount', { count: formatNumber(counts.changes ?? 0, locale) })
                    : tr(`ws.content.filter.${f}`),
            }))}
          />
        </div>
      </div>
      <div style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
        {q.isError && q.data === undefined ? (
          <div style={{ ...pad, display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
            <ErrorText error={q.error} style={{ marginBlock: 0 }} />
            <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
              {tr('common.retry')}
            </Button>
          </div>
        ) : q.data === undefined ? (
          <div style={pad}>
            <Skeleton lines={3} />
          </div>
        ) : data.rows.length === 0 ? (
          <p style={{ ...pad, margin: 0, fontWeight: 600, color: filter === 'waiting' ? MARK_FG.success : 'var(--tp-muted-fg)' }}>{tr(`ws.content.empty.${filter}`)}</p>
        ) : (
          // Rows divided by a hairline inside the panel, as the requests list
          // under it: a row is not a card of its own.
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {data.rows.map((r, i) => (
              <li key={r.id} style={{ borderBlockStart: i === 0 ? undefined : '1px solid var(--tp-border)' }}>
                <ContentRowButton row={r} onOpen={() => onOpen(r)} />
              </li>
            ))}
          </ul>
        )}
        {pageCount > 1 && (
          <div style={pad}>
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          </div>
        )}
      </div>
    </>
  );
}

function ContentRowButton({ row: r, onOpen }: { row: ContentRow; onOpen: () => void }) {
  const { tr, locale } = useLocale();
  return (
    <button
      type="button"
      className="tp-row"
      data-clickable="true"
      onClick={onOpen}
      data-testid={`content.item.${r.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 'var(--tp-sp-3)',
        inlineSize: '100%',
        paddingBlock: 'var(--tp-sp-2-5)',
        paddingInline: 'var(--tp-sp-3)',
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'start',
        cursor: 'pointer',
      }}
    >
      <Cover path={r.coverImage} />
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
        <bdi style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</bdi>
        <span style={muted}>
          {[
            tr(`work.content.channel.${r.channel}`),
            r.plannedFor ? tr('ws.content.plannedFor', { date: dayLabel(r.plannedFor, locale) }) : null,
            r.authorName ? tr('ws.content.byName', { name: isolate(r.authorName) }) : null,
            r.currentVersion > 1 ? tr('ws.content.versionN', { n: formatNumber(r.currentVersion, locale) }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {r.submittedAt && <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.content.sentAt', { time: formatDateTime(new Date(r.submittedAt), locale) })}</span>}
      </span>
      <StatusBadge size="sm" tone={contentTone(r.status)} label={tr(`work.content.status.${r.status}`)} />
    </button>
  );
}

/** The first image of the current version, small; a plain mark when there is none or it cannot be read. */
function Cover({ path }: { path: string | null }) {
  const q = useSignedPhoto(path);
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'grid',
        placeItems: 'center',
        inlineSize: '3rem',
        blockSize: '3rem',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
        color: 'var(--tp-muted-fg)',
        overflow: 'hidden',
        flex: '0 0 auto',
      }}
    >
      {path && q.isSuccess ? <img src={q.data} alt="" style={{ display: 'block', inlineSize: '100%', blockSize: '100%', objectFit: 'cover' }} /> : <Icon name={path ? 'frame' : 'fileText'} size={18} />}
    </span>
  );
}
