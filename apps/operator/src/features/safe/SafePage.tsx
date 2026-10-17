/**
 * The Safe (/safe): the branch's main cash (0343; Majed 2026-10-16).
 *
 * The café till and the court desk keep their own drawers; the safe is the
 * third box, the owner's, and every cost is paid from it or by bank
 * transfer. The page is built around one job, logging a payment, so the form
 * is always open: amount, what for, who, from where, one button that says
 * what it will do ("Pay 250,000 IQD from the safe"). Moving cash (a drawer's
 * takings in, a float out, the bank, the owner) and counting the safe are the
 * two other tabs of the same form.
 *
 * Beside it: the balance, the month's costs by category (safe and bank), and
 * every movement with the balance after it. A row logged here or at day close
 * can be taken back with a reason; a wage, advance or coach pay row is undone
 * on its own page. Managers and the owner both write here; a manager does not
 * see the person on a wage or advance row (wages are the owner's).
 *
 * Every figure is the server's. A payment that takes the safe below zero is
 * warned about, never refused: the money left either way, and a count puts
 * the balance right.
 */
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { countPhrase, formatDate, formatIQD, formatTime, isolate, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, Skeleton, inputStyle } from '../../components/ui';
import { MoneyInput } from '../../components/inputs';
import { AsyncStateWrapper, EmptyState, MessagePresenter, Money, PageHeader, Panel, SegmentedControl, ViewMore, useListCap } from '../../components/kit';
import { Icon } from '../../components/icons';
import { CardTitle } from '../ops/OpsVisuals';
import { refusalCode } from '../protocols/errors';
import { monthLabel } from '../deductions/venueDate';
import { SK, countSafe, fetchOverview, moveCash, payCost, voidEntry } from './api';
import {
  EMPTY_MOVE,
  EMPTY_PAY,
  NOTE_MAX,
  PAYEE_MAX,
  PAY_CATEGORIES,
  barShare,
  canStepForward,
  canVoid,
  countArgs,
  entryTone,
  filterEntries,
  moveArgs,
  moveBlock,
  partiesFor,
  payArgs,
  payBlock,
  payeesFor,
  readOverview,
  shiftMonth,
  takesSafeBelowZero,
  type Box,
  type LedgerFilter,
  type Mode,
  type MoveDraft,
  type PaidFrom,
  type Party,
  type PayDraft,
  type SafeEntry,
  type SafeOverview,
} from './safeLogic';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;
const newKey = (kind: string) => `safe.${kind}:${crypto.randomUUID()}`;

