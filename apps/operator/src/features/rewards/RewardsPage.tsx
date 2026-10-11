/**
 * Rewards (/rewards), the owner only (0332–0333; Majed 2026-10-10/11).
 *
 * The owner sets standing rewards per person: reach a number of orders placed
 * in a business month and earn a bonus, a prize, or both. Each waiter, cashier
 * and manager at the branch is listed BY NAME (the server's order, never by
 * count: nothing here grades anyone), with their orders this month and last,
 * and their rewards, each marked Reached once their own count gets there.
 * Add reward opens a form above the table for that person; Remove asks first.
 *
 * Each person sees only their own progress, on their phone. A bonus reached
 * is added to their wage the month after (0333): the Wages page shows it.
 * Every count and amount is the server's. Money about a named person: nothing
 * here reaches the owner assistant.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { countPhrase, formatNumber, isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { Button, ErrorText, Field, inputStyle } from '../../components/ui';
import { MoneyInput } from '../../components/inputs';
import { AsyncStateWrapper, DataTable, EmptyState, MessagePresenter, Money, PageHeader, Panel, StatusBadge, TableSkeleton, ViewMore, useListCap, type Column } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { refusalCode, refusalHint } from '../protocols/errors';
import { monthLabel } from '../deductions/venueDate';
import { RK, endStaffReward, fetchRewardsBoard, setStaffReward } from './api';
import {
  ACTIVE_MAX,
  BONUS_MAX,
  EMPTY_DRAFT,
  PRIZE_MAX,
  canAddReward,
  draftArgs,
  isReached,
  isRewardStale,
  ordersToGo,
  readRewardsBoard,
  rewardRefusalField,
  validateRewardDraft,
  type BoardPerson,
  type BoardReward,
  type RewardDraft,
  type RewardField,
} from './rewardsLogic';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

export function RewardsPageScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const q = useQuery({ queryKey: RK.board, queryFn: fetchRewardsBoard, refetchInterval: 60_000 });
  const board = readRewardsBoard(q.data);
  // Owner's rule (2026-10-08): three people, then "View more".
  const peopleCap = useListCap(board.people);

  /** The person the add form is open for; `n` remounts it on each open. */
  const [adding, setAdding] = useState<{ n: number; staffId: string } | null>(null);
  const addingPerson = adding ? board.people.find((p) => p.staffId === adding.staffId) : undefined;

  const refresh = () => void qc.invalidateQueries({ queryKey: RK.all });

  const end = useMutation({
    mutationFn: (id: string) => endStaffReward(id),
    onSuccess: () => {
      toast.ok(tr('ws.rewards.remove.done'));
      refresh();
    },
    onError: (e) => isRewardStale(refusalCode(e)) && refresh(),
  });

  async function askRemove(person: BoardPerson, reward: BoardReward) {
    const yes = await confirm({
      kind: 'danger',
      title: tr('ws.rewards.remove.title'),
      body: tr('ws.rewards.remove.body', { name: isolate(person.name), orders: countPhrase('ws.rewards.count.orders', reward.target, locale) }),
      confirmLabel: tr('ws.rewards.remove.confirm'),
      cancelLabel: tr('ws.rewards.remove.keep'),
    });
    if (yes) end.mutate(reward.id);
  }

  const orders = (n: number) => countPhrase('ws.rewards.count.orders', n, locale);

  const columns: Column<BoardPerson>[] = [
    {
      key: 'person',
      header: tr('ws.rewards.cols.person'),
      render: (p) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', maxInlineSize: '16rem', overflowWrap: 'anywhere' }}>
          <bdi style={{ fontWeight: 600 }}>{p.name || '—'}</bdi>
          {p.role && <span style={muted}>{tr(`op.roles.${p.role}`)}</span>}
        </span>
      ),
    },
    {
      key: 'thisMonth',
      header: tr('ws.rewards.cols.thisMonth'),
      numeric: true,
      render: (p) => <strong style={{ whiteSpace: 'nowrap' }}>{orders(p.count)}</strong>,
      truncateTitle: (p) => String(p.count),
    },
    {
      key: 'lastMonth',
      header: tr('ws.rewards.cols.lastMonth'),
      numeric: true,
      render: (p) => <span style={{ ...muted, whiteSpace: 'nowrap' }}>{orders(p.lastMonthCount)}</span>,
      truncateTitle: (p) => String(p.lastMonthCount),
    },
    {
      key: 'rewards',
      header: tr('ws.rewards.cols.rewards'),
      render: (p) =>
        p.rewards.length === 0 ? (
          <span style={muted}>{tr('ws.rewards.reward.none')}</span>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: '20rem' }}>
            {p.rewards.map((r) => (
              <RewardLine key={r.id} person={p} reward={r} busy={end.isPending && end.variables === r.id} onRemove={() => void askRemove(p, r)} />
            ))}
          </ul>
        ),
      truncateTitle: () => '',
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (p) =>
        canAddReward(p) ? (
          <Button size="sm" icon="plus" onClick={() => setAdding((a) => ({ n: (a?.n ?? 0) + 1, staffId: p.staffId }))} data-testid={`rewards.row.add.${p.staffId}`}>
            {tr('ws.rewards.actions.add')}
          </Button>
        ) : (
          <span style={{ ...muted, display: 'inline-block', maxInlineSize: '14rem', whiteSpace: 'normal', textAlign: 'end' }}>
            {tr('ws.rewards.reward.limit', { max: formatNumber(ACTIVE_MAX, locale) })}
          </span>
        ),
      truncateTitle: () => '',
    },
  ];

  return (
    <div style={{ maxInlineSize: '88rem' }}>
      <PageHeader
        title={tr('ws.rewards.title')}
        subtitle={tr('ws.rewards.lead')}
        actions={
          <Button kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/wages' })} data-testid="rewards.link.wages">
            {tr('ws.rewards.links.wages')}
          </Button>
        }
      />

      <section aria-labelledby="rewards-month-title">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', marginBlockEnd: 'var(--tp-sp-3)' }}>
          <h2 id="rewards-month-title" style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700 }}>
            {board.month ? monthLabel(board.month, locale) : q.isError ? tr('ws.rewards.title') : tr('common.loading')}
          </h2>
          {board.daysLeft !== null && (
            <span style={muted} data-testid="rewards.daysLeft">
              {countPhrase('ws.rewards.count.daysLeft', board.daysLeft, locale)}
            </span>
          )}
        </div>

        {adding && addingPerson && (
          <AddRewardForm
            key={adding.n}
            person={addingPerson}
            onClose={() => setAdding(null)}
            onSaved={() => {
              setAdding(null);
              refresh();
            }}
            onStale={refresh}
          />
        )}

        <ErrorText error={end.error} />

        <AsyncStateWrapper
          status={q.isError && q.data === undefined ? 'error' : q.data === undefined ? 'loading' : board.people.length === 0 ? 'empty' : 'ready'}
          error={q.error}
          onRetry={() => void q.refetch()}
          skeleton={<TableSkeleton columns={columns} rows={4} />}
          emptyContent={<EmptyState kind="initial" icon="users" title={tr('ws.rewards.empty.title')} body={tr('ws.rewards.empty.body')} />}
        >
          <DataTable columns={columns} rows={peopleCap.shown} rowKey={(p) => p.staffId} selectedKey={adding?.staffId ?? null} aria-label={tr('ws.rewards.title')} />
          <ViewMore hidden={peopleCap.hidden} open={peopleCap.open} onToggle={peopleCap.toggle} />
        </AsyncStateWrapper>
      </section>
    </div>
  );
}

