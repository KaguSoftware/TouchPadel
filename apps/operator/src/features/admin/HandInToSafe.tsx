/**
 * "Hand cash to the safe" (0343, main cash). Once the day is closed, each
 * drawer box (the café till, the court desk, the shop desk when the branch
 * has one) hands its cash to the safe, once. The figures are the server's
 * (app.main_cash_day_boxes); the manager only confirms or edits the amount
 * that moves, and one button moves them all (app.main_cash_hand_in_day).
 *
 * Two modes:
 *  - closed: on the day-close screen right after close_day, for that day.
 *  - pending: beside "Open the day", for the last closed day, and only while
 *    a box that took cash has no hand-in. Says nothing while it loads or when
 *    the read fails: the Safe page covers "later".
 *
 * The opening float is not in these figures and stays in the drawers.
 */
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDate, formatIQD } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Skeleton } from '../../components/ui';
import { Panel } from '../../components/kit';
import { MoneyInput } from '../../components/inputs';
import { useToast } from '../../components/toast';
import { Icon } from '../../components/icons';
import { CardTitle } from '../ops/OpsVisuals';
import {
  HAND_IN_MAX_IQD,
  NO_OVERLAY,
  dayBoxesKey,
  handInBlock,
  handInPayload,
  handInRows,
  handInTotal,
  handInView,
  hasPendingHandIn,
  keptBoxes,
  newHandInKey,
  readDayBoxes,
  type CashBox,
  type DayBoxes,
  type HandInOverlay,
  type HandInRow,
} from './handInLogic';

interface HandInResult {
  handed_in: number;
  total_iqd: number;
  balance_iqd: number;
}

/** app.main_cash_day_boxes for one day, under ['main-cash'] so the Safe page's writes refresh it. */
export function useDayBoxes(daySessionId: string | null) {
  return useQuery({
    queryKey: dayBoxesKey(daySessionId ?? ''),
    enabled: Boolean(daySessionId),
    queryFn: async (): Promise<DayBoxes | null> =>
      readDayBoxes(await appRpc<unknown>('main_cash_day_boxes', { p_day_session_id: daySessionId })),
  });
}

const SAFE_HREF = '/safe';

export function HandInToSafe({ daySessionId, mode }: { daySessionId: string; mode: 'closed' | 'pending' }) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const boxesQ = useDayBoxes(daySessionId);
  const [drafts, setDrafts] = useState<Partial<Record<CashBox, number | null>>>({});
  const [overlay, setOverlay] = useState<HandInOverlay>(NO_OVERLAY);
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // One key per attempt: a retry of the same submit reuses it (the server
  // replays a call that landed but whose answer was lost); a success replaces it.
  const keyRef = useRef(newHandInKey());

  const day = boxesQ.data ?? null;
  const pending = mode === 'pending';
  const openSafe = () => void navigate({ href: SAFE_HREF });
  const title = <CardTitle icon="banknote">{tr('ws.manager.dayClose.handIn.title')}</CardTitle>;

  // The pending mode says nothing until it knows there is cash to hand in.
  if (pending && (!day || !hasPendingHandIn(day)) && overlay === NO_OVERLAY) return null;

  if (boxesQ.isPending) {
    return (
      <Panel title={title} data-testid="hand-in-safe">
        <p className="tp-sr-only" role="status">{tr('common.loading')}</p>
        <Skeleton lines={3} blockSize="2.25rem" />
      </Panel>
    );
  }

  if (boxesQ.isError || !day) {
    return (
      <Panel title={title} data-testid="hand-in-safe">
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={boxesQ.error ?? new Error('main_cash_day_boxes')} message={tr('ws.manager.dayClose.handIn.error')} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void boxesQ.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      </Panel>
    );
  }

  if (collapsed) {
    return (
      <Panel muted data-testid="hand-in-safe">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.dayClose.handIn.later')}</span>
          <Button size="sm" kind="soft" icon="banknote" iconEnd="arrowUpRight" onClick={openSafe}>
            {tr('ws.manager.dayClose.handIn.openSafe')}
          </Button>
        </div>
      </Panel>
    );
  }

  const rows = handInRows(day, drafts, overlay);
  const view = handInView(rows);
  const total = handInTotal(rows);
  const block = handInBlock(rows);
  const money = (n: number) => formatIQD(n, locale);

  if (view === 'empty') {
    return (
      <Panel title={title} data-testid="hand-in-safe">
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.dayClose.handIn.empty')}</p>
      </Panel>
    );
  }

  async function moveToSafe() {
    const payload = handInPayload(rows);
    if (payload.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<HandInResult>('main_cash_hand_in_day', {
        p_day_session_id: daySessionId,
        p_boxes: payload,
        p_idempotency_key: keyRef.current,
      });
      keyRef.current = newHandInKey();
      const handed = { ...overlay.handed };
      for (const p of payload) handed[p.box] = p.amount_iqd;
      setOverlay({ handed, kept: [...overlay.kept, ...keptBoxes(rows)] });
      toast.ok(tr('ws.manager.dayClose.handIn.toast', { amount: money(res.total_iqd) }));
    } catch (e) {
      // MAIN_CASH_HANDED_IN (someone handed a box in meanwhile) reads as its
      // own sentence; the refetch below turns that row into its done state.
      setError(e);
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ['main-cash'] });
    }
  }

  const lead =
    view === 'done'
      ? rows.some((r) => r.state === 'kept')
        ? tr('ws.manager.dayClose.handIn.keptHint')
        : tr('ws.manager.dayClose.handIn.allIn')
      : pending
        ? tr('ws.manager.dayClose.handIn.pendingLead', { date: formatDate(new Date(`${day.business_date}T00:00:00`), locale) })
        : tr('ws.manager.dayClose.handIn.lead');

  return (
    <Panel title={title} data-testid="hand-in-safe">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          <bdi>{lead}</bdi>
        </p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
          {rows.map((r) => (
            <BoxRow
              key={r.box}
              row={r}
              busy={busy}
              onChange={(next) => setDrafts((d) => ({ ...d, [r.box]: next }))}
            />
          ))}
        </ul>
        <ErrorText error={error} style={{ marginBlock: 0 }} />
        {view === 'form' ? (
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              kind={pending ? 'default' : 'primary'}
              size="lg"
              icon="banknote"
              busy={busy}
              disabled={block !== null}
              disabledReason={block === 'zero' ? tr('ws.manager.dayClose.handIn.zero') : undefined}
              onClick={() => void moveToSafe()}
            >
              {tr('ws.manager.dayClose.handIn.move', { amount: money(total) })}
            </Button>
            <Button kind="ghost" disabled={busy} onClick={() => setCollapsed(true)}>
              {tr('ws.manager.dayClose.handIn.notNow')}
            </Button>
          </div>
        ) : (
          rows.some((r) => r.state === 'kept') && (
            <div>
              <Button size="sm" kind="soft" icon="banknote" iconEnd="arrowUpRight" onClick={openSafe}>
                {tr('ws.manager.dayClose.handIn.openSafe')}
              </Button>
            </div>
          )
        )}
      </div>
    </Panel>
  );
}

