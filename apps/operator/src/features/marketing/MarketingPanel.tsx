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
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { VENUE_TZ, formatDate, formatIQD, formatNumber } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { supabase } from '../../lib/supabase';
import { fetchPromotions, PROMOTIONS_KEY } from '../admin/promotions/promotionsApi';
import { useLocale } from '../../lib/i18n';
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
  const [filter, setFilter] = useState<CampaignFilter>('all');

  const q = useQuery({
    queryKey: MARKETING_QUERY_KEY,
    queryFn: () => appRpc<MarketingOverview>('marketing_overview'),
    refetchInterval: 60_000,
  });

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
  const shown = useMemo(() => campaigns.filter((c) => matchesFilter(c.status, filter)), [campaigns, filter]);
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
      render: (c) => (
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
        </span>
      ),
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
  const countOf = (f: CampaignFilter) => campaigns.filter((c) => matchesFilter(c.status, f)).length;

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

      {campaigns.length > 0 && (
        <Toolbar>
          <SegmentedControl<CampaignFilter>
            value={filter}
            onChange={setFilter}
            aria-label={tr('ws.owner.marketing.filter.label')}
            options={FILTERS.map((f) => ({
              value: f,
              label: (
                <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'baseline' }}>
                  {tr(`ws.owner.marketing.filter.${f}`)}
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
      footer={
        <>
          <Button kind="ghost" onClick={onClose} disabled={save.isPending}>
            {tr('ws.kit.reason.cancel')}
          </Button>
          <Button kind="primary" busy={save.isPending} disabled={!bodyReady} onClick={submit}>
            {tr('ws.owner.marketing.form.save')}
          </Button>
        </>
      }
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
      footer={
        <>
          <Button kind="ghost" onClick={onClose} disabled={save.isPending}>
            {tr('ws.kit.reason.cancel')}
          </Button>
          <Button kind="primary" busy={save.isPending} onClick={submit}>
            {tr('ws.owner.marketing.form.save')}
          </Button>
        </>
      }
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