/** One reward: its target, what it gives, whether this person reached it, and Remove. */
function RewardLine({ person, reward: r, busy, onRemove }: { person: BoardPerson; reward: BoardReward; busy: boolean; onRemove: () => void }) {
  const { tr, locale } = useLocale();
  const reached = isReached(person.count, r.target);
  const orders = countPhrase('ws.rewards.count.orders', r.target, locale);
  return (
    <li data-testid={`rewards.reward.${r.id}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{tr('ws.rewards.reward.at', { orders })}</span>
      {r.rewardIqd > 0 && <Money amount={r.rewardIqd} strong style={{ whiteSpace: 'nowrap' }} />}
      {r.prize && (
        <bdi style={{ overflowWrap: 'anywhere' }}>
          {r.rewardIqd > 0 && <span aria-hidden="true" style={muted}>· </span>}
          {r.prize}
        </bdi>
      )}
      {reached ? (
        <StatusBadge size="sm" tone="success" label={tr('ws.rewards.reward.reached')} />
      ) : (
        <span style={muted}>{tr('ws.rewards.reward.toGo', { orders: countPhrase('ws.rewards.count.orders', ordersToGo(person.count, r.target), locale) })}</span>
      )}
      <Button
        size="sm"
        kind="ghost"
        icon="trash"
        busy={busy}
        aria-label={tr('ws.rewards.actions.removeFor', { orders, name: isolate(person.name) })}
        onClick={onRemove}
        data-testid={`rewards.reward.remove.${r.id}`}
        style={{ marginInlineStart: 'auto' }}
      >
        {tr('ws.rewards.actions.remove')}
      </Button>
    </li>
  );
}

const ISSUE_KEY: Record<Exclude<RewardField, 'reward'>, 'ws.rewards.form.issue.target' | 'ws.rewards.form.issue.bonus' | 'ws.rewards.form.issue.prize'> = {
  target: 'ws.rewards.form.issue.target',
  bonus: 'ws.rewards.form.issue.bonus',
  prize: 'ws.rewards.form.issue.prize',
};

/** Add a reward for one person: the orders, a bonus, a prize; one of the two is required. */
function AddRewardForm({ person, onClose, onSaved, onStale }: { person: BoardPerson; onClose: () => void; onSaved: () => void; onStale: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const [draft, setDraft] = useState<RewardDraft>(EMPTY_DRAFT);
  const [tried, setTried] = useState(false);
  const issues = validateRewardDraft(draft);

  const save = useMutation({
    mutationFn: () => setStaffReward({ staffId: person.staffId, ...draftArgs(draft) }),
    onSuccess: () => {
      toast.ok(tr('ws.rewards.form.saved'));
      onSaved();
    },
    onError: (e) => isRewardStale(refusalCode(e)) && onStale(),
  });
  const serverField = save.isError ? rewardRefusalField(refusalCode(save.error), refusalHint(save.error)) : null;
  // REWARD_TARGET_TAKEN has its own line (the catalogue's); the other fields read the form's rule.
  const takenOnTarget = refusalCode(save.error) === 'REWARD_TARGET_TAKEN';

  const issueOf = (field: Exclude<RewardField, 'reward'>): string | undefined => {
    if (tried && issues.includes(field)) return tr(ISSUE_KEY[field], { max: formatNumber(PRIZE_MAX, locale) });
    if (serverField === field && !(field === 'target' && takenOnTarget)) return tr(ISSUE_KEY[field], { max: formatNumber(PRIZE_MAX, locale) });
    return undefined;
  };
  const needOne = (tried && issues.includes('reward')) || serverField === 'reward';
  const set = (patch: Partial<RewardDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (save.isError) save.reset();
  };

  return (
    <Panel
      title={<CardTitle icon="gift">{tr('ws.rewards.form.title', { name: isolate(person.name) })}</CardTitle>}
      data-testid="rewards.add-form"
      style={{ marginBlockEnd: 'var(--tp-sp-4)', maxInlineSize: '52rem' }}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (issues.length === 0 && !save.isPending) save.mutate();
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap' }}>
          <Field label={tr('ws.rewards.form.target')} required hint={tr('ws.rewards.form.targetHint')} error={issueOf('target')} style={{ flex: '1 1 10rem' }}>
            <input
              style={{ ...inputStyle, inlineSize: '9rem', fontVariantNumeric: 'tabular-nums' }}
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              value={draft.target}
              disabled={save.isPending}
              onChange={(e) => set({ target: e.target.value.replace(/\D/g, '').slice(0, String(100_000).length) })}
              data-testid="rewards.form.target"
            />
          </Field>
          <Field label={tr('ws.rewards.form.bonus')} optional hint={tr('ws.rewards.form.bonusHint')} error={issueOf('bonus')} style={{ flex: '2 1 16rem' }}>
            <MoneyInput value={draft.bonus} allowEmpty max={BONUS_MAX} disabled={save.isPending} onChange={(v) => set({ bonus: v })} />
          </Field>
        </div>
        <Field label={tr('ws.rewards.form.prize')} optional hint={tr('ws.rewards.form.prizeHint', { max: formatNumber(PRIZE_MAX, locale) })} error={issueOf('prize')}>
          <input
            style={inputStyle}
            dir="auto"
            autoComplete="off"
            maxLength={PRIZE_MAX}
            value={draft.prize}
            disabled={save.isPending}
            onChange={(e) => set({ prize: e.target.value })}
            data-testid="rewards.form.prize"
          />
        </Field>
        {needOne && <MessagePresenter tone="refused" message={tr('ws.rewards.form.needOne')} style={{ marginBlockEnd: 'var(--tp-sp-2)' }} />}
        {save.isError && (serverField === null || takenOnTarget) && <ErrorText error={save.error} />}
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button kind="ghost" onClick={onClose} disabled={save.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" type="submit" icon="check" busy={save.isPending} data-testid="rewards.form.save">
            {tr('ws.rewards.form.save')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
