/**
 * Protocols (/protocols) — manager and owner (ROUTE_ROLES;
 * build-contracts-2026-09-23 §5.4).
 *
 * Six cards: the four protocols — New item, Tournament, Hiring, Price or
 * promo change — each with how many are running and how many wait on you, and
 * Start; then Daily checklists (I's ChecklistsCard) and Recipe changes (the
 * role spec's, #71). The owner also gets "How it works" on each protocol card,
 * and the New item card carries the ideas waiting from the team (#65), each of
 * which starts a release prefilled from it (`?start=product_release&idea=`). Below them, the runs: Waiting on you, In
 * progress and Finished, in the staff requests' layout (a filter strip over a
 * table). A run opens its sheet: the steps in order and the chosen step's form
 * and decision.
 *
 * What is open lives in the URL (§5.1): `?run=&step=` for a run sheet,
 * `?start=` (with its prefills) for a start form, `?filter=` for the list, so
 * the menu editor, the pricing screens, Goods in and a push all link straight
 * to the right sheet, and Back closes it.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { formatDate, formatNumber, type MessageKey } from '@touch/i18n';
import { priceChangeKinds, type ProtocolKind, type RunRow, type TournamentVariant } from '@touch/core/protocols';
import { can, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Select } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  PageHeader,
  Pagination,
  Panel,
  SegmentedControl,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  type Column,
} from '../../components/kit';
import type { IconName } from '../../components/icons';
import { CardTitle, MARK_FG } from '../ops/OpsVisuals';
import { ChecklistsCard } from '../checklists/ChecklistsCard';
import { IdeasFromTeamButton } from '../roleExtras/Ideas';
import { RecipeChangesCard } from '../roleExtras/RecipeChanges';
import { RUNS_PAGE_SIZE, useOverview, useRunsPage } from './api';
import { HowItWorksSheet } from './HowItWorks';
import { pickText, protocolCards, runStatusTone, type ProtocolCard } from './protocolLogic';
import { RunSheet } from './RunSheet';
import { StartSheet } from './StartSheet';
import { StepSheet } from './StepPanel';
import { PROTOCOL_KINDS, type ProtocolFilter, type ProtocolsSearch } from './search';

const CARD_ICON: Record<ProtocolKind, IconName> = {
  product_release: 'spark',
  tournament: 'court',
  hiring: 'userPlus',
  price_promo: 'tag',
};

/** The params a start form reads; closing it drops them all. */
const START_PARAMS = ['start', 'variant', 'change', 'item', 'addon', 'promotion', 'rule', 'idea'] as const;

export function ProtocolsPageScreen() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as ProtocolsSearch;
  const owner = can(staff?.role, 'editProtocols');
  const overview = useOverview();
  const cards = useMemo(() => protocolCards(overview.data ?? []), [overview.data]);
  const [how, setHow] = useState<ProtocolCard | null>(null);

  const setSearch = (patch: Partial<Record<keyof ProtocolsSearch, string | undefined>>) =>
    void navigate({
      to: '/protocols',
      search: (prev: ProtocolsSearch) => {
        const next: Record<string, unknown> = { ...prev, ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        return next as ProtocolsSearch;
      },
    });
  const closeStart = () => setSearch(Object.fromEntries(START_PARAMS.map((k) => [k, undefined])));

  return (
    <div data-testid="protocols-page">
      <PageHeader title={tr('ws.protocols.title')} subtitle={tr('ws.protocols.lead')} />

      <section
        aria-label={tr('ws.protocols.cards.label')}
        style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', marginBlockEnd: 'var(--tp-sp-5)' }}
      >
        {cards.map((c) => (
          <ProtocolCardView
            key={c.kind}
            card={c}
            loading={overview.isPending}
            owner={owner}
            onStart={() => setSearch({ start: c.kind })}
            onHow={() => setHow(c)}
            onWaiting={() => setSearch({ filter: 'waiting' })}
            extra={c.kind === 'product_release' ? <IdeasFromTeamButton onStart={(idea) => setSearch({ start: 'product_release', idea: idea.id })} /> : null}
          />
        ))}
        <ChecklistsCard />
        <RecipeChangesCard openId={search.recipeChange ?? null} onOpenChange={(id) => setSearch({ recipeChange: id ?? undefined })} />
      </section>
      {overview.isError && <ErrorText error={overview.error} />}

      <RunLists
        filter={search.filter ?? 'waiting'}
        waitingCount={cards.reduce((s, c) => s + c.waiting, 0)}
        onFilter={(f) => setSearch({ filter: f })}
        onOpen={(run) => setSearch({ run: run.id, step: undefined })}
      />

      {search.start && (
        <StartSheet
          key={`${search.start}:${search.change ?? ''}:${search.idea ?? ''}`}
          kind={search.start}
          variant={search.variant as TournamentVariant | undefined}
          change={search.change}
          link={{ item: search.item, addon: search.addon, promotion: search.promotion, rule: search.rule }}
          ideaId={search.idea}
          changeChoices={priceChangeKinds(staff?.role)}
          onClose={closeStart}
          onStarted={(runId) => setSearch({ ...Object.fromEntries(START_PARAMS.map((k) => [k, undefined])), run: runId, step: undefined })}
        />
      )}
      {search.run && !search.start && (
        <RunSheet runId={search.run} stepId={search.step ?? null} onStep={(id) => setSearch({ step: id })} onClose={() => setSearch({ run: undefined, step: undefined })} />
      )}
      {search.step && !search.run && !search.start && <StepSheet stepId={search.step} onClose={() => setSearch({ step: undefined })} />}
      {how && <HowItWorksSheet kind={how.kind} templates={how.templates} variant={search.variant as TournamentVariant | undefined} onClose={() => setHow(null)} />}
    </div>
  );
}

