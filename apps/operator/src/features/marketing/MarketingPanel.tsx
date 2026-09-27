/**
 * Marketing (/marketing) — campaigns, who they reached, and what they returned.
 *
 * Before this the venue's marketing was three unrelated screens: promotions
 * priced a discount, the hero editor changed the guest site, and the Telegram
 * outbox sent text. Nothing tied a discount to the message that announced it,
 * so "did that work" had no answer. A campaign is the tie.
 *
 * The honesty rule this screen is built around: a campaign that hands out a
 * PROMOTION can be measured, because a redemption is a fact linking a sale to
 * it. A campaign without one — a hero image, a Telegram post — cannot be, and
 * this panel says "not measurable" instead of showing a zero or inventing a
 * lift. A fabricated attribution figure is worse than an absent one, because
 * it gets believed and then budgeted against. So the result column has two
 * shapes that never meet: money plus how often the promotion was used, or the
 * words "Not measurable" with the reason. A measurable campaign that earned
 * nothing prints 0 IQD; an unmeasurable one never prints a number.
 *
 * WHAT THE 2026-09-16 PASS CHANGED, AND WHY
 *
 *  - Editing a campaign used to WIPE its message: `marketing_overview` does not
 *    return the bodies, the editor started them empty, and Save wrote the empty
 *    strings back. The editor now reads the saved message before it can save.
 *  - Dates were UTC days (03:00 in Baghdad) and the chosen end day was the
 *    exclusive end, so redemptions on the last day never counted. The form now
 *    asks for a start and a LAST day and converts both at the venue's midnight
 *    (marketingTypes.windowToServer).
 *  - Going live, ending and cancelling cannot be undone and used to happen on
 *    one click; each now says what it does and asks first. Going live also
 *    says the one thing an owner would otherwise assume: nothing in the app
 *    sends the message (no code writes `marketing_sends`).
 *  - A scheduled campaign past its start, or a live one past its last day, is
 *    flagged on its row — nothing moves a status by itself.
 *  - Audiences could be listed but not made (the RPC existed, the screen did
 *    not), so every campaign went to "Everyone". They can be created and
 *    edited here now.
 *
 * FROM MARKETING (build-contracts-2026-09-23 §2.17, §5.5). The marketing role
 * suggests drafts from the phone (app.suggest_campaign); they arrive here as
 * ordinary drafts, marked with who suggested them, their note and their
 * photos, with a "From marketing" filter. app.marketing_suggestions says which
 * campaigns they are, joined by id (marketing_overview is slice 2's to
 * re-issue). The owner completes the audience and promotion and makes them
 * live, as with any draft: marketing never does.
 *
 * REQUESTS TO MARKETING (build-contracts-2026-09-23 §2.24.11, §5.5; plan #73).
 * Staff ask marketing for something (a post about a new item, photos of the
 * courts) from their phones, and marketing answers there, done or declined.
 * The owner reads them here, from app.marketing_requests_page: Waiting,
 * Answered or All, with who asked, the item it is about, the photos and the
 * answer. Read-only: answering is marketing's, on the phone.
 *
 * Both payload readers (readSuggestions, readRequests) and isPastWanted are in
 * marketingStaffLogic.ts, with a node test.
 *
 * CONTENT FOR APPROVAL (wave5-addendum-2026-09-25 §2.7, §5.2; Majed's answer
 * #7). Marketing sends posts for the owners' approval; they head this page,
 * because they wait on the owner (features/content/ContentSection.tsx). Only
 * the owner decides (decideContent), and managers never open /marketing.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { VENUE_TZ, formatDate, formatDateTime, formatIQD, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { supabase } from '../../lib/supabase';
import { fetchPromotions, PROMOTIONS_KEY } from '../admin/promotions/promotionsApi';
import { todayIso } from '../admin/menu/availability';
import { useLocale } from '../../lib/i18n';
import { ContentApprovalPanel } from '../content/ContentSection';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, Select, inputStyle } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  RowActions,
  SegmentedControl,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  type Column,
  type RowAction,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import { CardTitle } from '../ops/OpsVisuals';
import { PhotoViewer } from '../checklists/StaffPhoto';
import { isPastWanted, readRequests, readSuggestions, type RequestFilter, type RequestStatus } from './marketingStaffLogic';
import {
  MARKETING_QUERY_KEY,
  campaignTone,
  isEditable,
  matchesFilter,
  nextStatuses,
  overdueCampaigns,
  parseLimit,
  readRule,
  ruleParts,
  windowFromServer,
  windowIsBackwards,
  windowToServer,
  type AudienceRow,
  type AudienceRule,
  type CampaignFilter,
  type CampaignRow,
  type CampaignStatus,
  type MarketingChannel,
  type MarketingOverview,
} from './marketingTypes';

const STATUS_ACTION: Record<CampaignStatus, string> = {
  scheduled: 'ws.owner.marketing.actions.schedule',
  live: 'ws.owner.marketing.actions.goLive',
  ended: 'ws.owner.marketing.actions.end',
  cancelled: 'ws.owner.marketing.actions.cancel',
  draft: 'ws.owner.marketing.actions.backToDraft',
};

/** Moves that cannot be taken back, and so are asked about first. */
const CONFIRMED_MOVES: Partial<Record<CampaignStatus, { title: string; body: string }>> = {
  live: { title: 'ws.owner.marketing.confirm.liveTitle', body: 'ws.owner.marketing.confirm.liveBody' },
  ended: { title: 'ws.owner.marketing.confirm.endTitle', body: 'ws.owner.marketing.confirm.endBody' },
  cancelled: { title: 'ws.owner.marketing.confirm.cancelTitle', body: 'ws.owner.marketing.confirm.cancelBody' },
};

