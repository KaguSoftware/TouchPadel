/**
 * The Players panel of an open match (docs/design/open-matches/operator.md
 * §5.13): the match screen and, for a match booking, booking detail (full
 * width, first in the grid). It reads `useMatchDetail(matchId)` itself, the
 * key the match screen shares, so a write on either refreshes both.
 *
 * One row per seat number 1..4 (its carrier, or an open seat), then the seats
 * that no longer carry a number under "Earlier in this match". Every figure
 * and every `can` is the server's (app.desk_match_detail); matchLogic reads
 * them into a line and a set of buttons, and the screen-level capabilities
 * (useMatchCaps) gate what this role may press at all.
 *
 * Writes, each a direct appRpc (DF-11, online only: offline every control is
 * disabled with the reason):
 *   - attendance (app.mark_match_seats): Arrived, No-show, Undo and the two
 *     corrections, one click and optimistic on the detail, rolled back on any
 *     refusal; "Mark all arrived" in one call;
 *   - Take share, Take several and a holder's group (app.match_seat_settle)
 *     through the till's PaymentPane, due = Σ the server's `take_iqd`;
 *     SEAT_OWED_CHANGED re-reads and keeps the pane on the new due, and
 *     BOOKING_TAB_OPEN sends the desk to Assign on that bill's money;
 *   - Assign (app.match_link_payment, AssignPaymentDialog);
 *   - Write off (app.match_seat_write_off) behind a manager's PIN (R1);
 *   - Remove (app.desk_remove_seat) with the server's own reason list;
 *   - Add player (AddSeatDialog) and Call off short (CallOffDialog).
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { countPhrase, formatIQD, isolate, VENUE_TZ, type MessageKey } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { useLocale } from '../../lib/i18n';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, MATCH_REASON_CODES, PinReasonModal, REASON_CODES, Skeleton, type ReasonCode } from '../../components/ui';
import { CustomerFlagBadge, MessagePresenter, Panel, ReasonCodePrompt, StatusBadge, ViewMore, useListCap, type Tone } from '../../components/kit';
import { PaymentPane, type PaymentMethod } from '../till/PaymentPane';
import { AddSeatDialog, deskOpenNumbers } from './AddSeatDialog';
import { AssignPaymentDialog } from './AssignPaymentDialog';
import { assignableTotal, paymentOnTab } from './assignLogic';
import { CallOffDialog } from './CallOffDialog';
import {
  byCategory,
  callOffState,
  groupOwingByHolder,
  isStarted,
  markAllArrivedIds,
  matchActionsOf,
  matchErrorText,
  owingPick,
  seatActionsOf,
  seatLabelOf,
  seatLineKey,
  seatLineOf,
  seatLineParams,
  seatRows,
  openSeatLineOf,
  ticketChipOf,
  type SeatAction,
} from './matchLogic';
import type { MatchDetail, MatchSeat } from './matchPayloads';
import { MatchReadNotice } from './MatchReadNotice';
import { invalidateMatchMoney, invalidateMatchSeats, useMatchCaps, useMatchDetail, useMatchIdemKey, useMatchRead } from './useMatches';

export interface MatchPlayersPanelProps {
  matchId: string;
  /**
   * On the match screen, which already shows the read's age and the sandbox
   * line above the panel: the panel leaves both out rather than repeat them.
   */
  onMatchScreen?: boolean;
}

type Attendance = 'attended' | 'no_show' | 'in';

/** Every code op.reasons words: the server's remove list is filtered to them. */
const KNOWN_REASONS: ReadonlySet<string> = new Set<string>([...REASON_CODES, ...MATCH_REASON_CODES]);
/** Desk remove codes that count as a late leave on a booked match (db.md §4.7.6). */
const LATE_LEAVE_CODES: ReadonlySet<string> = new Set(['customer_request', 'conduct', 'other']);
const WRITE_OFF_REASONS: readonly ReasonCode[] = ['walked_out', 'staff_error', 'other'];

/**
 * The detail as the desk expects it right after a mark: the seats flipped, and
 * their buttons off until the server's answer brings the real ones back (the
 * `ReservationActionsDialog` optimistic pattern).
 */