function ProtocolCardView({
  card,
  loading,
  owner,
  onStart,
  onHow,
  onWaiting,
  extra,
}: {
  card: ProtocolCard;
  loading: boolean;
  owner: boolean;
  onStart: () => void;
  onHow: () => void;
  onWaiting: () => void;
  /** A line of the card's own below its counts (the ideas from the team). */
  extra?: ReactNode;
}) {
  const { tr, locale } = useLocale();
  const kindName = tr(`work.protocol.kind.${card.kind}`);
  return (
    <Panel fill title={<CardTitle icon={CARD_ICON[card.kind]}>{kindName}</CardTitle>} data-testid={`protocol-card-${card.kind}`}>
      {/* The buttons sit at the foot of every card, level across the row. */}
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', flex: 1, alignContent: 'space-between' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr(`ws.protocols.cards.lead.${card.kind}` as MessageKey)}</p>
          {loading ? (
            <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('common.loading')}</p>
          ) : (
            <p style={{ margin: 0, display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 600 }}>{tr('ws.protocols.cards.running', { count: formatNumber(card.running, locale) })}</span>
              <span aria-hidden="true" style={{ color: 'var(--tp-muted-fg)' }}>
                ·
              </span>
              {card.waiting > 0 ? (
                <button
                  type="button"
                  onClick={onWaiting}
                  style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: MARK_FG.warn, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  {tr('ws.protocols.cards.waiting', { count: formatNumber(card.waiting, locale) })}
                </button>
              ) : (
                <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.protocols.cards.waiting', { count: formatNumber(0, locale) })}</span>
              )}
            </p>
          )}
          {card.finished30d > 0 && (
            <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.cards.finished', { count: formatNumber(card.finished30d, locale) })}</p>
          )}
          {extra && <div>{extra}</div>}
        </div>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', justifyContent: 'flex-end', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-1)' }}>
          {owner && (
            <Button size="sm" kind="ghost" icon="settings" disabled={card.templates.length === 0} onClick={onHow} data-testid={`how-${card.kind}`}>
              {tr('ws.protocols.cards.howItWorks')}
            </Button>
          )}
          <Button size="sm" kind="primary" icon="play" onClick={onStart} aria-label={tr('ws.protocols.cards.startKind', { kind: kindName })} data-testid={`start-${card.kind}`}>
            {tr('work.protocol.action.start')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

const FILTERS: ProtocolFilter[] = ['waiting', 'active', 'finished'];

function RunLists({
  filter,
  waitingCount,
  onFilter,
  onOpen,
}: {
  filter: ProtocolFilter;
  waitingCount: number;
  onFilter: (f: ProtocolFilter) => void;
  onOpen: (run: RunRow) => void;
}) {
  const { tr, locale } = useLocale();
  const [kind, setKind] = useState<ProtocolKind | ''>('');
  const [page, setPage] = useState(0);
  const q = useRunsPage(filter, kind === '' ? null : kind, page);
  const rows = q.data?.runs ?? [];
  const pageCount = Math.ceil((q.data?.total ?? 0) / RUNS_PAGE_SIZE);

  const columns: Column<RunRow>[] = [
    {
      key: 'title',
      header: tr('ws.protocols.lists.cols.title'),
      render: (r) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <bdi style={{ fontWeight: 600 }}>{pickText(locale, r.title_en, r.title_ar) || tr(`work.protocol.kind.${r.kind}`)}</bdi>
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
            {tr(`work.protocol.kind.${r.kind}`)}
            {r.variant ? ` · ${tr(`work.protocol.variant.${r.variant}`)}` : ''}
          </span>
        </span>
      ),
      truncateTitle: (r) => pickText(locale, r.title_en, r.title_ar),
    },
    {
      key: 'now',
      header: tr('ws.protocols.lists.cols.now'),
      render: (r) =>
        r.current_steps.length === 0 ? (
          <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>
        ) : (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            {r.current_steps.map((s) => (
              <span key={s.id}>
                {pickText(locale, s.name_en, s.name_ar)} <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>· {tr(`work.protocol.stepStatus.${s.status}`)}</span>
              </span>
            ))}
          </span>
        ),
      truncateTitle: (r) => r.current_steps.map((s) => pickText(locale, s.name_en, s.name_ar)).join(', '),
    },
    {
      key: 'started',
      header: tr('ws.protocols.lists.cols.started'),
      render: (r) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <bdi>{r.started_by_name ?? '—'}</bdi>
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{r.started_at ? formatDate(new Date(r.started_at), locale) : ''}</span>
        </span>
      ),
      truncateTitle: (r) => r.started_by_name ?? '',
    },
    {
      key: 'status',
      header: tr('ws.protocols.lists.cols.status'),
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusBadge tone={runStatusTone(r.status)} label={tr(`work.protocol.runStatus.${r.status}`)} />
          {r.waiting_on_me && <StatusBadge tone="warn" dot={false} label={tr('ws.protocols.lists.onYou')} />}
        </span>
      ),
      truncateTitle: (r) => tr(`work.protocol.runStatus.${r.status}`),
    },
  ];

  const status = asyncStatus(q, () => rows.length === 0);
  return (
    <section aria-label={tr('ws.protocols.lists.label')}>
      <Toolbar
        end={
          <Select<ProtocolKind | ''>
            aria-label={tr('ws.protocols.lists.kind')}
            value={kind}
            onChange={(k) => {
              setKind(k);
              setPage(0);
            }}
            options={[{ value: '', label: tr('ws.protocols.lists.everyKind') }, ...PROTOCOL_KINDS.map((k) => ({ value: k, label: tr(`work.protocol.kind.${k}`) }))]}
            style={{ minInlineSize: '12rem' }}
          />
        }
      >
        <SegmentedControl<ProtocolFilter>
          value={filter}
          aria-label={tr('ws.protocols.lists.label')}
          onChange={(f) => {
            setPage(0);
            onFilter(f);
          }}
          options={FILTERS.map((f) => ({
            value: f,
            label:
              f === 'waiting' && waitingCount > 0 ? (
                <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
                  {tr('ws.protocols.lists.filter.waiting')}
                  <span style={{ minInlineSize: '1.25rem', paddingInline: '0.3rem', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-warn-soft)', color: 'var(--tp-warn-fg)', fontSize: 'var(--tp-fs-xs)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {formatNumber(waitingCount, locale)}
                  </span>
                </span>
              ) : (
                tr(`ws.protocols.lists.filter.${f}`)
              ),
          }))}
        />
      </Toolbar>
      <AsyncStateWrapper
        status={status}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={4} />}
        emptyContent={
          <EmptyState
            icon={filter === 'waiting' ? 'checkCircle' : 'layers'}
            title={tr(`ws.protocols.lists.empty.${filter}.title` as MessageKey)}
            body={tr(`ws.protocols.lists.empty.${filter}.body` as MessageKey)}
          />
        }
      >
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onOpen} aria-label={tr('ws.protocols.lists.label')} />
        {pageCount > 1 && <Pagination page={page + 1} pageCount={pageCount} onChange={(p) => setPage(p - 1)} />}
      </AsyncStateWrapper>
    </section>
  );
}