const FILTERS: readonly CampaignFilter[] = ['all', 'live', 'scheduled', 'draft', 'finished'];

/** The list's filters: the status ones, and the drafts marketing suggested. */
type PanelFilter = CampaignFilter | 'fromMarketing';

const SUGGESTIONS_KEY = ['marketing', 'suggestions'] as const;

// ---------------------------------------------------------------------------
// Requests to marketing (app.marketing_requests_page)
// ---------------------------------------------------------------------------

const REQUEST_FILTERS: readonly RequestFilter[] = ['open', 'answered', 'all'];
/** The page the panel reads; the rest is counted, not listed. */
const REQUESTS_SHOWN = 50;

// The tones the same statuses carry in the /tasks copy and on the phone:
// waiting for someone is amber, declined is red.
const REQUEST_TONE: Record<RequestStatus, 'warn' | 'success' | 'danger' | 'neutral'> = {
  open: 'warn',
  done: 'success',
  declined: 'danger',
  withdrawn: 'neutral',
};

/** A 'YYYY-MM-DD' printed as a date, without a timezone shifting it a day. */
function dayLabel(date: string, locale: 'en' | 'ar'): string {
  return formatDate(new Date(`${date}T12:00:00Z`), locale, 'UTC');
}

export function MarketingPanelScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<CampaignRow | 'new' | null>(null);
  const [editingAudience, setEditingAudience] = useState<AudienceRow | 'new' | null>(null);
  const [confirming, setConfirming] = useState<{ campaign: CampaignRow; status: CampaignStatus } | null>(null);
  const [filter, setFilter] = useState<PanelFilter>('all');
  const [photos, setPhotos] = useState<{ title: string; paths: readonly string[] } | null>(null);

  const q = useQuery({
    queryKey: MARKETING_QUERY_KEY,
    queryFn: () => appRpc<MarketingOverview>('marketing_overview'),
    refetchInterval: 60_000,
  });
  // Which campaigns marketing suggested. A failed read only loses the marks:
  // the campaigns themselves come from the overview.
  const suggestionsQ = useQuery({
    queryKey: SUGGESTIONS_KEY,
    queryFn: () => appRpc<unknown>('marketing_suggestions'),
    refetchInterval: 60_000,
  });
  const suggestions = useMemo(() => readSuggestions(suggestionsQ.data), [suggestionsQ.data]);

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CampaignStatus }) =>
      appRpc('set_campaign_status', { p_id: id, p_status: status }),
    onSuccess: (_d, vars) => {
      setConfirming(null);
      toast.ok(tr('ws.owner.marketing.toast.moved', { status: tr(`ws.owner.marketing.statuses.${vars.status}`) }));
      void qc.invalidateQueries({ queryKey: MARKETING_QUERY_KEY });
    },
    // toast.err runs the shared code -> message mapper (lib/errors.ts), so
    // BAD_TRANSITION, BODY_REQUIRED and START_REQUIRED read as sentences.
    onError: (e) => toast.err(e),
  });

  function requestMove(campaign: CampaignRow, status: CampaignStatus) {
    if (CONFIRMED_MOVES[status]) setConfirming({ campaign, status });
    else move.mutate({ id: campaign.id, status });
  }

  const campaigns = useMemo(() => q.data?.campaigns ?? [], [q.data]);
  const matches = (c: CampaignRow, f: PanelFilter) => (f === 'fromMarketing' ? suggestions.has(c.id) : matchesFilter(c.status, f));
  const shown = campaigns.filter((c) => matches(c, filter));
  const fromMarketingWaiting = campaigns.filter((c) => c.status === 'draft' && suggestions.has(c.id)).length;
  const filters: readonly PanelFilter[] = suggestions.size > 0 ? [...FILTERS.slice(0, 4), 'fromMarketing', ...FILTERS.slice(4)] : FILTERS;
  const overdue = useMemo(() => {
    const o = overdueCampaigns(campaigns, Date.now());
    return { toStart: new Set(o.toStart), toEnd: new Set(o.toEnd) };
  }, [campaigns]);
  const name = (en: string | null, ar: string | null) => (locale === 'ar' ? (ar ?? en ?? '—') : (en ?? ar ?? '—'));
  const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

  const columns: Column<CampaignRow>[] = [
    {
      key: 'campaign',
      header: tr('ws.owner.marketing.cols.campaign'),
      render: (c) => {
        const from = suggestions.get(c.id);
        return (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            <span style={{ fontWeight: 600 }}>
              <bdi>{name(c.name_en, c.name_ar)}</bdi>
            </span>
            <span style={muted}>
              {tr(`ws.owner.marketing.channels.${c.channel}`)} ·{' '}
              {c.promotion_id ? (
                <bdi>{tr('ws.owner.marketing.promotionLine', { name: name(c.promotion_en, c.promotion_ar) })}</bdi>
              ) : (
                tr('ws.owner.marketing.noPromotionLine')
              )}
            </span>
            {from && (
              <span data-from-marketing style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--tp-sp-1)', marginBlockStart: 'var(--tp-sp-0)' }}>
                <StatusBadge
                  size="sm"
                  tone="info"
                  icon="spark"
                  label={from.suggested_by_name ? tr('ws.supplies.fromMarketing.from', { name: isolate(from.suggested_by_name) }) : tr('ws.supplies.fromMarketing.fromUnknown')}
                />
                {from.images.length > 0 && (
                  <Button size="sm" kind="ghost" icon="eye" onClick={() => setPhotos({ title: tr('ws.supplies.fromMarketing.photosTitle'), paths: from.images })}>
                    {tr('ws.supplies.fromMarketing.photos', { count: formatNumber(from.images.length, locale) })}
                  </Button>
                )}
                {from.suggestion_note && (
                  <span style={{ ...muted, fontStyle: 'italic', flexBasis: '100%', overflowWrap: 'anywhere' }}>
                    <bdi>{tr('ws.supplies.fromMarketing.note', { note: isolate(from.suggestion_note) })}</bdi>
                  </span>
                )}
              </span>
            )}
          </span>
        );
      },
      truncateTitle: (c) => name(c.name_en, c.name_ar),
    },
    {
      key: 'status',
      header: tr('ws.owner.marketing.cols.status'),
      render: (c) => {
        const late = overdue.toStart.has(c.id) ? 'overdueStart' : overdue.toEnd.has(c.id) ? 'overdueEnd' : null;
        return (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start' }}>
            <StatusBadge tone={campaignTone(c.status)} label={tr(`ws.owner.marketing.statuses.${c.status}`)} />
            {late && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: 'var(--tp-warn-fg)' }}>
                <Icon name="clock" size={12} />
                {tr(`ws.owner.marketing.${late}`)}
              </span>
            )}
          </span>
        );
      },
      truncateTitle: (c) => tr(`ws.owner.marketing.statuses.${c.status}`),
    },
    {
      key: 'window',
      header: tr('ws.owner.marketing.cols.window'),
      render: (c) => {
        const w = windowFromServer(c.starts_at, c.ends_at, VENUE_TZ);
        if (!w.startDate) return <span style={muted}>—</span>;
        return (
          <bdi>
            {w.lastDate
              ? tr('ws.owner.marketing.windowRange', { from: dayLabel(w.startDate, locale), to: dayLabel(w.lastDate, locale) })
              : tr('ws.owner.marketing.windowFrom', { date: dayLabel(w.startDate, locale) })}
          </bdi>
        );
      },
      truncateTitle: (c) => (c.starts_at ? formatDate(new Date(c.starts_at), locale) : '—'),
    },
    {
      key: 'audience',
      header: tr('ws.owner.marketing.cols.audience'),
      render: (c) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <bdi>{c.audience_id ? name(c.audience_en, c.audience_ar) : tr('ws.owner.marketing.noAudience')}</bdi>
          {c.reach != null && <span style={muted}>{tr('ws.owner.marketing.reachLine', { count: formatNumber(c.reach, locale) })}</span>}
        </span>
      ),
      truncateTitle: (c) => (c.audience_id ? name(c.audience_en, c.audience_ar) : tr('ws.owner.marketing.noAudience')),
    },
    {
      key: 'sent',
      header: tr('ws.owner.marketing.cols.sent'),
      numeric: true,
      // No code records a send yet, so a campaign with no send on record says
      // "Not sent" rather than a 0 that reads as "sent to nobody".
      render: (c) =>
        c.performance.sends > 0 || c.performance.lastSentAt ? (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            <span>{formatNumber(c.performance.sends, locale)}</span>
            {c.performance.failed > 0 && (
              <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-danger-fg)' }}>
                {tr('ws.owner.marketing.failedLine', { count: formatNumber(c.performance.failed, locale) })}
              </span>
            )}
          </span>
        ) : (
          <span style={muted}>{tr('ws.owner.marketing.notSent')}</span>
        ),
      truncateTitle: (c) => String(c.performance.sends),
    },
    {
      key: 'result',
      header: tr('ws.owner.marketing.cols.result'),
      numeric: true,
      // The whole point of the screen: an unmeasurable campaign says so, and
      // never prints a number.
      render: (c) =>
        c.performance.attributable ? (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }} title={tr('ws.owner.marketing.revenueHint')}>
            <strong>{c.performance.revenueIqd == null ? '—' : formatIQD(c.performance.revenueIqd, locale)}</strong>
            <span style={muted}>{tr('ws.owner.marketing.redemptionsLine', { count: c.performance.redemptions == null ? '—' : formatNumber(c.performance.redemptions, locale) })}</span>
            {c.performance.discountIqd != null && c.performance.discountIqd > 0 && (
              <span style={muted}>{tr('ws.owner.marketing.discountLine', { amount: formatIQD(c.performance.discountIqd, locale) })}</span>
            )}
          </span>
        ) : (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }} title={tr('ws.owner.marketing.notAttributableHint')}>
            <span style={{ color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{tr('ws.owner.marketing.notAttributable')}</span>
            <span style={muted}>{tr('ws.owner.marketing.noPromotionLine')}</span>
          </span>
        ),
      truncateTitle: (c) =>
        c.performance.attributable ? String(c.performance.revenueIqd ?? '—') : tr('ws.owner.marketing.notAttributable'),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (c) => {
        const moves = nextStatuses(c.status);
        // The forward step is the button; going back and cancelling are the
        // quieter row actions beside it.
        const forward = moves.find((s) => s === 'scheduled' || s === 'live' || s === 'ended');
        const secondary: RowAction[] = moves
          .filter((s) => s !== forward)
          .map((s) => ({
            id: s,
            label: tr(STATUS_ACTION[s] as never),
            icon: s === 'cancelled' ? 'ban' : 'undo',
            danger: s === 'cancelled',
            onSelect: () => requestMove(c, s),
          }));
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {forward && (
              <Button size="sm" busy={move.isPending && move.variables?.id === c.id} onClick={() => requestMove(c, forward)}>
                {tr(STATUS_ACTION[forward] as never)}
              </Button>
            )}
            {isEditable(c.status) && (
              <Button size="sm" kind="ghost" onClick={() => setEditing(c)}>
                {tr('ws.owner.marketing.editCampaign')}
              </Button>
            )}
            <RowActions actions={secondary} label={name(c.name_en, c.name_ar)} />
          </span>
        );
      },
      truncateTitle: () => '',
    },
  ];

  const status = asyncStatus(q, (d) => (d?.campaigns ?? []).length === 0);
  const countOf = (f: PanelFilter) => campaigns.filter((c) => matches(c, f)).length;
  const filterLabel = (f: PanelFilter) => (f === 'fromMarketing' ? tr('ws.supplies.fromMarketing.filter') : tr(`ws.owner.marketing.filter.${f}`));

  return (
    <div>
      <PageHeader
        title={tr('ws.owner.marketing.title')}
        subtitle={tr('ws.owner.marketing.lead')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/admin/promotions' })}>
              {tr('ws.owner.marketing.openPromotions')}
            </Button>
            <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/admin/telegram' })}>
              {tr('ws.owner.marketing.openTelegram')}
            </Button>
            <Button size="sm" kind="primary" icon="plus" onClick={() => setEditing('new')}>
              {tr('ws.owner.marketing.newCampaign')}
            </Button>
          </span>
        }
      />

      {/* What waits on the owner comes first (wave5-addendum-2026-09-25 §5.2):
          marketing's posts to approve, then the campaigns. /marketing is the
          owner's alone, as deciding content is (decideContent), so the route
          is the gate; the sheet's buttons follow app.content_detail's can_*. */}
      <div style={{ marginBlockEnd: 'var(--tp-sp-5)' }}>
        <ContentApprovalPanel />
      </div>

      {campaigns.length > 0 && (
        <Toolbar
          end={
            fromMarketingWaiting > 0 ? (
              <StatusBadge tone="info" icon="spark" label={tr('ws.supplies.fromMarketing.waiting', { count: formatNumber(fromMarketingWaiting, locale) })} />
            ) : undefined
          }
        >
          <SegmentedControl<PanelFilter>
            value={filter}
            onChange={setFilter}
            aria-label={tr('ws.owner.marketing.filter.label')}
            options={filters.map((f) => ({
              value: f,
              label: (
                <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'baseline' }}>
                  {filterLabel(f)}
                  <span style={{ color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(countOf(f), locale)}</span>
                </span>
              ),
            }))}
          />
        </Toolbar>
      )}

      <AsyncStateWrapper
        status={status}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={5} />}
        emptyContent={
          <EmptyState
            icon="spark"
            title={tr('ws.owner.marketing.emptyTitle')}
            body={tr('ws.owner.marketing.emptyBody')}
            action={
              <Button kind="primary" icon="plus" onClick={() => setEditing('new')}>
                {tr('ws.owner.marketing.newCampaign')}
              </Button>
            }
          />
        }
      >
        {shown.length === 0 ? (
          <EmptyState kind="filtered" icon="spark" title={tr('ws.owner.marketing.emptyFiltered')} onClearFilters={() => setFilter('all')} />
        ) : (
          <DataTable columns={columns} rows={shown} rowKey={(c) => c.id} aria-label={tr('ws.owner.marketing.title')} />
        )}
      </AsyncStateWrapper>

      <div style={{ blockSize: 'var(--tp-sp-4)' }} />
      <MarketingRequestsPanel onPhotos={(paths, title) => setPhotos({ title, paths })} />
      <div style={{ blockSize: 'var(--tp-sp-4)' }} />
      {q.data && <AudiencePanel audiences={q.data.audiences} onNew={() => setEditingAudience('new')} onEdit={setEditingAudience} />}

      {editing && (
        <CampaignEditor
          campaign={editing === 'new' ? null : editing}
          audiences={q.data?.audiences ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast.ok(tr('ws.owner.marketing.toast.saved'));
            void qc.invalidateQueries({ queryKey: MARKETING_QUERY_KEY });
          }}
        />
      )}
      {editingAudience && (
        <AudienceEditor
          audience={editingAudience === 'new' ? null : editingAudience}
          onClose={() => setEditingAudience(null)}
          onSaved={() => {
            setEditingAudience(null);
            toast.ok(tr('ws.owner.marketing.toast.audienceSaved'));
            void qc.invalidateQueries({ queryKey: MARKETING_QUERY_KEY });
          }}
        />
      )}
      {photos && <PhotoViewer title={photos.title} paths={photos.paths} onClose={() => setPhotos(null)} />}
      {confirming && (
        <Modal
          title={tr(CONFIRMED_MOVES[confirming.status]!.title as never)}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setConfirming(null)} disabled={move.isPending}>
                {tr('ws.owner.marketing.confirm.keep')}
              </Button>
              <Button
                kind={confirming.status === 'cancelled' ? 'danger' : 'primary'}
                busy={move.isPending}
                onClick={() => move.mutate({ id: confirming.campaign.id, status: confirming.status })}
              >
                {tr(STATUS_ACTION[confirming.status] as never)}
              </Button>
            </>
          }
        >
          <p style={{ marginBlockStart: 0 }}>
            {tr(CONFIRMED_MOVES[confirming.status]!.body as never, {
              name: name(confirming.campaign.name_en, confirming.campaign.name_ar),
              channel: tr(`ws.owner.marketing.channels.${confirming.campaign.channel}`),
            })}
          </p>
        </Modal>
      )}
    </div>
  );
}