/** One drawer box: its name and what it took, then the amount that moves (or its done state). */
function BoxRow({ row, busy, onChange }: { row: HandInRow; busy: boolean; onChange: (next: number | null) => void }) {
  const { tr, locale } = useLocale();
  const money = (n: number) => formatIQD(n, locale);
  const name = tr(`ws.manager.dayClose.handIn.boxes.${row.box}`);
  const took =
    row.cashOut > 0
      ? tr('ws.manager.dayClose.handIn.tookLessRefunds', { amount: money(row.cashIn), refunds: money(row.cashOut) })
      : tr('ws.manager.dayClose.handIn.took', { amount: money(row.cashIn) });
  return (
    <li
      data-testid={`hand-in-${row.box}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-3)',
        flexWrap: 'wrap',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-2-5)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
      }}
    >
      <span style={{ display: 'grid', flex: '1 1 12rem', minInlineSize: 0 }}>
        <strong>{name}</strong>
        <bdi style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
          {row.state === 'idle' ? tr('ws.manager.dayClose.handIn.noCash') : took}
        </bdi>
      </span>
      {row.state === 'open' && (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-1)', flex: '0 1 13rem', minInlineSize: 0 }}>
          <MoneyInput
            value={row.amount}
            onChange={onChange}
            max={HAND_IN_MAX_IQD}
            disabled={busy}
            aria-label={tr('ws.manager.dayClose.handIn.amountLabel', { box: name })}
            style={{ fontSize: 'var(--tp-fs-lg)' }}
          />
          {row.overNet && (
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-warn-fg)' }}>{tr('ws.manager.dayClose.handIn.overNet')}</span>
          )}
        </span>
      )}
      {row.state === 'done' && row.handedIn !== null && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', color: 'var(--tp-success-fg)', fontWeight: 600 }}>
          <Icon name="checkCircle" size={16} />
          <bdi style={{ fontVariantNumeric: 'tabular-nums' }}>{tr('ws.manager.dayClose.handIn.handedIn', { amount: money(row.handedIn) })}</bdi>
        </span>
      )}
      {row.state === 'kept' && (
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.dayClose.handIn.kept')}</span>
      )}
    </li>
  );
}
