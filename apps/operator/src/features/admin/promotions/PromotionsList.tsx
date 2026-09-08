/**
 * Promotions list (spec 06.26) — every promotion, active and inactive.
 * Enable / disable is `app.set_promotion_enabled` behind the shared Switch;
 * there is no delete anywhere: switching off keeps the redemption history.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDate, formatNumber } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { usePermissions, requiredRoleFor } from '../../../lib/auth';
import { Button } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  LocalizedRecordText,
  MessagePresenter,
  Money,
  PageHeader,
  PermissionRefusedNotice,
  ResultCount,
  StatusBadge,
  TableSkeleton,
  asyncStatus,
  type Column,
  type Tone,
} from '../../../components/kit';
import { Switch } from '../../../components/Switch';
import { hasScope, lifecycle, type PromotionLifecycle } from './promotionLogic';
import { PROMOTIONS_KEY, fetchPromotions, type PromotionRow } from './promotionsApi';

const LIFECYCLE_TONE: Record<PromotionLifecycle, Tone> = {
  live: 'success',
  scheduled: 'info',
  expired: 'neutral',
  disabled: 'neutral',
};

export function PromotionsListScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = usePermissions();

  const promosQ = useQuery({ queryKey: PROMOTIONS_KEY, queryFn: fetchPromotions });
  const rows = promosQ.data ?? [];
  const status = asyncStatus(promosQ, (r) => r.length === 0);

  async function setEnabled(id: string, enabled: boolean) {
    await appRpc('set_promotion_enabled', { p_id: id, p_enabled: enabled });
    await queryClient.invalidateQueries({ queryKey: PROMOTIONS_KEY });
  }

  const openEditor = (id: string) => void navigate({ to: '/admin/promotions/$id', params: { id } });

  const columns: Column<PromotionRow>[] = [
    {
      key: 'name',
      header: tr('ws.manager.promotions.name'),
      render: (p) => (
        <span style={{ fontWeight: 600 }}>
          <LocalizedRecordText record={{ en: p.name_en, ar: p.name_ar }} />
        </span>
      ),
    },
    {
      key: 'value',
      header: tr('ws.manager.promotions.value'),
      numeric: true,
      render: (p) => (p.type === 'percent' ? <span dir="ltr">{formatNumber(p.value, locale)}%</span> : <Money amount={p.value} />),
    },
    {
      key: 'window',
      header: tr('ws.manager.promotions.window'),
      render: (p) => <WindowText row={p} />,
    },
    {
      key: 'applies',
      header: tr('ws.manager.promotions.applies'),
      render: (p) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
          <StatusBadge size="sm" tone={p.auto ? 'accent' : 'neutral'} dot={false} label={p.auto ? tr('ws.manager.promotions.auto') : tr('ws.manager.promotions.staffSelected')} />
          {p.public_code && (
            <StatusBadge
              size="sm"
              tone="neutral"
              dot={false}
              icon="tag"
              label={`${tr('ws.manager.promotions.code', { code: p.public_code })}${p.code_single_use ? ` · ${tr('ws.manager.promotions.singleUse')}` : ''}`}
            />
          )}
          {hasScope({ courtIds: p.scope?.courtIds ?? [], categoryIds: p.scope?.categoryIds ?? [], itemIds: p.scope?.itemIds ?? [] }) && (
            <StatusBadge size="sm" tone="neutral" dot={false} icon="layers" label={tr('ws.manager.promotions.editor.scopeTitle')} />
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: tr('ws.manager.promotions.status'),
      render: (p) => {
        const lc = lifecycle(p);
        return <StatusBadge tone={LIFECYCLE_TONE[lc]} label={tr(`ws.manager.promotions.${lc}`)} size="sm" />;
      },
    },
    {
      key: 'enabled',
      header: tr('ws.manager.promotions.enabled'),
      align: 'end',
      // No stopPropagation wrapper: DataTable now ignores a row click that
      // started on a control inside a cell, so switching a promotion off no
      // longer also opens its editor.
      render: (p) => (
        <Switch
          checked={p.enabled}
          disabled={!can.editPromotions}
          onChange={(next) => setEnabled(p.id, next)}
          label={`${tr('ws.manager.promotions.enabled')} — ${locale === 'ar' ? p.name_ar : p.name_en}`}
          hideLabel
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tr('ws.manager.promotions.title')}
        subtitle={tr('ws.manager.promotions.lead')}
        actions={
          <Button kind="primary" icon="plus" disabled={!can.editPromotions} onClick={() => openEditor('new')}>
            {tr('ws.manager.promotions.create')}
          </Button>
        }
      >
        {/* Rulebook 6.10: the count belongs beside the title, not only under the table. */}
        <ResultCount shown={rows.length} total={rows.length} />
        <MessagePresenter tone="info" message={tr('ws.manager.promotions.bestOnly')} />
        {!can.editPromotions && <PermissionRefusedNotice action={tr('ws.manager.promotions.create')} requiredRole={requiredRoleFor('editPromotions')} />}
      </PageHeader>

      <AsyncStateWrapper
        status={status}
        error={promosQ.error}
        onRetry={() => void promosQ.refetch()}
        skeleton={<TableSkeleton columns={columns} />}
        emptyContent={
          <EmptyState
            icon="tag"
            title={tr('ws.manager.promotions.empty')}
            body={tr('ws.manager.promotions.emptyBody')}
            action={
              <Button kind="primary" icon="plus" disabled={!can.editPromotions} onClick={() => openEditor('new')}>
                {tr('ws.manager.promotions.create')}
              </Button>
            }
          />
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          onRowClick={(p) => openEditor(p.id)}
          aria-label={tr('ws.manager.promotions.title')}
        />
      </AsyncStateWrapper>
    </div>
  );
}

function WindowText({ row }: { row: PromotionRow }) {
  const { tr, locale } = useLocale();
  const from = row.starts_at ? formatDate(new Date(row.starts_at), locale) : null;
  const to = row.ends_at ? formatDate(new Date(row.ends_at), locale) : null;
  if (!from && !to) return <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.promotions.noEnd')}</span>;
  return (
    <span style={{ fontSize: 'var(--tp-fs-sm)' }}>
      {from && <bdi>{tr('ws.manager.promotions.from', { date: from })}</bdi>}
      {from && to && ' · '}
      {to && <bdi>{tr('ws.manager.promotions.until', { date: to })}</bdi>}
    </span>
  );
}