export function optimisticMark(detail: MatchDetail, seatIds: readonly string[], attendance: Attendance): MatchDetail {
  const ids = new Set(seatIds);
  return {
    ...detail,
    seats: detail.seats.map((s) =>
      ids.has(s.seat_id)
        ? {
            ...s,
            status: attendance,
            can: { mark_attended: false, mark_no_show: false, unmark: false, remove_reasons: [], take_share: false, write_off: false, replace: false },
          }
        : s,
    ),
  };
}

export function MatchPlayersPanel({ matchId, onMatchScreen = false }: MatchPlayersPanelProps) {
  const { tr } = useLocale();
  const q = useMatchDetail(matchId);
  const status = useMatchRead(q);
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const title = tr('ws.matches.players.title');

  // RPC_MISSING: a server without matches. Nothing to show, not "offline".
  if (status.kind === 'absent') return null;
  if (status.kind === 'loading') {
    return (
      <Panel title={title} data-testid="match-players">
        <Skeleton lines={4} />
      </Panel>
    );
  }
  if (status.kind === 'failed') {
    const notFound = status.error instanceof AppRpcError && status.error.code === 'MATCH_NOT_FOUND';
    return (
      <Panel title={title} data-testid="match-players">
        {notFound ? (
          <MessagePresenter tone="refused" message={tr('ws.matches.detail.notFound')} />
        ) : (
          <MatchReadNotice status={status} onRetry={() => void q.refetch()} tz={tz} />
        )}
      </Panel>
    );
  }
  return (
    <PlayersView
      detail={status.data}
      tz={tz}
      // How long ago the payload's clock was read: "started" moves on between polls.
      elapsedMs={Math.max(0, Date.now() - status.updatedAt)}
      notice={status.stale && !onMatchScreen ? <MatchReadNotice status={status} onRetry={() => void q.refetch()} tz={tz} /> : null}
      sandboxLine={!onMatchScreen}
      refetch={async () => (await q.refetch()).data ?? null}
    />
  );
}

interface PayState {
  seatIds: string[];
  due: number;
  /** Whose money: one name, or the names of several shares. */
  name: string;
  several: boolean;
  method: PaymentMethod;
  error: unknown;
  message: string | null;
}

const CHIP_TONE: Record<string, Tone> = {
  'ws.matches.common.ticket.inUse': 'accent',
  'ws.matches.common.ticket.onHolder': 'accent',
  'ws.matches.common.ticket.back': 'success',
  'ws.matches.common.ticket.lost': 'danger',
  'ws.matches.common.ticket.held': 'warn',
  'ws.matches.common.ticket.none': 'neutral',
};

