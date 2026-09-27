/**
 * Promotions list (spec 06.26) — every promotion, active and inactive.
 * Enable / disable is `app.set_promotion_enabled` behind the shared Switch;
 * there is no delete anywhere: switching off keeps the redemption history.
 *
 * WHY THIS LAYOUT
 *
 * The screen answers "what is running, and what does each one do?".
 *
 *  - One lead states the two rules a manager needs before touching anything
 *    (one promotion per bill, the biggest; off instead of delete). It used to
 *    be a lead, a bare "109 of 109" and an info banner, three blocks saying
 *    overlapping things before the first row.
 *  - Rows are ordered live first, and a filter with counts splits live /
 *    starting later / off / ended. A count appears beside the filter it
 *    belongs to, and a result count only while a search narrows the list.
 *  - Status is ONE cell: the switch and the word that explains it ("Live",
 *    "Starts 12 Sep 2026", "Ended 3 Sep 2026", "Off"). The old table had a
 *    Status badge and an Enabled switch side by side, which said "Off" twice.
 *  - "When" prints dates, weekdays and hours together, so a Fri–Sat
 *    16:00–19:00 happy hour no longer reads as "No end date" (always on).
 *  - "Applies to" says how a bill gets it (no code / its code) and what it
 *    covers, in words. The old chip literally read "What it applies to".
 *  - A row opens the editor, and has a chevron that says so.
 *
 * A MANAGER PROPOSES (#57, build-contracts-2026-09-23 §5.5). The owner alone
 * edits promotions here (`editPromotions`); a manager gets "Propose a
 * promotion" and, on a switched-off row that has not ended, "Switch on",
 * both starting a price or promo change on /protocols, in place of a notice
 * that names the owner.
 * Switching a promotion off stays a manager's own, so the switch still works
 * on a live row.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { formatNumber } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { usePermissions, requiredRoleFor } from '../../../lib/auth';
import { Button } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  LocalizedRecordText,
  Money,
  PageHeader,
  PermissionRefusedNotice,
  ResultCount,
  SearchField,
  SegmentedControl,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  type Column,
} from '../../../components/kit';
import { ChevronForward, Icon } from '../../../components/icons';
import { Switch } from '../../../components/Switch';
import { PriceChangeButton, PriceLockNote, usePriceChangeStart } from './PriceChangeStart';
import {
  LIFECYCLES,
  countByLifecycle,
  filterPromotions,
  fromRow,
  howItApplies,
  howText,
  isPromotionFilter,
  lifecycle,
  scheduleText,
  scopeText,
  sortPromotions,
  statusText,
  type PromotionFilter,
} from './promotionLogic';
import { PROMOTIONS_KEY, fetchPromotions, type PromotionRow } from './promotionsApi';

const FILTERS = ['all', ...LIFECYCLES] as const satisfies readonly PromotionFilter[];

const muted = { fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' } as const;

export function PromotionsListScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = usePermissions();
  // A manager: new promotions, edits and switch-ons go through a change.
  const start = usePriceChangeStart();
  const proposes = !can.editPromotions && start !== null;
  const search = (useSearch({ strict: false }) ?? {}) as { show?: unknown };
  const filter: PromotionFilter = isPromotionFilter(search.show) ? search.show : 'all';
  const [query, setQuery] = useState('');

  const promosQ = useQuery({ queryKey: PROMOTIONS_KEY, queryFn: fetchPromotions });
  const rows = promosQ.data ?? [];
  const status = asyncStatus(promosQ, (r) => r.length === 0);

  // One clock for the whole render, so a row's filter bucket, sort position
  // and status word can never disagree.
  const now = new Date();
  const counts = countByLifecycle(rows, now);
  const shown = sortPromotions(filterPromotions(rows, filter, query, now), locale, now);

  const setFilter = (next: PromotionFilter) =>
    void navigate({ to: '/admin/promotions', search: next === 'all' ? {} : { show: next }, replace: true });

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
      header: tr('ws.manager.promotions.discount'),
      numeric: true,
      render: (p) => (p.type === 'percent' ? <span dir="ltr">{formatNumber(p.value, locale)}%</span> : <Money amount={p.value} />),
    },
    {
      key: 'when',
      header: tr('ws.manager.promotions.when'),
      render: (p) => {
        const draft = fromRow(p);
        const text = scheduleText(draft, tr, locale);
        const always = !draft.startsOn && !draft.endsOn && !draft.hourFrom && (draft.weekdays.length === 0 || draft.weekdays.length === 7);
        return <bdi style={always ? muted : { fontSize: 'var(--tp-fs-sm)' }}>{text}</bdi>;
      },
    },
    {
      key: 'applies',
      header: tr('ws.manager.promotions.appliesTo'),
      render: (p) => {
        const draft = fromRow(p);
        const how = howItApplies(draft);
        return (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--tp-sp-1)',
                fontSize: 'var(--tp-fs-sm)',
                // The one case worth colour: a code-only promotion with no code
                // can never apply.
                color: how.kind === 'missing' ? 'var(--tp-warn-fg)' : 'var(--tp-fg)',
                fontWeight: how.kind === 'missing' ? 600 : 400,
              }}
            >
              {how.kind !== 'auto' && <Icon name={how.kind === 'missing' ? 'alert' : 'tag'} size={13} />}
              <bdi>{howText(draft, tr)}</bdi>
            </span>
            <span style={muted}>{scopeText(draft.scope, tr, locale)}</span>
          </span>
        );
      },
    },
    {
      key: 'status',
      header: tr('ws.manager.promotions.status'),
      // No stopPropagation wrapper: DataTable ignores a row click that started
      // on a control inside a cell, so switching a promotion off does not also
      // open its editor.
      render: (p) => {
        const lc = lifecycle(p, now);
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', whiteSpace: 'nowrap' }}>
            <Switch
              checked={p.enabled}
              // Off stays direct for a manager; on is a promotion_enable change.
              disabled={!can.editPromotions && !p.enabled}
              onChange={(next) => setEnabled(p.id, next)}
              label={tr('ws.manager.promotions.switchFor', { name: locale === 'ar' ? p.name_ar : p.name_en })}
              hideLabel
            />
            <span
              style={{
                fontSize: 'var(--tp-fs-sm)',
                fontWeight: lc === 'live' ? 600 : 400,
                color: lc === 'live' ? 'var(--tp-success-fg)' : 'var(--tp-muted-fg)',
              }}
            >
              {statusText(p, tr, locale, now)}
            </span>
            {/* Off, not ended: an ended one comes back through its dates, in the editor. */}
            {proposes && lc === 'disabled' && (
              <PriceChangeButton
                size="sm"
                kind="ghost"
                target={{ change: 'promotion_enable', promotion: p.id }}
                label={tr('ws.pricing.promotions.switchOn')}
                ariaLabel={tr('ws.pricing.promotions.switchOnFor', { name: locale === 'ar' ? p.name_ar : p.name_en })}
              />
            )}
          </span>
        );
      },
    },
    {
      key: 'open',
      header: '',
      width: '2rem',
      align: 'end',
      render: () => <ChevronForward size={16} style={{ color: 'var(--tp-muted-fg)', verticalAlign: 'middle' }} />,
    },
  ];

  const newButton = proposes ? (
    <PriceChangeButton kind="primary" icon="plus" target={{ change: 'promotion' }} label={tr('ws.pricing.promotions.propose')} />
  ) : (
    <Button kind="primary" icon="plus" disabled={!can.editPromotions} onClick={() => openEditor('new')}>
      {tr('ws.manager.promotions.create')}
    </Button>
  );

  return (
    <div>
      <PageHeader title={tr('ws.manager.promotions.title')} subtitle={tr('ws.manager.promotions.lead')} actions={newButton}>
        {proposes ? (
          <PriceLockNote message={tr('ws.pricing.promotions.note')} />
        ) : (
          !can.editPromotions && <PermissionRefusedNotice action={tr('ws.manager.promotions.create')} requiredRole={requiredRoleFor('editPromotions')} />
        )}
      </PageHeader>

      <AsyncStateWrapper
        status={status}
        error={promosQ.error}
        onRetry={() => void promosQ.refetch()}
        skeleton={<TableSkeleton columns={columns} />}
        emptyContent={<EmptyState icon="tag" title={tr('ws.manager.promotions.empty')} body={tr('ws.manager.promotions.emptyBody')} action={newButton} />}
      >
        <Toolbar>
          <SegmentedControl
            aria-label={tr('ws.manager.promotions.filterLabel')}
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({
              value: f,
              label: (
                <>
                  {tr(`ws.manager.promotions.filter.${f}`)}
                  {/* The margin parts the count from its word on screen ("All37"
                      read as one token); the space parts it for a screen reader. */}
                  <span style={{ marginInlineStart: 'var(--tp-sp-1-5)', fontWeight: 400, color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
                    {' '}
                    {formatNumber(counts[f], locale)}
                  </span>
                </>
              ),
            }))}
          />
          <SearchField value={query} onChange={setQuery} placeholder={tr('ws.manager.promotions.search')} style={{ inlineSize: '18rem', maxInlineSize: '100%' }} />
          {query.trim() !== '' && <ResultCount shown={shown.length} total={filter === 'all' ? rows.length : counts[filter]} />}
        </Toolbar>
        {shown.length === 0 ? (
          <EmptyState
            kind="filtered"
            title={tr('ws.manager.promotions.noMatch')}
            onClearFilters={() => {
              setQuery('');
              setFilter('all');
            }}
          />
        ) : (
          <DataTable columns={columns} rows={shown} rowKey={(p) => p.id} onRowClick={(p) => openEditor(p.id)} aria-label={tr('ws.manager.promotions.title')} />
        )}
      </AsyncStateWrapper>
    </div>
  );
}
