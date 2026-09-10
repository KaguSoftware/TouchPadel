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
 * it gets believed and then budgeted against.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDate, formatIQD, formatNumber } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { fetchPromotions, PROMOTIONS_KEY } from '../admin/promotions/promotionsApi';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, Field, Modal, Select } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  type Column,
} from '../../components/kit';
import {
  MARKETING_QUERY_KEY,
  campaignTone,
  isEditable,
  nextStatuses,
  type AudienceRow,
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

export function MarketingPanelScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<CampaignRow | 'new' | null>(null);

  const q = useQuery({
    queryKey: MARKETING_QUERY_KEY,
    queryFn: () => appRpc<MarketingOverview>('marketing_overview'),
    refetchInterval: 60_000,
  });

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CampaignStatus }) =>
      appRpc('set_campaign_status', { p_id: id, p_status: status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MARKETING_QUERY_KEY });
    },
    // toast.err runs the shared code -> message mapper (lib/errors.ts), so
    // BAD_TRANSITION and CAMPAIGN_LOCKED read as sentences, not codes.
    onError: (e) => toast.err(e),
  });

  const campaigns = q.data?.campaigns ?? [];
  const counts = q.data?.counts;
  const name = (en: string | null, ar: string | null) => (locale === 'ar' ? (ar ?? en ?? '—') : (en ?? ar ?? '—'));

  const columns: Column<CampaignRow>[] = [
      {
        key: 'campaign',
        header: tr('ws.owner.marketing.cols.campaign'),
        render: (c) => (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            <span style={{ fontWeight: 600 }}>{name(c.name_en, c.name_ar)}</span>
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
              {tr(`ws.owner.marketing.channels.${c.channel}`)}
            </span>
          </span>
        ),
        truncateTitle: (c) => name(c.name_en, c.name_ar),
      },
      {
        key: 'status',
        header: tr('ws.owner.marketing.cols.status'),
        render: (c) => (
          <StatusBadge tone={campaignTone(c.status)} label={tr(`ws.owner.marketing.statuses.${c.status}`)} />
        ),
        truncateTitle: (c) => tr(`ws.owner.marketing.statuses.${c.status}`),
      },
      {
        key: 'window',
        header: tr('ws.owner.marketing.cols.window'),
        render: (c) =>
          c.starts_at
            ? `${formatDate(new Date(c.starts_at), locale)}${c.ends_at ? ` → ${formatDate(new Date(c.ends_at), locale)}` : ''}`
            : '—',
        truncateTitle: (c) => (c.starts_at ? formatDate(new Date(c.starts_at), locale) : '—'),
      },
      {
        key: 'audience',
        header: tr('ws.owner.marketing.cols.audience'),
        render: (c) => (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            <span>{c.audience_id ? name(c.audience_en, c.audience_ar) : tr('ws.owner.marketing.noAudience')}</span>
            {c.reach != null && (
              <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                {formatNumber(c.reach, locale)}
              </span>
            )}
          </span>
        ),
        truncateTitle: (c) => (c.audience_id ? name(c.audience_en, c.audience_ar) : tr('ws.owner.marketing.noAudience')),
      },
      {
        key: 'sent',
        header: tr('ws.owner.marketing.cols.sent'),
        numeric: true,
        render: (c) => formatNumber(c.performance.sends, locale),
        truncateTitle: (c) => String(c.performance.sends),
      },
      {
        key: 'redemptions',
        header: tr('ws.owner.marketing.cols.redemptions'),
        numeric: true,
        // The whole point of the screen: an unmeasurable campaign says so.
        render: (c) =>
          c.performance.attributable ? (
            formatNumber(c.performance.redemptions ?? 0, locale)
          ) : (
            <span style={{ color: 'var(--tp-muted-fg)' }} title={tr('ws.owner.marketing.notAttributableHint')}>
              {tr('ws.owner.marketing.notAttributable')}
            </span>
          ),
        truncateTitle: (c) =>
          c.performance.attributable ? String(c.performance.redemptions ?? 0) : tr('ws.owner.marketing.notAttributable'),
      },
      {
        key: 'revenue',
        header: tr('ws.owner.marketing.cols.revenue'),
        numeric: true,
        render: (c) =>
          c.performance.attributable && c.performance.revenueIqd != null
            ? formatIQD(c.performance.revenueIqd, locale)
            : '—',
        truncateTitle: (c) => (c.performance.revenueIqd == null ? '—' : String(c.performance.revenueIqd)),
      },
      {
        key: 'actions',
        header: '',
        align: 'end',
        render: (c) => (
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {isEditable(c.status) && (
              <Button size="sm" kind="ghost" onClick={() => setEditing(c)}>
                {tr('ws.owner.marketing.editCampaign')}
              </Button>
            )}
            {nextStatuses(c.status).map((next) => (
              <Button
                key={next}
                size="sm"
                kind={next === 'cancelled' ? 'ghost' : 'primary'}
                busy={move.isPending}
                onClick={() => move.mutate({ id: c.id, status: next })}
              >
                {tr(STATUS_ACTION[next] as never)}
              </Button>
            ))}
          </span>
        ),
        truncateTitle: () => '',
      },
  ];

  const status = asyncStatus(q, (d) => (d?.campaigns ?? []).length === 0);

  return (
    <div>
      <PageHeader
        title={tr('ws.owner.marketing.title')}
        subtitle={tr('ws.owner.marketing.lead')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)' }}>
            <Button size="sm" icon="plus" onClick={() => setEditing('new')}>
              {tr('ws.owner.marketing.newCampaign')}
            </Button>
            <Button size="sm" kind="ghost" icon="tag" onClick={() => void navigate({ to: '/admin/promotions' })}>
              {tr('ws.owner.marketing.openPromotions')}
            </Button>
            <Button size="sm" kind="ghost" icon="phone" onClick={() => void navigate({ to: '/admin/telegram' })}>
              {tr('ws.owner.marketing.openTelegram')}
            </Button>
          </span>
        }
      />

      {counts && (
        <Toolbar>
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-4)', fontSize: 'var(--tp-fs-sm)' }}>
            <span>
              <strong>{formatNumber(counts.live, locale)}</strong> {tr('ws.owner.marketing.counts.live')}
            </span>
            <span>
              <strong>{formatNumber(counts.scheduled, locale)}</strong> {tr('ws.owner.marketing.counts.scheduled')}
            </span>
            <span>
              <strong>{formatNumber(counts.draft, locale)}</strong> {tr('ws.owner.marketing.counts.draft')}
            </span>
          </span>
        </Toolbar>
      )}

      <AsyncStateWrapper
        status={status}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={5} />}
        emptyContent={
          <EmptyState
            icon="chart"
            title={tr('ws.owner.marketing.emptyTitle')}
            body={tr('ws.owner.marketing.emptyBody')}
          />
        }
      >
        <DataTable columns={columns} rows={campaigns} rowKey={(c) => c.id} />
      </AsyncStateWrapper>

      <div style={{ blockSize: 'var(--tp-sp-4)' }} />
      <AudiencePanel audiences={q.data?.audiences ?? []} />

      {editing && (
        <CampaignEditor
          campaign={editing === 'new' ? null : editing}
          audiences={q.data?.audiences ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: MARKETING_QUERY_KEY });
          }}
        />
      )}
    </div>
  );
}