function PlayersView({
  detail,
  tz,
  elapsedMs,
  notice,
  sandboxLine,
  refetch,
}: {
  detail: MatchDetail;
  tz: string;
  elapsedMs: number;
  notice: ReactNode;
  sandboxLine: boolean;
  refetch: () => Promise<MatchDetail | null>;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const caps = useMatchCaps();
  const { reachable } = useStationReach();
  const settleKey = useMatchIdemKey('settle');

  const [rowErrors, setRowErrors] = useState<Record<string, unknown>>({});
  const [marking, setMarking] = useState<ReadonlySet<string>>(new Set());
  const [several, setSeveral] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [pay, setPay] = useState<PayState | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [writingOff, setWritingOff] = useState<MatchSeat | null>(null);
  const [removing, setRemoving] = useState<MatchSeat | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [assign, setAssign] = useState<{ focus: string | null; notice: string | null } | null>(null);
  const [callingOff, setCallingOff] = useState(false);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);

  const m = detail.match;
  const category = m.category;
  const key = QK.deskMatches.one(m.id);
  const money = (n: number | null | undefined) => formatIQD(n ?? 0, locale);
  const errorWords = (e: unknown) => matchErrorText(e, { tr, locale, tz, serverNow: m.server_now });
  const offline = tr('ws.matches.offline.needsConnection');
  const reasonOf = (a: SeatAction) =>
    a.blockedBy === 'offline' ? offline : a.blockedBy === 'notStarted' ? tr('ws.matches.players.noShowBeforeStart') : undefined;
  const joinNames = (names: readonly string[]) => names.join(locale === 'ar' ? '، ' : ', ');

  const { numbered, earlier } = seatRows(detail.seats);
  const earlierCap = useListCap(earlier);
  const started = isStarted(m, elapsedMs);
  const matchActions = matchActionsOf(m, reachable, caps);
  const actionsOf = (s: MatchSeat) => seatActionsOf(s, m, reachable, caps, elapsedMs);
  const takeable = detail.seats.filter((s) => actionsOf(s).takeShare.show).sort((a, b) => a.seat_no - b.seat_no);
  const openNumbers = deskOpenNumbers(detail.seats);
  const lowestOpen = numbered.find((n) => n.seat === null)?.seatNo;
  const filling = m.status === 'filling' || m.status === 'awaiting_court';

  // ---------------------------------------------------------------------
  // Attendance (§5.13.3)
  // ---------------------------------------------------------------------

  async function mark(seatIds: string[], attendance: Attendance) {
    if (seatIds.length === 0) return;
    setMarking((prev) => new Set([...prev, ...seatIds]));
    setRowErrors((prev) => {
      const next = { ...prev };
      for (const id of seatIds) delete next[id];
      return next;
    });
    await qc.cancelQueries({ queryKey: key });
    const before = qc.getQueryData<MatchDetail | null>(key);
    if (before) qc.setQueryData(key, optimisticMark(before, seatIds, attendance));
    try {
      await appRpc('mark_match_seats', { p_seat_ids: seatIds, p_attendance: attendance });
    } catch (e) {
      // A refusal never reverts silently: the row goes back and says why.
      if (before) qc.setQueryData(key, before);
      setRowErrors((prev) => ({ ...prev, [seatIds[0]!]: e }));
    } finally {
      setMarking((prev) => new Set([...prev].filter((id) => !seatIds.includes(id))));
      invalidateMatchSeats(qc);
    }
  }

  // ---------------------------------------------------------------------
  // Taking shares (§5.13.4, §5.13.5)
  // ---------------------------------------------------------------------

  function openPay(seatIds: readonly string[], method: PaymentMethod) {
    const pick = owingPick(detail.seats, seatIds);
    if (pick.due <= 0) return;
    const names = pick.seatIds.map((id) => seatLabelOf(detail.seats.find((s) => s.seat_id === id)!, tr));
    // A new pane is a new payment: its own key, kept across a retry inside it.
    settleKey.renew();
    setPanelNotice(null);
    setPay({ seatIds: pick.seatIds, due: pick.due, name: joinNames(names), several: pick.seatIds.length > 1, method, error: null, message: null });
  }

  async function settle(method: PaymentMethod, amountIqd: number | null, tenderedIqd: number | null) {
    if (!pay) return;
    setPayBusy(true);
    setPay({ ...pay, error: null, message: null });
    try {
      // No type argument on the call: the assistant map finds callers by `appRpc('<name>'` (§5.1).
      const out = (await appRpc('match_seat_settle', {
        p_seat_ids: pay.seatIds,
        p_method: method,
        p_expected_owed_iqd: pay.due,
        p_tendered_iqd: method === 'cash' ? tenderedIqd : null,
        p_amount_iqd: pay.several ? null : amountIqd,
        p_idempotency_key: settleKey.key(),
        p_device_id: deviceId(),
      })) as { amount_iqd?: number | null; change_iqd?: number | null } | null;
      settleKey.renew();
      invalidateMatchMoney(qc);
      const took = tr('ws.matches.take.took', { amount: money(out?.amount_iqd ?? amountIqd ?? pay.due), name: pay.name });
      const change = method === 'cash' && (out?.change_iqd ?? 0) > 0 ? ` ${tr('ws.matches.take.change', { change: money(out?.change_iqd) })}` : '';
      toast.ok(`${took}${change}`);
      setPay(null);
      setSeveral(false);
      setPicked(new Set());
    } catch (e) {
      await onSettleRefused(e);
    } finally {
      setPayBusy(false);
    }
  }

  async function onSettleRefused(e: unknown) {
    if (!pay) return;
    const code = e instanceof AppRpcError ? e.code : null;
    if (code === 'SEAT_OWED_CHANGED' || code === 'TOTAL_CHANGED') {
      // What these seats owe moved under the desk: read it again and ask again.
      settleKey.renew();
      const fresh = await refetch();
      const next = fresh ? owingPick(fresh.seats, pay.seatIds) : { seatIds: [], due: 0 };
      if (next.due <= 0) {
        setPay(null);
        setPanelNotice(tr('ws.matches.take.nothingLeft'));
        return;
      }
      setPay({ ...pay, seatIds: next.seatIds, due: next.due, error: e, message: tr('ws.matches.take.owedChanged', { amount: money(next.due) }) });
      return;
    }
    if (code === 'BOOKING_TAB_OPEN') {
      // The booking's own bill has money on it: that money is assigned first.
      setPay(null);
      const fresh = await refetch();
      const tabId = e instanceof AppRpcError ? e.details : undefined;
      const onTab = paymentOnTab(fresh?.money?.unassigned ?? detail.money?.unassigned ?? [], tabId);
      setAssign({ focus: onTab?.payment_id ?? null, notice: tr('ws.matches.take.tabOpen') });
      return;
    }
    setPay({ ...pay, error: e, message: errorWords(e) });
  }

  // ---------------------------------------------------------------------
  // Write off (§5.13.7) and Remove (§5.13.8)
  // ---------------------------------------------------------------------

  async function writeOff(pin: string, reason: ReasonCode) {
    if (!writingOff) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      await appRpc('match_seat_write_off', { p_seat_id: writingOff.seat_id, p_reason: reason, p_pin: pin, p_device_id: deviceId() });
      invalidateMatchMoney(qc);
      toast.ok(tr('ws.matches.writeOff.done', { name: seatLabelOf(writingOff, tr) }));
      setWritingOff(null);
    } catch (e) {
      setDialogError(e);
    } finally {
      setDialogBusy(false);
    }
  }

  async function remove(code: ReasonCode, note: string) {
    if (!removing) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      await appRpc('desk_remove_seat', { p_seat_id: removing.seat_id, p_reason: note ? `${code}: ${note}` : code });
      invalidateMatchSeats(qc);
      toast.ok(tr(byCategory(category, 'ws.matches.remove.done'), { name: seatLabelOf(removing, tr) }));
      setRemoving(null);
    } catch (e) {
      setDialogError(e);
      // The seat changed under the desk (SEAT_NOT_FOUND, a mark): show the server's list.
      invalidateMatchSeats(qc);
    } finally {
      setDialogBusy(false);
    }
  }

  function closeDialog() {
    setWritingOff(null);
    setRemoving(null);
    setDialogError(null);
  }

  // ---------------------------------------------------------------------
  // Rows
  // ---------------------------------------------------------------------

  function seatRow(seat: MatchSeat, isEarlier: boolean) {
    const a = actionsOf(seat);
    const name = seatLabelOf(seat, tr);
    const line = seatLineOf(seat, detail, elapsedMs);
    const chip = ticketChipOf(seat, m);
    const busy = marking.has(seat.seat_id);
    const kindKey = seat.kind === 'account' || seat.kind === 'friend' || seat.kind === 'desk' ? (`ws.matches.common.kind.${seat.kind}` as const) : null;
    const gendered = category === 'women' || category === 'men';
    const replaceHere = a.replace.show && openNumbers.length === 1 && openNumbers[0] === seat.seat_no;
    const markButton = (action: SeatAction, label: MessageKey, attendance: Attendance, primary = false) =>
      action.show && (
        <Button
          size="sm"
          kind={primary ? 'primary' : 'default'}
          disabled={action.blockedBy !== null || busy}
          disabledReason={reasonOf(action)}
          onClick={() => void mark([seat.seat_id], attendance)}
        >
          {tr(label)}
        </Button>
      );
    return (
      <li
        key={seat.seat_id}
        data-testid={`seat-${seat.seat_no}${isEarlier ? '-earlier' : ''}`}
        style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', paddingBlock: 'var(--tp-sp-3)', borderBlockStart: '1px solid var(--tp-border)' }}
      >
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          {several && a.takeShare.show && (
            <input
              type="checkbox"
              aria-label={tr('ws.matches.take.pick', { name })}
              checked={picked.has(seat.seat_id)}
              disabled={payBusy}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.target.checked) next.add(seat.seat_id);
                else next.delete(seat.seat_id);
                setPicked(next);
              }}
            />
          )}
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{tr('ws.matches.players.seatNo', { seat: String(seat.seat_no) })}</span>
          <StatusBadge size="sm" dot={false} tone="neutral" label={kindKey ? tr(kindKey) : seat.kind} />
          <strong>
            <bdi>{name}</bdi>
          </strong>
          {seat.phone && (
            <bdi dir="ltr" style={{ color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
              {seat.phone}
            </bdi>
          )}
          {seat.flags.map((f, i) => (
            <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
          ))}
          {seat.is_organiser && <StatusBadge size="sm" tone="accent" dot={false} label={tr(byCategory(category, 'ws.matches.players.organiser'))} />}
          {seat.customer_id && (
            <Link to="/desk/customers/$id" params={{ id: seat.customer_id }} style={{ color: 'var(--tp-accent)', fontWeight: 600, fontSize: 'var(--tp-fs-sm)', textDecoration: 'none' }}>
              {tr('ws.matches.players.openCustomer')}
            </Link>
          )}
        </div>
        {(seat.display_name || (gendered && seat.gender)) && (
          <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {seat.display_name && <span>{tr('ws.matches.players.playersSee', { name: isolate(seat.display_name) })}</span>}
            {gendered && seat.gender && <span>{genderLine(seat)}</span>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          {chip && <StatusBadge size="sm" tone={CHIP_TONE[chip.key] ?? 'neutral'} label={tr(chip.key, chip.params)} />}
          <span>{tr(seatLineKey(line, category), seatLineParams(line, locale, tr))}</span>
        </div>
        {seat.status === 'no_show' && a.replace.show && (
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{tr('ws.matches.players.seatFree')}</span>
            {replaceHere && (
              <Button size="sm" icon="userPlus" disabled={a.replace.blockedBy !== null} disabledReason={reasonOf(a.replace)} onClick={() => setAdding(true)}>
                {tr('ws.matches.players.addHere')}
              </Button>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          {markButton(a.arrived, 'ws.matches.players.arrived', 'attended', true)}
          {markButton(a.noShow, 'ws.matches.players.noShow', 'no_show')}
          {markButton(a.undo, 'ws.matches.players.undo', 'in')}
          {markButton(a.noShowInstead, 'ws.matches.players.noShowInstead', 'no_show')}
          {markButton(a.arrivedInstead, 'ws.matches.players.arrivedInstead', 'attended')}
          {a.takeShare.show && !several && (
            <>
              <Button size="sm" icon="banknote" disabled={a.takeShare.blockedBy !== null} disabledReason={reasonOf(a.takeShare)} onClick={() => openPay([seat.seat_id], 'cash')}>
                {tr('ws.matches.players.takeShare')}
              </Button>
              <Button
                size="sm"
                kind="ghost"
                icon="card"
                aria-label={tr('ws.matches.players.takeShareCard')}
                disabled={a.takeShare.blockedBy !== null}
                disabledReason={reasonOf(a.takeShare)}
                onClick={() => openPay([seat.seat_id], 'card')}
              >
                {tr('ws.matches.take.severalCard')}
              </Button>
            </>
          )}
          {a.writeOff.show && (
            <Button size="sm" kind="ghost" icon="minus" disabled={a.writeOff.blockedBy !== null} disabledReason={reasonOf(a.writeOff)} onClick={() => setWritingOff(seat)}>
              {tr('ws.matches.players.writeOff')}
            </Button>
          )}
          {a.remove.show && (
            <Button
              size="sm"
              kind="ghost"
              icon="x"
              disabled={a.remove.blockedBy !== null}
              disabledReason={reasonOf(a.remove)}
              onClick={() => setRemoving(seat)}
              style={{ color: 'var(--tp-danger-fg)' }}
            >
              {tr('ws.matches.players.remove')}
            </Button>
          )}
        </div>
        <ErrorText error={rowErrors[seat.seat_id] ?? null} message={rowErrors[seat.seat_id] ? errorWords(rowErrors[seat.seat_id]) : null} />
      </li>
    );
  }

  function genderLine(seat: MatchSeat): string {
    const g = seat.gender === 'female' || seat.gender === 'male' ? tr(`ws.matches.players.gender.${seat.gender}`) : (seat.gender ?? '');
    const playsAs = tr('ws.matches.players.playsAs', { gender: g });
    const source =
      seat.gender_source === 'guest'
        ? tr('ws.matches.players.source.guest')
        : seat.gender_source === 'holder'
          ? tr('ws.matches.players.source.holder', { holder: seat.holder_name ? isolate(seat.holder_name) : '—' })
          : seat.gender_source === 'desk'
            ? tr('ws.matches.players.source.desk')
            : null;
    return source ? `${playsAs} · ${source}` : playsAs;
  }

  function openRow(seatNo: number) {
    const line = openSeatLineOf(seatNo, detail, elapsedMs);
    const addHere = filling && seatNo === lowestOpen && matchActions.addSeat.show;
    return (
      <li
        key={`open-${seatNo}`}
        data-testid={`seat-${seatNo}`}
        style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap', paddingBlock: 'var(--tp-sp-3)', borderBlockStart: '1px solid var(--tp-border)' }}
      >
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{tr('ws.matches.players.seatNo', { seat: String(seatNo) })}</span>
        <span style={{ color: 'var(--tp-muted-fg)' }}>{tr(seatLineKey(line, category), seatLineParams(line, locale, tr))}</span>
        {addHere && (
          <Button
            size="sm"
            icon="userPlus"
            disabled={matchActions.addSeat.blockedBy !== null}
            disabledReason={matchActions.addSeat.blockedBy === 'offline' ? offline : undefined}
            onClick={() => setAdding(true)}
          >
            {tr('ws.matches.players.addPlayer')}
          </Button>
        )}
      </li>
    );
  }

  // ---------------------------------------------------------------------
  // Footer
  // ---------------------------------------------------------------------

  const live = !m.sandbox;
  const allArrived = caps.runMatches && live ? markAllArrivedIds(detail.seats) : [];
  const unmarkedNote = live && m.status === 'booked' && started && detail.seats.some((s) => s.carrying && s.status === 'in');
  const severalPick = owingPick(detail.seats, picked);
  const groups = caps.takeSeatPayment && live ? groupOwingByHolder(detail.seats, tr) : [];
  // The rows of money.unassigned[] (§5.13.6), a live bill's included; not the
  // booking's unassigned_iqd, which counts settled bills only (money.md §6.2).
  const unassignedTotal = assignableTotal(detail.money?.unassigned ?? []);
  const showAssign = caps.takeSeatPayment && live && unassignedTotal > 0;
  const delta = detail.money?.price_delta_iqd ?? 0;
  const callOff = caps.runMatches ? callOffState(detail, elapsedMs) : ({ state: 'hidden' } as const);
  const addFooter = !filling && matchActions.addSeat.show;

  const footer: ReactNode[] = [];
  if (allArrived.length >= 2) {
    footer.push(
      <Button key="all" icon="checkCircle" disabled={!reachable || allArrived.some((id) => marking.has(id))} disabledReason={reachable ? undefined : offline} onClick={() => void mark(allArrived, 'attended')}>
        {tr('ws.matches.players.markAll')}
      </Button>,
    );
  }
  if (addFooter) {
    footer.push(
      <Button key="add" icon="userPlus" disabled={matchActions.addSeat.blockedBy !== null} disabledReason={matchActions.addSeat.blockedBy === 'offline' ? offline : undefined} onClick={() => setAdding(true)}>
        {tr('ws.matches.players.addPlayer')}
      </Button>,
    );
  }
  if (takeable.length >= 2) {
    footer.push(
      <Button
        key="several"
        icon="split"
        aria-pressed={several}
        disabled={!reachable}
        disabledReason={reachable ? undefined : offline}
        onClick={() => {
          setSeveral((v) => !v);
          setPicked(new Set());
        }}
      >
        {tr('ws.matches.take.several')}
      </Button>,
    );
  }
  for (const g of groups) {
    footer.push(
      <Button key={`group-${g.holderSeatId}`} icon="users" disabled={!reachable} disabledReason={reachable ? undefined : offline} onClick={() => openPay(g.seatIds, 'cash')}>
        {tr('ws.matches.take.group', { name: g.holderName, amount: money(g.due) })}
      </Button>,
    );
  }
  if (callOff.state === 'needsMarks' || callOff.state === 'enabled' || callOff.state === 'blocked') {
    // Offline outranks the rest: nothing here can be done until the station is back.
    const reason = !reachable
      ? offline
      : callOff.state === 'needsMarks'
        ? tr('ws.matches.callOff.needsMarks', { players: countPhrase(category === 'women' ? 'ws.matches.count.playersF' : 'ws.matches.count.players', callOff.unmarked, locale) })
        : callOff.state === 'blocked'
          ? tr(callOff.reason)
          : undefined;
    footer.push(
      <Button
        key="calloff"
        kind="danger"
        icon="ban"
        disabled={callOff.state !== 'enabled' || !reachable}
        disabledReason={reason}
        onClick={() => setCallingOff(true)}
        style={{ marginInlineStart: 'auto' }}
      >
        {tr('ws.matches.callOff.button')}
      </Button>,
    );
  }

  const removeReasons = removing ? (removing.can.remove_reasons.filter((r) => KNOWN_REASONS.has(r)) as ReasonCode[]) : [];

  return (
    <Panel title={tr('ws.matches.players.title')} style={{ gridColumn: '1 / -1' }} data-testid="match-players">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {notice}
        {m.sandbox && sandboxLine && <MessagePresenter tone="info" icon="lock" message={tr('ws.matches.detail.sandbox')} />}
        {panelNotice && <MessagePresenter tone="refused" message={panelNotice} />}
        {several && <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.matches.take.severalLead')}</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{numbered.map((n) => (n.seat ? seatRow(n.seat, false) : openRow(n.seatNo)))}</ul>
        {earlier.length > 0 && (
          <section>
            <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, marginBlockStart: 'var(--tp-sp-2)' }}>{tr('ws.matches.players.earlier')}</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{earlierCap.shown.map((s) => seatRow(s, true))}</ul>
            <ViewMore hidden={earlierCap.hidden} open={earlierCap.open} onToggle={earlierCap.toggle} />
          </section>
        )}
        {unmarkedNote && <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.matches.players.unmarkedNote')}</p>}
        {delta !== 0 && (
          <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
            {tr('ws.matches.players.priceDelta', { delta: formatIQD(delta, locale) })}
          </p>
        )}
        {showAssign && (
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{tr('ws.matches.players.unassigned', { amount: money(unassignedTotal) })}</span>
            <Button size="sm" icon="split" disabled={!reachable} disabledReason={reachable ? undefined : offline} onClick={() => setAssign({ focus: null, notice: null })}>
              {tr('ws.matches.players.assign')}
            </Button>
          </div>
        )}
        {several && (
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <Button
              kind="primary"
              icon="banknote"
              disabled={severalPick.due <= 0 || !reachable}
              disabledReason={!reachable ? offline : tr('ws.matches.take.severalLead')}
              onClick={() => openPay(severalPick.seatIds, 'cash')}
            >
              {tr('ws.matches.take.severalButton', {
                // After the verbal noun «استلام»: the genitive dual (حصتين).
                shares: countPhrase('ws.matches.count.sharesGen', severalPick.seatIds.length, locale),
                amount: money(severalPick.due),
              })}
            </Button>
            <Button icon="card" disabled={severalPick.due <= 0 || !reachable} disabledReason={!reachable ? offline : tr('ws.matches.take.severalLead')} onClick={() => openPay(severalPick.seatIds, 'card')}>
              {tr('ws.matches.take.severalCard')}
            </Button>
          </div>
        )}
        {footer.length > 0 && <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', paddingBlockStart: 'var(--tp-sp-2)' }}>{footer}</div>}
      </div>

      {pay && (
        <PaymentPane
          mode={pay.method}
          due={pay.due}
          busy={payBusy}
          error={pay.error}
          errorMessage={pay.message}
          subtitle={pay.several ? tr('ws.matches.take.severalSubtitle', { names: pay.name }) : tr('ws.matches.take.subtitle', { name: pay.name })}
          allowPartial={!pay.several}
          onCancel={() => setPay(null)}
          onSettle={(method, amountIqd, tenderedIqd) => void settle(method, amountIqd, tenderedIqd)}
        />
      )}

      {writingOff && (
        <PinReasonModal
          title={tr('ws.matches.writeOff.title', { name: seatLabelOf(writingOff, tr) })}
          reasons={WRITE_OFF_REASONS}
          busy={dialogBusy}
          error={dialogError}
          onClose={closeDialog}
          onSubmit={(pin, reason) => void writeOff(pin, reason)}
        >
          <p style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
            {tr('ws.matches.writeOff.body', { amount: money(writingOff.money?.owed_iqd ?? writingOff.money?.take_iqd) })}
          </p>
        </PinReasonModal>
      )}

      {removing && (
        <ReasonCodePrompt
          action={tr('ws.matches.remove.action', { name: seatLabelOf(removing, tr) })}
          reasonCodes={removeReasons}
          noteMode="optional"
          busy={dialogBusy}
          // The refusal is read from its detail below, so the prompt's own generic line stays off.
          error={null}
          onCancel={closeDialog}
          onSubmit={(code, note) => void remove(code, note)}
        >
          <RemoveConsequence detail={detail} seat={removing} reasons={removeReasons} />
          {dialogError != null && <ErrorText error={dialogError} message={errorWords(dialogError)} />}
        </ReasonCodePrompt>
      )}

      {adding && <AddSeatDialog matchId={m.id} onClose={() => setAdding(false)} />}

      {assign && <AssignPaymentDialog detail={detail} focusPaymentId={assign.focus} notice={assign.notice} tz={tz} onClose={() => setAssign(null)} />}

      {callingOff && <CallOffDialog detail={detail} tz={tz} onClose={() => setCallingOff(false)} />}
    </Panel>
  );
}

/**
 * What removing this seat does (§5.13.8), by the match's state and the
 * reasons the server offers. On a booked match the late-leave codes and the
 * staff-error codes end differently; when both are offered each line names
 * its reasons.
 */
function RemoveConsequence({ detail, seat, reasons }: { detail: MatchDetail; seat: MatchSeat; reasons: readonly ReasonCode[] }) {
  const { tr } = useLocale();
  const category = detail.match.category;
  const filling = detail.match.status === 'filling' || detail.match.status === 'awaiting_court';
  const lines: string[] = [];
  if (seat.kind === 'desk') {
    lines.push(tr('ws.matches.remove.deskSeat'));
  } else if (filling) {
    lines.push(tr('ws.matches.remove.filling'));
  } else {
    const late = reasons.filter((r) => LATE_LEAVE_CODES.has(r));
    const clean = reasons.filter((r) => !LATE_LEAVE_CODES.has(r));
    const noCount = tr(byCategory(category, 'ws.matches.remove.noCount'));
    const lateLeave = tr('ws.matches.remove.lateLeave');
    const names = (codes: readonly ReasonCode[]) => codes.map((c) => tr(`op.reasons.${c}`)).join(' · ');
    if (late.length > 0 && clean.length > 0) {
      lines.push(tr('ws.matches.remove.byReason', { reasons: names(late), line: lateLeave }));
      lines.push(tr('ws.matches.remove.byReason', { reasons: names(clean), line: noCount }));
    } else if (late.length > 0) {
      lines.push(lateLeave);
    } else if (clean.length > 0) {
      lines.push(noCount);
    }
  }
  const hasFriends = seat.kind === 'account' && detail.seats.some((s) => s.holder_seat_id === seat.seat_id && s.seat_id !== seat.seat_id && s.carrying);
  if (hasFriends) lines.push(tr(byCategory(category, 'ws.matches.remove.friends')));
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', marginBlockEnd: 'var(--tp-sp-3)' }}>
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}