export function SafePageScreen() {
  const { tr, locale } = useLocale();
  const [month, setMonth] = useState<string | null>(null);
  const q = useQuery({ queryKey: SK.overview(month), queryFn: () => fetchOverview(month), refetchInterval: 60_000 });
  const ov = readOverview(q.data);
  const shown = ov.month ?? month;

  return (
    <div style={{ maxInlineSize: '96rem' }}>
      <PageHeader title={tr('ws.safe.title')} subtitle={tr('ws.safe.lead')} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-5)', alignItems: 'flex-start' }}>
        {/* The desk: the balance, then the always-open form. */}
        <div style={{ flex: '1 1 22rem', maxInlineSize: '30rem', minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <Balance ov={ov} loading={q.data === undefined && !q.isError} />
          <Composer ov={ov} ready={q.data !== undefined} />
        </div>

        {/* The record: the month's costs and every movement. */}
        <div style={{ flex: '3 1 34rem', minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
            <Button
              kind="ghost"
              size="sm"
              icon="chevronStart"
              aria-label={tr('ws.safe.month.prev')}
              disabled={shown === null}
              onClick={() => shown && setMonth(shiftMonth(shown, -1))}
              data-testid="safe.month.prev"
            />
            <h2 style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, minInlineSize: '10rem', textAlign: 'center' }} data-testid="safe.month">
              {shown ? monthLabel(shown, locale) : tr('common.loading')}
            </h2>
            <Button
              kind="ghost"
              size="sm"
              icon="chevronEnd"
              aria-label={tr('ws.safe.month.next')}
              disabled={!canStepForward(shown, ov.currentMonth)}
              onClick={() => shown && setMonth(shiftMonth(shown, 1) === ov.currentMonth ? null : shiftMonth(shown, 1))}
              data-testid="safe.month.next"
            />
          </div>
          <AsyncStateWrapper
            status={q.isError && q.data === undefined ? 'error' : q.data === undefined ? 'loading' : 'ready'}
            error={q.error}
            onRetry={() => void q.refetch()}
            skeleton={<Skeleton lines={6} blockSize="2rem" />}
          >
            <Costs ov={ov} />
            <Ledger ov={ov} />
          </AsyncStateWrapper>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The balance
// ---------------------------------------------------------------------------

function Balance({ ov, loading }: { ov: SafeOverview; loading: boolean }) {
  const { tr, locale } = useLocale();
  const c = ov.lastCount;
  const when = c?.at ? `${formatDate(new Date(c.at), locale)} ${formatTime(new Date(c.at), locale)}` : '';
  const outcome = !c ? '' : c.differenceIqd === 0 ? tr('ws.safe.balance.matched') : c.differenceIqd < 0
    ? tr('ws.safe.balance.short', { amount: formatIQD(-c.differenceIqd, locale) })
    : tr('ws.safe.balance.over', { amount: formatIQD(c.differenceIqd, locale) });
  const negative = ov.balanceIqd !== null && ov.balanceIqd < 0;

  return (
    <section aria-labelledby="safe-balance-label" style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
      <span id="safe-balance-label" style={{ ...muted, fontWeight: 600 }}>
        {tr('ws.safe.balance.label')}
      </span>
      {loading ? (
        <Skeleton lines={1} blockSize="2.25rem" style={{ maxInlineSize: '14rem' }} />
      ) : (
        <Money
          amount={ov.balanceIqd}
          strong
          style={{ fontSize: 'var(--tp-fs-3xl)', lineHeight: 1.15, color: negative ? 'var(--tp-danger-fg)' : undefined }}
        />
      )}
      {!loading && (
        <span style={muted} data-testid="safe.today">
          {tr('ws.safe.balance.today', { in: formatIQD(ov.todayIn, locale), out: formatIQD(ov.todayOut, locale) })}
        </span>
      )}
      {!loading && (
        <span style={muted} data-testid="safe.lastCount">
          {c
            ? `${c.byName ? tr('ws.safe.balance.lastCount', { when, name: isolate(c.byName) }) : tr('ws.safe.balance.lastCountNoName', { when })}, ${outcome}`
            : tr('ws.safe.balance.never')}
        </span>
      )}
      {negative && <MessagePresenter tone="refused" icon="alert" message={tr('ws.safe.balance.belowZero')} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The form: pay, move, count
// ---------------------------------------------------------------------------

function Composer({ ov, ready }: { ov: SafeOverview; ready: boolean }) {
  const { tr } = useLocale();
  const [mode, setMode] = useState<Mode>('pay');
  return (
    <Panel padded>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        <SegmentedControl<Mode>
          aria-label={tr('ws.safe.modes.label')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'pay', label: tr('ws.safe.modes.pay'), icon: 'banknote', testId: 'safe.mode.pay' },
            { value: 'move', label: tr('ws.safe.modes.move'), icon: 'repeat', testId: 'safe.mode.move' },
            { value: 'count', label: tr('ws.safe.modes.count'), icon: 'scale', testId: 'safe.mode.count' },
          ]}
        />
        {mode === 'pay' && <PayForm ov={ov} />}
        {mode === 'move' && <MoveForm ov={ov} />}
        {mode === 'count' && <CountForm ov={ov} ready={ready} />}
      </div>
    </Panel>
  );
}

/** Radio chips: every choice visible at once, one press, a 44px target each. */
function Chips<T extends string>({
  name,
  labelId,
  value,
  options,
  onChange,
  disabled,
  testId,
}: {
  name: string;
  labelId: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelId} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)' }}>
      {options.map((o) => (
        <label key={o.value} className="tp-choice" data-selected={value === o.value ? 'true' : undefined} data-testid={`${testId}.${o.value}`} style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)' }}>
          <input className="tp-sr-only" type="radio" name={name} value={o.value} checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} />
          {value === o.value && <Icon name="check" size={14} />}
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

/** A labelled block for a control group that is not one input (chips, segments). */
function GroupField({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <span id={id} style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
        {label}
      </span>
      {children}
      {hint && <span style={muted}>{hint}</span>}
    </div>
  );
}

function PayForm({ ov }: { ov: SafeOverview }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ids = useId();
  const amountBox = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<PayDraft>(EMPTY_PAY);
  const [key, setKey] = useState(() => newKey('pay'));
  const set = (patch: Partial<PayDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const pay = useMutation({
    mutationFn: () => payCost(payArgs(draft, key)),
    onSuccess: () => {
      const amount = formatIQD(draft.amount ?? 0, locale);
      toast.ok(draft.paidFrom === 'safe' ? tr('ws.safe.pay.doneSafe', { amount }) : tr('ws.safe.pay.doneBank', { amount }));
      // Ready for the next one: the same source, a fresh key, the cursor back on the amount.
      setDraft({ ...EMPTY_PAY, paidFrom: draft.paidFrom });
      setKey(newKey('pay'));
      void qc.invalidateQueries({ queryKey: SK.all });
      requestAnimationFrame(() => amountBox.current?.querySelector('input')?.focus());
    },
  });

  const block = payBlock(draft);
  const amount = draft.amount !== null && draft.amount > 0 ? formatIQD(draft.amount, locale) : null;
  const label =
    amount === null ? tr('ws.safe.pay.submitEmpty') : draft.paidFrom === 'safe' ? tr('ws.safe.pay.submitSafe', { amount }) : tr('ws.safe.pay.submitBank', { amount });
  const suggestions = payeesFor(ov.payees, draft.category);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (block === null && !pay.isPending) pay.mutate();
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--tp-sp-4)' }} data-testid="safe.pay">
      <div ref={amountBox}>
        <Field label={tr('ws.safe.pay.amount')} style={{ marginBlockEnd: 0 }}>
          <MoneyInput allowEmpty value={draft.amount} onChange={(v) => set({ amount: v })} max={1_000_000_000} disabled={pay.isPending} />
        </Field>
      </div>

      <GroupField id={`${ids}-cat`} label={tr('ws.safe.pay.category')}>
        <Chips
          name={`${ids}-cat`}
          labelId={`${ids}-cat`}
          value={draft.category}
          disabled={pay.isPending}
          onChange={(category) => set({ category })}
          options={PAY_CATEGORIES.map((c) => ({ value: c, label: tr(`ws.safe.categories.${c}`) }))}
          testId="safe.pay.category"
        />
      </GroupField>

      <Field label={tr('ws.safe.pay.payee')} optional style={{ marginBlockEnd: 0 }}>
        <input
          style={inputStyle}
          value={draft.payee}
          maxLength={PAYEE_MAX}
          list={suggestions.length > 0 ? `${ids}-payees` : undefined}
          placeholder={tr('ws.safe.pay.payeePlaceholder')}
          disabled={pay.isPending}
          onChange={(e) => set({ payee: e.target.value })}
          data-testid="safe.pay.payee"
        />
        {suggestions.length > 0 && (
          <datalist id={`${ids}-payees`}>
            {suggestions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        )}
      </Field>

      <GroupField id={`${ids}-from`} label={tr('ws.safe.pay.from')} hint={draft.paidFrom === 'bank' ? tr('ws.safe.pay.bankHint') : undefined}>
        <SegmentedControl<PaidFrom>
          aria-labelledby={`${ids}-from`}
          value={draft.paidFrom}
          onChange={(paidFrom) => set({ paidFrom })}
          options={[
            { value: 'safe', label: tr('ws.safe.pay.fromSafe'), testId: 'safe.pay.from.safe' },
            { value: 'bank', label: tr('ws.safe.pay.fromBank'), testId: 'safe.pay.from.bank' },
          ]}
        />
      </GroupField>

      <Field label={tr('ws.safe.pay.note')} optional style={{ marginBlockEnd: 0 }}>
        <input
          style={inputStyle}
          value={draft.note}
          maxLength={NOTE_MAX}
          placeholder={tr('ws.safe.pay.notePlaceholder')}
          disabled={pay.isPending}
          onChange={(e) => set({ note: e.target.value })}
          data-testid="safe.pay.note"
        />
      </Field>

      {takesSafeBelowZero(draft, ov.balanceIqd) && (
        <MessagePresenter tone="refused" icon="alert" message={tr('ws.safe.pay.belowZero', { balance: formatIQD(ov.balanceIqd ?? 0, locale) })} />
      )}
      <ErrorText error={pay.error} style={{ marginBlock: 0 }} />

      <Button
        type="submit"
        kind="primary"
        size="lg"
        icon="check"
        busy={pay.isPending}
        disabled={block !== null}
        disabledReason={block !== null ? tr(`ws.safe.pay.block.${block}`) : undefined}
        data-testid="safe.pay.submit"
        style={{ justifySelf: 'stretch' }}
      >
        {label}
      </Button>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        <p style={{ ...muted, margin: 0 }}>{tr('ws.safe.pay.ownPages')}</p>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', marginInlineStart: 'calc(-1 * var(--tp-sp-2))' }}>
          {/* Wages are the owner's (ROUTE_ROLES): a manager is not sent to a page that refuses them. */}
          {ov.isOwner && (
            <Button kind="ghost" size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/wages' })} data-testid="safe.link.wages">
              {tr('ws.safe.pay.wagesLink')}
            </Button>
          )}
          <Button kind="ghost" size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/reports/coaches' })} data-testid="safe.link.coaches">
            {tr('ws.safe.pay.coachLink')}
          </Button>
        </div>
      </div>
    </form>
  );
}

function MoveForm({ ov }: { ov: SafeOverview }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const ids = useId();
  const [draft, setDraft] = useState<MoveDraft>(EMPTY_MOVE);
  const [key, setKey] = useState(() => newKey('move'));
  const set = (patch: Partial<MoveDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const move = useMutation({
    mutationFn: () => moveCash(moveArgs(draft, key)),
    onSuccess: () => {
      toast.ok(tr('ws.safe.move.done', { amount: formatIQD(draft.amount ?? 0, locale) }));
      setDraft({ ...EMPTY_MOVE, direction: draft.direction });
      setKey(newKey('move'));
      void qc.invalidateQueries({ queryKey: SK.all });
    },
  });

  const block = moveBlock(draft);
  const blockKey: MessageKey | null =
    block === null ? null : block === 'party' ? (draft.direction === 'in' ? 'ws.safe.move.block.partyIn' : 'ws.safe.move.block.partyOut') : `ws.safe.move.block.${block}`;
  const amount = draft.amount !== null && draft.amount > 0 ? formatIQD(draft.amount, locale) : null;
  const label = amount === null ? tr('ws.safe.move.submitEmpty') : draft.direction === 'in' ? tr('ws.safe.move.submitIn', { amount }) : tr('ws.safe.move.submitOut', { amount });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (block === null && !move.isPending) move.mutate();
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--tp-sp-4)' }} data-testid="safe.move">
      <GroupField id={`${ids}-dir`} label={tr('ws.safe.move.direction')}>
        <SegmentedControl<'in' | 'out'>
          aria-labelledby={`${ids}-dir`}
          value={draft.direction}
          onChange={(direction) => set({ direction })}
          options={[
            { value: 'in', label: tr('ws.safe.move.in'), testId: 'safe.move.in' },
            { value: 'out', label: tr('ws.safe.move.out'), testId: 'safe.move.out' },
          ]}
        />
      </GroupField>

      <GroupField id={`${ids}-party`} label={draft.direction === 'in' ? tr('ws.safe.move.from') : tr('ws.safe.move.to')}>
        <Chips<Party>
          name={`${ids}-party`}
          labelId={`${ids}-party`}
          value={draft.party}
          disabled={move.isPending}
          onChange={(party) => set({ party })}
          options={partiesFor(ov.boxes).map((p) => ({ value: p, label: tr(`ws.safe.move.parties.${p}`) }))}
          testId="safe.move.party"
        />
      </GroupField>

      <Field label={tr('ws.safe.move.amount')} style={{ marginBlockEnd: 0 }}>
        <MoneyInput allowEmpty value={draft.amount} onChange={(v) => set({ amount: v })} max={1_000_000_000} disabled={move.isPending} />
      </Field>

      <Field label={tr('ws.safe.move.note')} optional style={{ marginBlockEnd: 0 }}>
        <input
          style={inputStyle}
          value={draft.note}
          maxLength={NOTE_MAX}
          placeholder={tr('ws.safe.move.notePlaceholder')}
          disabled={move.isPending}
          onChange={(e) => set({ note: e.target.value })}
        />
      </Field>

      <ErrorText error={move.error} style={{ marginBlock: 0 }} />
      <Button
        type="submit"
        kind="primary"
        size="lg"
        icon="check"
        busy={move.isPending}
        disabled={block !== null}
        disabledReason={blockKey ? tr(blockKey) : undefined}
        data-testid="safe.move.submit"
        style={{ justifySelf: 'stretch' }}
      >
        {label}
      </Button>
    </form>
  );
}

function CountForm({ ov, ready }: { ov: SafeOverview; ready: boolean }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [key, setKey] = useState(() => newKey('count'));

  const count = useMutation({
    mutationFn: () => countSafe(countArgs(counted ?? 0, ov.balanceIqd ?? 0, note, key)),
    onSuccess: (res) => {
      const diff = res.difference_iqd ?? 0;
      toast.ok(
        diff === 0
          ? tr('ws.safe.counting.doneMatch')
          : diff < 0
            ? tr('ws.safe.counting.doneShort', { amount: formatIQD(-diff, locale) })
            : tr('ws.safe.counting.doneOver', { amount: formatIQD(diff, locale) }),
      );
      setCounted(null);
      setNote('');
      setKey(newKey('count'));
      void qc.invalidateQueries({ queryKey: SK.all });
    },
    // Something was logged while counting: the balance catches up behind the message.
    onError: (e) => refusalCode(e) === 'MAIN_CASH_CHANGED' && void qc.invalidateQueries({ queryKey: SK.all }),
  });

  const blocked = counted === null || !ready || ov.balanceIqd === null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!blocked && !count.isPending) count.mutate();
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--tp-sp-4)' }} data-testid="safe.count">
      <p style={{ ...muted, margin: 0, maxInlineSize: '60ch' }}>{tr('ws.safe.counting.lead')}</p>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--tp-sp-3)' }}>
        <span style={muted}>{tr('ws.safe.counting.expected')}</span>
        <Money amount={ov.balanceIqd} strong />
      </div>
      <Field label={tr('ws.safe.counting.counted')} style={{ marginBlockEnd: 0 }}>
        <MoneyInput allowEmpty value={counted} onChange={setCounted} max={1_000_000_000} disabled={count.isPending} />
      </Field>
      <Field label={tr('ws.safe.counting.note')} optional style={{ marginBlockEnd: 0 }}>
        <input style={inputStyle} value={note} maxLength={NOTE_MAX} placeholder={tr('ws.safe.counting.notePlaceholder')} disabled={count.isPending} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorText error={count.error} style={{ marginBlock: 0 }} />
      <Button
        type="submit"
        kind="primary"
        size="lg"
        icon="check"
        busy={count.isPending}
        disabled={blocked}
        disabledReason={counted === null ? tr('ws.safe.counting.block') : undefined}
        data-testid="safe.count.submit"
        style={{ justifySelf: 'stretch' }}
      >
        {tr('ws.safe.counting.submit')}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The month: where the money went, and every movement
// ---------------------------------------------------------------------------

function Costs({ ov }: { ov: SafeOverview }) {
  const { tr, locale } = useLocale();
  const cap = useListCap(ov.costs);
  const max = ov.costs.reduce((m, c) => Math.max(m, c.totalIqd), 0);
  return (
    <Panel
      title={<CardTitle icon="chart">{tr('ws.safe.costs.title')}</CardTitle>}
      actions={ov.costs.length > 0 ? <span style={{ ...muted, fontWeight: 600 }}>{tr('ws.safe.costs.total', { amount: formatIQD(ov.costsTotalIqd, locale) })}</span> : undefined}
    >
      {ov.costs.length === 0 ? (
        <p style={{ ...muted, margin: 0 }}>{tr('ws.safe.costs.empty')}</p>
      ) : (
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="safe.costs">
            {cap.shown.map((c) => (
              <li key={c.category} data-testid={`safe.costs.${c.category}`} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>{tr(`ws.safe.categories.${c.category}`)}</span>
                  <span style={muted}>
                    {countPhrase('ws.safe.count.payments', c.count, locale)}
                    {c.fromBankIqd > 0 && ` · ${tr('ws.safe.costs.byBank', { amount: formatIQD(c.fromBankIqd, locale) })}`}
                  </span>
                  <Money amount={c.totalIqd} strong style={{ marginInlineStart: 'auto' }} />
                </div>
                <div aria-hidden="true" style={{ blockSize: '0.375rem', background: 'var(--tp-surface-2)', borderRadius: 'var(--tp-radius-pill)', overflow: 'hidden' }}>
                  <div style={{ blockSize: '100%', inlineSize: `${barShare(c.totalIqd, max) * 100}%`, background: 'var(--tp-accent)', borderRadius: 'inherit' }} />
                </div>
              </li>
            ))}
          </ul>
          <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
        </>
      )}
    </Panel>
  );
}

function Ledger({ ov }: { ov: SafeOverview }) {
  const { tr } = useLocale();
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [voiding, setVoiding] = useState<SafeEntry | null>(null);
  const rows = filterEntries(ov.entries, filter);
  const cap = useListCap(rows);

  return (
    <Panel
      title={<CardTitle icon="receipt">{tr('ws.safe.ledger.title')}</CardTitle>}
      actions={
        <SegmentedControl<LedgerFilter>
          size="sm"
          aria-label={tr('ws.safe.ledger.filters.label')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: tr('ws.safe.ledger.filters.all'), testId: 'safe.ledger.filter.all' },
            { value: 'payments', label: tr('ws.safe.ledger.filters.payments'), testId: 'safe.ledger.filter.payments' },
            { value: 'moves', label: tr('ws.safe.ledger.filters.moves'), testId: 'safe.ledger.filter.moves' },
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyState compact kind="initial" icon="receipt" title={tr('ws.safe.ledger.emptyTitle')} body={tr('ws.safe.ledger.emptyBody')} />
      ) : (
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="safe.ledger">
            {cap.shown.map((e, i) => (
              <LedgerRow key={e.id} entry={e} first={i === 0} onVoid={() => setVoiding(e)} />
            ))}
          </ul>
          <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
        </>
      )}
      {voiding && <VoidDialog entry={voiding} onClose={() => setVoiding(null)} />}
    </Panel>
  );
}

/** What a row says happened, in words: the kind, then the category and person for a payment. */
function useEntryTitle() {
  const { tr, locale } = useLocale();
  return (e: SafeEntry): { title: string; detail: string | null } => {
    const box = (b: Box | null) => (b ? tr(`ws.safe.ledger.boxes.${b}`) : '');
    switch (e.kind) {
      case 'payment': {
        const cat = e.category ? tr(`ws.safe.categories.${e.category}`) : '';
        const person = e.payeeHidden ? tr('ws.safe.ledger.hiddenPerson') : e.payee;
        return { title: person ? `${cat} · ${isolate(person)}` : cat, detail: e.paidFrom === 'bank' ? tr('ws.safe.ledger.kinds.paymentBank') : tr('ws.safe.ledger.kinds.paymentSafe') };
      }
      case 'hand_in':
        return { title: tr('ws.safe.ledger.kinds.hand_in', { box: box(e.box) }), detail: e.source === 'day_close' ? tr('ws.safe.ledger.dayClose') : null };
      case 'to_drawer':
        return { title: tr('ws.safe.ledger.kinds.to_drawer', { box: box(e.box) }), detail: null };
      case 'count':
        return { title: tr('ws.safe.ledger.kinds.count', { amount: formatIQD(e.amountIqd, locale) }), detail: null };
      default:
        return { title: tr(`ws.safe.ledger.kinds.${e.kind}`), detail: null };
    }
  };
}

function LedgerRow({ entry: e, first, onVoid }: { entry: SafeEntry; first: boolean; onVoid: () => void }) {
  const { tr, locale } = useLocale();
  const titleOf = useEntryTitle();
  const { title, detail } = titleOf(e);
  const tone = entryTone(e);
  const voided = e.voidedAt !== null;
  const at = e.loggedAt ? new Date(e.loggedAt) : null;
  // A count moves the balance by its difference; every other row by its amount.
  const shown = e.kind === 'count' ? Math.abs(e.deltaIqd) : e.amountIqd;
  const sign = tone === 'in' ? '+' : tone === 'out' ? '−' : '';
  const meta = [detail, e.note ? isolate(e.note) : null, e.loggedByName ? tr('ws.safe.ledger.by', { name: isolate(e.loggedByName) }) : null].filter(Boolean).join(' · ');

  return (
    <li
      data-testid={`safe.entry.${e.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(5.5rem, auto) 1fr auto',
        gap: 'var(--tp-sp-1) var(--tp-sp-3)',
        alignItems: 'start',
        paddingBlock: 'var(--tp-sp-3)',
        borderBlockStart: first ? undefined : '1px solid var(--tp-border)',
        opacity: voided ? 0.7 : undefined,
      }}
    >
      <span style={{ ...muted, fontVariantNumeric: 'tabular-nums', display: 'grid' }}>
        {at && <span>{formatDate(at, locale)}</span>}
        {at && <span>{formatTime(at, locale)}</span>}
      </span>
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
        <span style={{ fontWeight: 600, overflowWrap: 'anywhere', textDecoration: voided ? 'line-through' : undefined }}>{title}</span>
        {meta && <span style={{ ...muted, overflowWrap: 'anywhere' }}>{meta}</span>}
        {voided && (
          <span style={{ ...muted, color: 'var(--tp-danger-fg)' }}>
            {tr('ws.safe.ledger.voided', { name: isolate(e.voidedByName ?? ''), reason: isolate(e.voidReason ?? '') })}
          </span>
        )}
        {!voided && !canVoid(e) && e.source !== 'manual' && e.source !== 'day_close' && (
          <span style={muted}>{tr('ws.safe.ledger.linkedHint', { page: tr(`ws.safe.ledger.pages.${e.source}`) })}</span>
        )}
      </span>
      <span style={{ display: 'grid', justifyItems: 'end', gap: 'var(--tp-sp-0)' }}>
        <span
          dir="ltr"
          style={{
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            color: tone === 'in' ? 'var(--tp-success-fg)' : tone === 'none' ? 'var(--tp-muted-fg)' : undefined,
            textDecoration: voided ? 'line-through' : undefined,
          }}
        >
          {sign}
          {formatIQD(shown, locale)}
        </span>
        {e.balanceAfterIqd !== null && (
          <span style={{ ...muted, whiteSpace: 'nowrap' }}>{tr('ws.safe.ledger.balanceAfter', { amount: formatIQD(e.balanceAfterIqd, locale) })}</span>
        )}
        {canVoid(e) && (
          <Button size="sm" kind="ghost" icon="undo" onClick={onVoid} aria-label={tr('ws.safe.ledger.void.actionFor', { what: title })} data-testid={`safe.entry.void.${e.id}`}>
            {tr('ws.safe.ledger.void.action')}
          </Button>
        )}
      </span>
    </li>
  );
}

function VoidDialog({ entry, onClose }: { entry: SafeEntry; onClose: () => void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const run = useMutation({
    mutationFn: () => voidEntry(entry.id, reason.trim()),
    onSuccess: () => {
      toast.ok(tr('ws.safe.ledger.void.done'));
      void qc.invalidateQueries({ queryKey: SK.all });
      onClose();
    },
  });
  const ready = reason.trim().length > 0 && reason.trim().length <= NOTE_MAX;
  return (
    <Modal
      title={tr('ws.safe.ledger.void.title')}
      onClose={onClose}
      dismissible={!run.isPending}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={run.isPending}>
            {tr('ws.safe.ledger.void.keep')}
          </Button>
          <Button kind="danger" icon="undo" busy={run.isPending} disabled={!ready} onClick={() => run.mutate()} data-testid="safe.void.confirm">
            {tr('ws.safe.ledger.void.confirm')}
          </Button>
        </>
      )}
    >
      <p style={{ marginBlockStart: 0 }}>{tr('ws.safe.ledger.void.body')}</p>
      <Field label={tr('ws.safe.ledger.void.reason')} style={{ marginBlockEnd: 0 }}>
        <input
          style={inputStyle}
          autoFocus
          value={reason}
          maxLength={NOTE_MAX}
          placeholder={tr('ws.safe.ledger.void.reasonPlaceholder')}
          onChange={(e) => setReason(e.target.value)}
          data-testid="safe.void.reason"
        />
      </Field>
      <ErrorText error={run.error} />
    </Modal>
  );
}