/** Audiences are rules, so their reach is a live count, not a stored one. */
function AudiencePanel({ audiences }: { audiences: readonly AudienceRow[] }) {
  const { tr, locale } = useLocale();
  if (audiences.length === 0) return null;
  return (
    <Panel title={tr('ws.owner.marketing.audiences')} padded={false}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {audiences.map((a) => (
          <li
            key={a.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--tp-sp-3)',
              paddingBlock: 'var(--tp-sp-2-5)',
              paddingInline: 'var(--tp-sp-3)',
              borderBlockEnd: '1px solid var(--tp-border)',
            }}
          >
            <span style={{ fontWeight: 600 }}>{locale === 'ar' ? a.nameAr : a.nameEn}</span>
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
              {tr('ws.owner.marketing.audienceReach', { count: formatNumber(a.reach, locale) })}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

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
  const toast = useToast();
  const [nameEn, setNameEn] = useState(campaign?.name_en ?? '');
  const [nameAr, setNameAr] = useState(campaign?.name_ar ?? '');
  const [channel, setChannel] = useState<MarketingChannel>(campaign?.channel ?? 'telegram');
  const [audienceId, setAudienceId] = useState(campaign?.audience_id ?? '');
  const [promotionId, setPromotionId] = useState(campaign?.promotion_id ?? '');
  const [startsAt, setStartsAt] = useState(campaign?.starts_at?.slice(0, 10) ?? '');
  const [endsAt, setEndsAt] = useState(campaign?.ends_at?.slice(0, 10) ?? '');
  const [bodyEn, setBodyEn] = useState('');
  const [bodyAr, setBodyAr] = useState('');

  const promotionsQ = useQuery({ queryKey: PROMOTIONS_KEY, queryFn: fetchPromotions });

  const save = useMutation({
    mutationFn: () =>
      appRpc('save_marketing_campaign', {
        p_id: campaign?.id ?? null,
        p_name_en: nameEn,
        p_name_ar: nameAr,
        p_channel: channel,
        p_audience_id: audienceId || null,
        p_promotion_id: promotionId || null,
        p_starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        p_ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        p_body_en: bodyEn,
        p_body_ar: bodyAr,
      }),
    onSuccess: onSaved,
    onError: (e) => toast.err(e),
  });

  const dateStyle = {
    inlineSize: '100%',
    font: 'inherit',
    padding: 'var(--tp-sp-2)',
    borderRadius: 'var(--tp-radius-ctl)',
    border: '1px solid var(--tp-border)',
    background: 'var(--tp-surface)',
    color: 'var(--tp-fg)',
  } as const;

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
          <Button kind="primary" busy={save.isPending} onClick={() => save.mutate()}>
            {tr('ws.owner.marketing.form.save')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
        <Field label={tr('ws.owner.marketing.form.nameEn')} required>
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} style={dateStyle} />
        </Field>
        <Field label={tr('ws.owner.marketing.form.nameAr')} required>
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" style={dateStyle} />
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
          <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={dateStyle} />
        </Field>
        <Field label={tr('ws.owner.marketing.form.endsAt')}>
          <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={dateStyle} />
        </Field>
      </div>
      <Field label={tr('ws.owner.marketing.form.bodyEn')}>
        <textarea value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} rows={3} style={dateStyle} />
      </Field>
      <Field label={tr('ws.owner.marketing.form.bodyAr')}>
        <textarea value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} dir="rtl" rows={3} style={dateStyle} />
      </Field>
    </Modal>
  );
}