/**
 * What staff asked marketing for, and what marketing answered. Read-only:
 * marketing answers on the phone. Its own read, so a failure here leaves the
 * campaigns above untouched.
 */
function MarketingRequestsPanel({ onPhotos }: { onPhotos: (paths: readonly string[], title: string) => void }) {
  const { tr, locale } = useLocale();
  const [filter, setFilter] = useState<RequestFilter>('open');
  const q = useQuery({
    queryKey: ['marketing', 'requests', filter],
    queryFn: () => appRpc<unknown>('marketing_requests_page', { p_filter: filter, p_limit: REQUESTS_SHOWN }),
    refetchInterval: 60_000,
  });
  const data = useMemo(() => readRequests(q.data), [q.data]);
  const today = todayIso();
  const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;
  const pad = { paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)' } as const;

  return (
    <Panel
      title={<CardTitle icon="mail">{tr('ws.supplies.requests.title')}</CardTitle>}
      padded={false}
      data-testid="marketing-requests"
      actions={
        q.isSuccess && data.open_count > 0 ? (
          <StatusBadge tone="warn" label={tr('ws.supplies.requests.waitingBadge', { count: formatNumber(data.open_count, locale) })} />
        ) : undefined
      }
    >
      <div style={{ ...pad, display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <p style={{ ...muted, margin: 0 }}>{tr('ws.supplies.requests.lead')}</p>
        <div>
          <SegmentedControl<RequestFilter>
            size="sm"
            value={filter}
            onChange={setFilter}
            aria-label={tr('ws.supplies.requests.filterLabel')}
            options={REQUEST_FILTERS.map((f) => ({ value: f, label: tr(`ws.supplies.requests.filter.${f}`) }))}
          />
        </div>
      </div>
      {q.isError ? (
        <div style={{ ...pad, display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start', borderBlockStart: '1px solid var(--tp-border)' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      ) : q.isPending ? (
        <p style={{ ...pad, ...muted, margin: 0, borderBlockStart: '1px solid var(--tp-border)' }}>{tr('common.loading')}</p>
      ) : data.requests.length === 0 ? (
        <div style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
          <EmptyState compact titleAs="h3" icon="mail" title={tr(`ws.supplies.requests.empty.${filter}`)} />
        </div>
      ) : (
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {data.requests.map((r) => {
              const late = isPastWanted(r, today);
              const item = locale === 'ar' ? (r.item_name_ar ?? r.item_name_en) : (r.item_name_en ?? r.item_name_ar);
              return (
                <li key={r.id} data-request={r.id} style={{ ...pad, paddingBlock: 'var(--tp-sp-2-5)', display: 'grid', gap: 'var(--tp-sp-1)', borderBlockStart: '1px solid var(--tp-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                    <strong style={{ overflowWrap: 'anywhere', minInlineSize: 0 }}>
                      <bdi>{r.title}</bdi>
                    </strong>
                    <StatusBadge size="sm" tone={REQUEST_TONE[r.status]} label={tr(`work.marketingRequest.status.${r.status}`)} />
                  </div>
                  {/* Each piece of data isolated on its own, so a Latin name keeps its place in an Arabic line. */}
                  <span style={muted} data-asked-by>
                    <bdi>{r.requested_by_name ?? '—'}</bdi>
                    {r.requested_by_role && ` · ${tr(`op.roles.${r.requested_by_role}`)}`}
                    {r.created_at && (
                      <>
                        {' · '}
                        <bdi>{formatDateTime(new Date(r.created_at), locale)}</bdi>
                      </>
                    )}
                    {item && (
                      <>
                        {' · '}
                        <bdi>{tr('ws.supplies.requests.about', { item: isolate(item) })}</bdi>
                      </>
                    )}
                  </span>
                  {r.want_by && (
                    <span style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', color: late ? 'var(--tp-warn-fg)' : muted.color, fontWeight: late ? 600 : undefined }}>
                      <Icon name="calendar" size={12} />
                      <bdi>{tr(late ? 'ws.supplies.requests.wantByLate' : 'ws.supplies.requests.wantBy', { date: dayLabel(r.want_by, locale) })}</bdi>
                    </span>
                  )}
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    <bdi>{r.body}</bdi>
                  </p>
                  {r.photos.length > 0 && (
                    <div>
                      <Button size="sm" kind="ghost" icon="eye" onClick={() => onPhotos(r.photos, tr('ws.supplies.requests.photosTitle', { title: isolate(r.title) }))}>
                        {tr('ws.supplies.requests.photos', { count: formatNumber(r.photos.length, locale) })}
                      </Button>
                    </div>
                  )}
                  {/* The answer sits on the toolbar ground with a hairline all round,
                      not a coloured side stripe: the tint and its own heading line
                      already set it apart from the request above it. */}
                  {r.answer && (
                    <div
                      data-answer
                      style={{
                        display: 'grid',
                        gap: 'var(--tp-sp-0)',
                        marginBlockStart: 'var(--tp-sp-1)',
                        paddingBlock: 'var(--tp-sp-1-5)',
                        paddingInline: 'var(--tp-sp-2-5)',
                        borderRadius: 'var(--tp-radius-ctl)',
                        background: 'var(--tp-surface-2)',
                        border: '1px solid var(--tp-border)',
                      }}
                    >
                      <span style={{ ...muted, fontWeight: 600 }}>
                        <bdi>
                          {tr('ws.supplies.requests.answeredBy', {
                            name: isolate(r.answered_by_name ?? '—'),
                            time: r.answered_at ? formatDateTime(new Date(r.answered_at), locale) : '—',
                          })}
                        </bdi>
                      </span>
                      <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        <bdi>{r.answer}</bdi>
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {data.total > data.requests.length && (
            <p style={{ ...pad, ...muted, margin: 0, borderBlockStart: '1px solid var(--tp-border)' }}>
              {tr('ws.supplies.requests.more', { shown: formatNumber(data.requests.length, locale), total: formatNumber(data.total, locale) })}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/** Audiences are rules, so their reach is a live count, not a stored one. */
function AudiencePanel({
  audiences,
  onNew,
  onEdit,
}: {
  audiences: readonly AudienceRow[];
  onNew: () => void;
  onEdit: (a: AudienceRow) => void;
}) {
  const { tr, locale } = useLocale();
  return (
    <Panel
      title={tr('ws.owner.marketing.audiences')}
      padded={false}
      actions={
        <Button size="sm" icon="plus" onClick={onNew}>
          {tr('ws.owner.marketing.newAudience')}
        </Button>
      }
    >
      <p style={{ paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        {audiences.length === 0 ? tr('ws.owner.marketing.audiencesEmpty') : tr('ws.owner.marketing.audiencesLead')}
      </p>
      {audiences.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {audiences.map((a) => (
            <li
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--tp-sp-3)',
                flexWrap: 'wrap',
                paddingBlock: 'var(--tp-sp-2-5)',
                paddingInline: 'var(--tp-sp-3)',
                borderBlockStart: '1px solid var(--tp-border)',
              }}
            >
              <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 16rem', minInlineSize: 0 }}>
                <strong>
                  <bdi>{locale === 'ar' ? a.nameAr : a.nameEn}</bdi>
                </strong>
                <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                  <RuleSummary rule={readRule(a.rule)} />
                </span>
              </span>
              <span style={{ fontSize: 'var(--tp-fs-sm)', fontVariantNumeric: 'tabular-nums' }}>
                {tr('ws.owner.marketing.audienceReach', { count: formatNumber(a.reach, locale) })}
              </span>
              <Button size="sm" kind="ghost" onClick={() => onEdit(a)}>
                {tr('ws.owner.marketing.editAudience')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RuleSummary({ rule }: { rule: AudienceRule }): ReactNode {
  const { tr, locale } = useLocale();
  const parts = ruleParts(rule);
  if (parts.length === 0) return tr('ws.owner.marketing.ruleSummary.everyone');
  return parts
    .map((p) =>
      'count' in p
        ? tr(`ws.owner.marketing.ruleSummary.${p.key}`, { count: formatNumber(p.count, locale) })
        : tr(`ws.owner.marketing.ruleSummary.${p.key}`),
    )
    .join(' · ');
}

const textAreaStyle = { ...inputStyle, blockSize: 'auto', paddingBlock: 'var(--tp-sp-2)' } as const;

/**
 * Create or edit a campaign. Only reachable for draft and scheduled ones
 * (isEditable) — a campaign people have already received is a historical
 * record, and the server refuses the write with CAMPAIGN_LOCKED regardless.
 *
 * The promotion field is the consequential one: attaching a promotion is what
 * makes the campaign measurable at all, so it is labelled by what it does
 * rather than as an optional extra.
 */
function CampaignEditor({
  campaign,
  audiences,
  onClose,
  onSaved,
}: {
  campaign: CampaignRow | null;
  audiences: readonly AudienceRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { tr, locale } = useLocale();
  const initialWindow = windowFromServer(campaign?.starts_at ?? null, campaign?.ends_at ?? null, VENUE_TZ);
  const [nameEn, setNameEn] = useState(campaign?.name_en ?? '');
  const [nameAr, setNameAr] = useState(campaign?.name_ar ?? '');
  const [channel, setChannel] = useState<MarketingChannel>(campaign?.channel ?? 'telegram');
  const [audienceId, setAudienceId] = useState(campaign?.audience_id ?? '');
  const [promotionId, setPromotionId] = useState(campaign?.promotion_id ?? '');
  const [startDate, setStartDate] = useState(initialWindow.startDate);
  const [lastDate, setLastDate] = useState(initialWindow.lastDate);
  const [bodyEn, setBodyEn] = useState('');
  const [bodyAr, setBodyAr] = useState('');
  const [tried, setTried] = useState(false);

  const promotionsQ = useQuery({ queryKey: PROMOTIONS_KEY, queryFn: fetchPromotions });

  // marketing_overview does not carry the message, so an edit reads it first.
  // Saving before it arrives would write two empty strings over it.
  const bodyQ = useQuery({
    queryKey: ['marketing', 'campaignBody', campaign?.id],
    enabled: campaign !== null,
    queryFn: async () => {
      const { data, error } = await supabase.from('marketing_campaigns').select('body_en, body_ar').eq('id', campaign!.id).single();
      if (error) throw error;
      return data as { body_en: string; body_ar: string };
    },
    staleTime: 0,
  });
  useEffect(() => {
    if (bodyQ.data) {
      setBodyEn(bodyQ.data.body_en ?? '');
      setBodyAr(bodyQ.data.body_ar ?? '');
    }
  }, [bodyQ.data]);
  const bodyReady = campaign === null || bodyQ.isSuccess;

  const namesMissing = nameEn.trim() === '' || nameAr.trim() === '';
  const backwards = windowIsBackwards(startDate, lastDate);
  const invalid = namesMissing || backwards;

  const save = useMutation({
    mutationFn: () => {
      const w = windowToServer(startDate, lastDate, VENUE_TZ, wallTimeToUtc);
      return appRpc('save_marketing_campaign', {
        p_id: campaign?.id ?? null,
        p_name_en: nameEn.trim(),
        p_name_ar: nameAr.trim(),
        p_channel: channel,
        p_audience_id: audienceId || null,
        p_promotion_id: promotionId || null,
        p_starts_at: w.startsAt,
        p_ends_at: w.endsAt,
        p_body_en: bodyEn,
        p_body_ar: bodyAr,
      });
    },
    onSuccess: onSaved,
  });

  function submit() {
    setTried(true);
    if (invalid || !bodyReady) return;
    save.mutate();
  }

  const needsMessage = channel !== 'in_venue';

  return (
    <Modal
      title={tr(campaign ? 'ws.owner.marketing.editCampaign' : 'ws.owner.marketing.newCampaign')}
      onClose={onClose}
      wide
      footer={(close) => (
        <>
          <Button kind="ghost" onClick={close} disabled={save.isPending}>
            {tr('ws.kit.reason.cancel')}
          </Button>
          <Button kind="primary" busy={save.isPending} disabled={!bodyReady} onClick={submit}>
            {tr('ws.owner.marketing.form.save')}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
        <Field label={tr('ws.owner.marketing.form.nameEn')} required error={tried && nameEn.trim() === '' ? tr('ws.owner.marketing.form.nameRequired') : undefined}>
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" style={inputStyle} />
        </Field>
        <Field label={tr('ws.owner.marketing.form.nameAr')} required error={tried && nameAr.trim() === '' ? tr('ws.owner.marketing.form.nameRequired') : undefined}>
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" style={inputStyle} />
        </Field>
        <Field label={tr('ws.owner.marketing.form.channel')} required>
          <Select<MarketingChannel>
            value={channel}
            onChange={setChannel}
            options={(['telegram', 'guest_site', 'in_venue'] as const).map((c) => ({
              value: c,
              label: tr(`ws.owner.marketing.channels.${c}`),
            }))}
          />
        </Field>
        <Field label={tr('ws.owner.marketing.form.audience')}>
          <Select
            value={audienceId}
            onChange={setAudienceId}
            options={[
              { value: '', label: tr('ws.owner.marketing.noAudience') },
              ...audiences.map((a) => ({ value: a.id, label: locale === 'ar' ? a.nameAr : a.nameEn })),
            ]}
          />
        </Field>
        <Field
          label={tr('ws.owner.marketing.form.promotion')}
          hint={promotionId ? undefined : tr('ws.owner.marketing.notAttributableHint')}
        >
          <Select
            value={promotionId}
            onChange={setPromotionId}
            options={[
              { value: '', label: tr('ws.owner.marketing.form.noPromotion') },
              ...(promotionsQ.data ?? []).map((p) => ({
                value: p.id,
                label: locale === 'ar' ? p.name_ar : p.name_en,
              })),
            ]}
          />
        </Field>
        <Field label={tr('ws.owner.marketing.form.startsAt')}>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
        </Field>
        <Field label={tr('ws.owner.marketing.form.endsAt')} error={backwards ? tr('ws.owner.marketing.form.endBeforeStart') : undefined}>
          <input type="date" value={lastDate} min={startDate || undefined} onChange={(e) => setLastDate(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      {!bodyReady && !bodyQ.isError && <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.marketing.form.loadingBody')}</p>}
      {bodyQ.isError && <ErrorText error={bodyQ.error} />}
      <Field label={tr('ws.owner.marketing.form.bodyEn')} hint={needsMessage ? tr('ws.owner.marketing.form.bodyHint') : undefined}>
        <textarea value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} dir="ltr" rows={3} disabled={!bodyReady} style={textAreaStyle} />
      </Field>
      <Field label={tr('ws.owner.marketing.form.bodyAr')}>
        <textarea value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} dir="rtl" rows={3} disabled={!bodyReady} style={textAreaStyle} />
      </Field>
      {save.error != null && <ErrorText error={save.error} />}
    </Modal>
  );
}

/**
 * Create or edit an audience: a RULE the server re-counts on every read, never
 * a list of people. Every limit is optional — an empty rule is every guest.
 */
function AudienceEditor({ audience, onClose, onSaved }: { audience: AudienceRow | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useLocale();
  const initial = readRule(audience?.rule);
  const [nameEn, setNameEn] = useState(audience?.nameEn ?? '');
  const [nameAr, setNameAr] = useState(audience?.nameAr ?? '');
  const [minBookings, setMinBookings] = useState(initial.minBookings ? String(initial.minBookings) : '');
  const [lastSeenDays, setLastSeenDays] = useState(initial.lastSeenDays ? String(initial.lastSeenDays) : '');
  const [lang, setLang] = useState<'' | 'en' | 'ar'>(initial.lang ?? '');
  const [hasPhone, setHasPhone] = useState(initial.hasPhone ?? false);
  const [hasPush, setHasPush] = useState(initial.hasPush ?? false);
  const [tried, setTried] = useState(false);

  const min = parseLimit(minBookings);
  const days = parseLimit(lastSeenDays);
  const namesMissing = nameEn.trim() === '' || nameAr.trim() === '';

  const save = useMutation({
    mutationFn: () => {
      const rule: AudienceRule = {};
      if (min.ok && min.value) rule.minBookings = min.value;
      if (days.ok && days.value) rule.lastSeenDays = days.value;
      if (lang) rule.lang = lang;
      if (hasPhone) rule.hasPhone = true;
      if (hasPush) rule.hasPush = true;
      return appRpc('save_marketing_audience', {
        p_id: audience?.id ?? null,
        p_name_en: nameEn.trim(),
        p_name_ar: nameAr.trim(),
        p_rule: rule,
      });
    },
    onSuccess: onSaved,
  });

  function submit() {
    setTried(true);
    if (namesMissing || !min.ok || !days.ok) return;
    save.mutate();
  }

  const check = { display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', minBlockSize: 'var(--tp-row-h-dense)' } as const;

  return (
    <Modal
      title={tr(audience ? 'ws.owner.marketing.editAudience' : 'ws.owner.marketing.newAudience')}
      onClose={onClose}
      wide
      footer={(close) => (
        <>
          <Button kind="ghost" onClick={close} disabled={save.isPending}>
            {tr('ws.kit.reason.cancel')}
          </Button>
          <Button kind="primary" busy={save.isPending} onClick={submit}>
            {tr('ws.owner.marketing.form.save')}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
        <Field label={tr('ws.owner.marketing.form.nameEn')} required error={tried && nameEn.trim() === '' ? tr('ws.owner.marketing.form.nameRequired') : undefined}>
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" style={inputStyle} />
        </Field>
        <Field label={tr('ws.owner.marketing.form.nameAr')} required error={tried && nameAr.trim() === '' ? tr('ws.owner.marketing.form.nameRequired') : undefined}>
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" style={inputStyle} />
        </Field>
        <Field
          label={tr('ws.owner.marketing.rule.minBookings')}
          optional
          hint={tr('ws.owner.marketing.rule.noLimitHint')}
          error={min.ok ? undefined : tr('ws.owner.marketing.form.wholeNumber')}
        >
          <input value={minBookings} onChange={(e) => setMinBookings(e.target.value)} inputMode="numeric" dir="ltr" style={inputStyle} />
        </Field>
        <Field
          label={tr('ws.owner.marketing.rule.lastSeenDays')}
          optional
          hint={tr('ws.owner.marketing.rule.noLimitHint')}
          error={days.ok ? undefined : tr('ws.owner.marketing.form.wholeNumber')}
        >
          <input value={lastSeenDays} onChange={(e) => setLastSeenDays(e.target.value)} inputMode="numeric" dir="ltr" style={inputStyle} />
        </Field>
        <Field label={tr('ws.owner.marketing.rule.lang')}>
          <Select<'' | 'en' | 'ar'>
            value={lang}
            onChange={setLang}
            options={[
              { value: '', label: tr('ws.owner.marketing.rule.any') },
              { value: 'en', label: tr('ws.owner.marketing.rule.langEn') },
              { value: 'ar', label: tr('ws.owner.marketing.rule.langAr') },
            ]}
          />
        </Field>
      </div>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', marginBlockStart: 'var(--tp-sp-3)' }}>
        <label style={check}>
          <input type="checkbox" checked={hasPhone} onChange={(e) => setHasPhone(e.target.checked)} />
          {tr('ws.owner.marketing.rule.hasPhone')}
        </label>
        <label style={check}>
          <input type="checkbox" checked={hasPush} onChange={(e) => setHasPush(e.target.checked)} />
          {tr('ws.owner.marketing.rule.hasPush')}
        </label>
      </div>
      {save.error != null && <ErrorText error={save.error} />}
    </Modal>
  );
}
