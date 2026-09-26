/**
 * The till shift's one dialog (wave5-addendum §2.9, §5.1; §8 Q29, Q30), in
 * three entries:
 *
 *   start  from the rail: the start panel.
 *   close  from the rail (End my shift, Close Ali's shift) and the leaving
 *          guard: count, sign, result.
 *   gate   from the payment pane and Split: whatever stands between the person
 *          and the tender. "Start your shift to take payment" opens on the
 *          start panel; someone else's open shift is closed first (a manager's
 *          PIN) and then the person's own starts; a shift open on another till
 *          only says where to end it.
 *
 * THE START PANEL. What the last shift left is prefilled (plus or minus the
 * cash taken with no shift open since, V18) and one tap confirms it: "That's
 * right". "I counted a different amount" opens the count in place. The day's
 * first shift at a till confirms the day's float; the desk's first counts its
 * box, because the day's float is the till's (§2.9.9).
 *
 * THE CLOSE. Blind (Q29): the count is typed with no expected figure anywhere
 * on the screen, then signed with the person's own PIN, or a manager's for
 * someone else's shift or a person with no PIN (the 0115 grant), and only the
 * result shows the difference, as a sign word first. The result's way on is
 * Sign out for one's own shift (§5.1: blind count, own PIN, result, Sign out).
 *
 * One Modal for the whole flow, so a step change swaps the body and the footer
 * in place rather than dropping one dialog and raising another.
 *
 * INLINE. The same flow also sits on the page itself (`inline`, TillShiftPanel):
 * at the top of /till and the desk's Today while the station's holder has no
 * shift, so the start is asked for before a guest is waiting at the tender,
 * not at the first press of Cash. There it has no Cancel of its own (the panel
 * stays until a shift is open); Cancel inside a close goes back to the start
 * of the flow, and nothing takes the focus from the till's keys.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatTime, isolate } from '@touch/i18n';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { useAuth } from '../../lib/auth';
import { armAudio } from '../../lib/audio';
import { QK } from '../../lib/queryKeys';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { AmountPad, Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { MessagePresenter, Money, Panel } from '../../components/kit';
import { MoneyInput } from '../../components/inputs';
import { FigureRow, MARK_FG, RowList } from '../ops/OpsVisuals';
import { PIN_MAX, PIN_MIN } from '../admin/staff/staffModel';
import { closeOwnShift, closeShiftWithManager, invalidateShift, openShift } from './api';
import { useTillShift } from './shiftContext';
import {
  MAX_COUNT_IQD,
  closeState,
  handoverIsMine,
  handoverPrefill,
  outcomeOf,
  shiftKey,
  startBlock,
  type CloseResult,
  type OpenResult,
  type ShiftStatus,
  type SignWith,
} from './tillShiftLogic';

/** A server refusal that says the station's shift state moved under the screen. */
function isStateRefusal(e: unknown): boolean {
  return e instanceof AppRpcError && (e.code.startsWith('TILL_SHIFT_') || e.code === 'NO_OPEN_DAY');
}

export type ShiftDialogEntry = { kind: 'start' } | { kind: 'close'; thenSignOut: boolean } | { kind: 'gate'; onReady: () => void };

interface Target {
  id: string;
  name: string;
  isMine: boolean;
}

type Phase = { kind: 'start' } | { kind: 'close'; target: Target } | { kind: 'blocked' } | { kind: 'nothing' };

const NOTE_MAX = 500;
const newKey = (intent: 'till_shift.open' | 'till_shift.close') => shiftKey(intent, crypto.randomUUID());

function initialPhase(entry: ShiftDialogEntry, ctx: ReturnType<typeof useTillShift>): Phase {
  if (entry.kind === 'start') return { kind: 'start' };
  if (entry.kind === 'close') {
    const s = ctx.lastStatus?.shift;
    return s ? { kind: 'close', target: { id: s.id, name: s.staff_name, isMine: s.is_mine } } : { kind: 'nothing' };
  }
  if (ctx.gate.kind === 'start') return { kind: 'start' };
  if (ctx.gate.kind === 'othersShift' || ctx.gate.kind === 'mineElsewhere') return { kind: 'blocked' };
  return { kind: 'nothing' };
}

export function ShiftDialog({
  entry,
  onClose,
  onDone,
  inline = false,
}: {
  entry: ShiftDialogEntry;
  /** Dismissed: the X, Esc, Cancel. */
  onClose: () => void;
  /** The flow finished. Defaults to onClose; the payment pane passes a no-op, since its gate flips to the tender by itself. */
  onDone?: () => void;
  /** On the page (TillShiftPanel) rather than in a dialog. */
  inline?: boolean;
}) {
  const ctx = useTillShift();
  const { tr, locale } = useLocale();
  const { staff, signOut } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>(() => initialPhase(entry, ctx));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const finish = onDone ?? onClose;
  const money = (n: number) => formatIQD(n, locale);
  const time = (iso: string) => formatTime(new Date(iso), locale);

  // ---- start ----------------------------------------------------------------
  const status = ctx.lastStatus;
  const handover = handoverPrefill(status, ctx.mode);
  const block = startBlock(status);
  const [counting, setCounting] = useState(false);
  const [floatIqd, setFloatIqd] = useState<number | null>(null);
  const [openNote, setOpenNote] = useState('');
  const openKey = useRef(newKey('till_shift.open'));
  const countsFirst = handover.kind === 'count' || counting;

  async function start(amount: number) {
    setBusy(true);
    setError(null);
    // A press on the till is the gesture the kitchen chime needs (lib/audio):
    // starting the shift arms it, so the separate "Start shift" strip goes.
    void armAudio();
    try {
      const res = await openShift({ floatIqd: amount, note: openNote.trim() === '' ? null : openNote.trim(), key: openKey.current });
      openKey.current = newKey('till_shift.open');
      seedStatus(res);
      invalidateShift(qc);
      const diff = res.till_shift.handover_difference_iqd;
      toast.ok(
        diff && diff > 0
          ? tr('ws.tillShift.start.startedMore', { amount: money(diff) })
          : diff && diff < 0
            ? tr('ws.tillShift.start.startedLess', { amount: money(-diff) })
            : tr('ws.tillShift.start.started'),
      );
      if (entry.kind === 'gate') entry.onReady();
      finish();
    } catch (e) {
      setError(e);
      // A refusal about the station's state (someone else's shift opened, the
      // day closed, sales still queued) means the status on screen is stale.
      if (isStateRefusal(e)) ctx.refetch();
    } finally {
      setBusy(false);
    }
  }

  /**
   * The open's own answer, written into the status at once: the payment pane's
   * gate reads it, and waiting for the refetch would show the start panel a
   * second time under the cashier's finger.
   */
  function seedStatus(res: OpenResult) {
    qc.setQueryData<ShiftStatus | null>(QK.tillShift.station(ctx.device), (prev) =>
      prev
        ? {
            ...prev,
            shift: {
              id: res.till_shift.id,
              staff_id: res.till_shift.staff_id,
              staff_name: res.till_shift.staff_name,
              is_mine: true,
              opened_at: res.till_shift.opened_at,
              opening_float_iqd: res.till_shift.opening_float_iqd,
              payment_count: 0,
              refund_count: 0,
              drawer_open_count: 0,
            },
          }
        : prev,
    );
  }

  // ---- close ----------------------------------------------------------------
  const target = phase.kind === 'close' ? phase.target : null;
  const [counted, setCounted] = useState<number | null>(null);
  const [countConfirmed, setCountConfirmed] = useState(false);
  const [chosen, setChosen] = useState<SignWith | null>(null);
  const [hasOwnPin, setHasOwnPin] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [result, setResult] = useState<CloseResult | null>(null);
  const closeKey = useRef(newKey('till_shift.close'));
  const pinRef = useRef<HTMLInputElement>(null);
  const cs = closeState({ isMine: target?.isMine ?? false, hasOwnPin, counted, countConfirmed, chosen, result });

  // Does this person have a PIN of their own? Asked once, for one's own shift:
  // a cashier with none goes straight to the manager's (SEC-34's lesson: do
  // not make somebody fail at a credential they were never issued).
  useEffect(() => {
    if (!target?.isMine || hasOwnPin !== null) return;
    let cancelled = false;
    void appRpc<boolean>('has_own_pin', {})
      .then((v) => {
        if (!cancelled) setHasOwnPin(v);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [target?.isMine, hasOwnPin]);

  function switchSign(next: SignWith) {
    setChosen(next);
    setPin('');
    setError(null);
    // A different RPC claims the key under a different name: never share one.
    closeKey.current = newKey('till_shift.close');
    requestAnimationFrame(() => pinRef.current?.focus());
  }

  async function close() {
    if (!target || counted === null || pin.length < PIN_MIN || busy) return;
    setBusy(true);
    setError(null);
    const note = closeNote.trim() === '' ? null : closeNote.trim();
    try {
      const res =
        cs.signWith === 'own'
          ? await closeOwnShift({ shiftId: target.id, countedIqd: counted, pin, note, key: closeKey.current })
          : await closeShiftWithManager({ shiftId: target.id, countedIqd: counted, managerPin: pin, note, key: closeKey.current });
      closeKey.current = newKey('till_shift.close');
      setResult(res);
      setPin('');
      // Awaited: the next step may be this person's own start panel, which
      // reads what the closed shift left in the drawer.
      await qc.invalidateQueries({ queryKey: QK.tillShift.station(ctx.device) });
      invalidateShift(qc);
    } catch (e) {
      if (e instanceof AppRpcError && e.code === 'NO_PIN_SET') {
        // No PIN after all: the manager signs, and the screen says why.
        setHasOwnPin(false);
        switchSign('manager');
      } else {
        setError(e);
        setPin('');
        if (isStateRefusal(e)) ctx.refetch();
        requestAnimationFrame(() => pinRef.current?.focus());
      }
    } finally {
      setBusy(false);
    }
  }

  /** Inline, "Cancel" inside a close returns to where the flow started; there is nothing to dismiss. */
  function resetFlow() {
    setPhase(initialPhase(entry, ctx));
    setCounting(false);
    setFloatIqd(null);
    setCounted(null);
    setCountConfirmed(false);
    setChosen(null);
    setPin('');
    setCloseNote('');
    setResult(null);
    setError(null);
  }
  /**
   * A Cancel or Done that only dismisses. Inline, the page's gate has nothing
   * to dismiss (it stays until a shift is open) except a close begun from it,
   * which goes back to where the flow started; a close the page opened
   * (the drawer's End my shift) is put away by its own onClose.
   */
  const pageGate = inline && entry.kind === 'gate';
  const dismissible = !pageGate || phase.kind === 'close';
  const dismiss = pageGate ? resetFlow : onClose;

  // ---- render -----------------------------------------------------------------
  const pad = { display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap', alignItems: 'start' } as const;
  const lead = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-3)' } as const;

  let title = tr('ws.tillShift.start.title');
  let subtitle: string | undefined;
  let body: ReactNode = null;
  let footer: ((close: () => void) => ReactNode) | undefined;

  if (phase.kind === 'nothing') {
    title = tr('ws.tillShift.drawer.none');
    body = null;
    footer = dismissible ? (x) => <Button onClick={x}>{tr('ws.tillShift.close.done')}</Button> : undefined;
  } else if (phase.kind === 'blocked') {
    const g = ctx.gate;
    if (g.kind === 'othersShift') {
      title = tr('ws.tillShift.gate.othersTitle', { name: isolate(g.name) });
      body = <p style={lead}>{tr('ws.tillShift.gate.othersLead', { name: isolate(g.name) })}</p>;
      footer = (x) => (
        <>
          {dismissible && <Button onClick={x}>{tr('common.cancel')}</Button>}
          <Button kind="primary" icon="lock" onClick={() => setPhase({ kind: 'close', target: { id: g.shiftId, name: g.name, isMine: false } })}>
            {tr('ws.tillShift.gate.closeOthers', { name: isolate(g.name) })}
          </Button>
        </>
      );
    } else {
      const station = g.kind === 'mineElsewhere' ? g.stationId : '';
      title = tr('ws.tillShift.gate.elsewhereTitle', { station: isolate(station) });
      body = <p style={lead}>{tr('ws.tillShift.gate.elsewhereLead')}</p>;
      footer = dismissible ? (x) => <Button onClick={x}>{tr('ws.tillShift.close.done')}</Button> : undefined;
    }
  } else if (phase.kind === 'start') {
    title = tr('ws.tillShift.start.title');
    subtitle = entry.kind === 'gate' ? tr(inline ? 'ws.tillShift.start.panelLead' : 'ws.tillShift.start.gateLead') : undefined;
    const refusal =
      handover.kind === 'noDay' || block === 'noDay'
        ? tr('ws.tillShift.start.noDay')
        : block === 'unsynced'
          ? tr('ws.tillShift.start.unsynced')
          : block && typeof block === 'object' && 'elsewhere' in block
            ? tr('ws.tillShift.start.elsewhere', { station: isolate(block.elsewhere) })
            : block && typeof block === 'object' && 'busy' in block
              ? tr('ws.tillShift.start.busy', { name: isolate(block.busy) })
              : null;
    const prefill = handover.kind === 'handover' || handover.kind === 'dayFloat' ? handover.prefillIqd : null;
    body = (
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {refusal && <MessagePresenter tone="refused" message={refusal} />}
        {handover.kind === 'handover' && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            <p style={{ fontSize: 'var(--tp-fs-md)' }}>
              {/* The shift before was this person's own (a restart): "You left …". last_closed
                  carries a name and no id, so it is matched by name (tillShiftLogic.handoverIsMine). */}
              {handoverIsMine(handover, staff?.displayName)
                ? tr('ws.tillShift.start.handoverYou', { amount: money(handover.leftIqd), time: time(handover.closedAt) })
                : tr('ws.tillShift.start.handover', { name: isolate(handover.from), amount: money(handover.leftIqd), time: time(handover.closedAt) })}
            </p>
            {handover.outsideIqd !== 0 && (
              <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                {handover.outsideIqd > 0
                  ? tr('ws.tillShift.start.outsideIn', { amount: money(handover.outsideIqd) })
                  : tr('ws.tillShift.start.outsideOut', { amount: money(-handover.outsideIqd) })}
              </p>
            )}
          </div>
        )}
        {handover.kind === 'dayFloat' && <p style={{ fontSize: 'var(--tp-fs-md)' }}>{tr('ws.tillShift.start.dayFloat', { amount: money(handover.prefillIqd) })}</p>}
        {handover.kind === 'count' && <p style={{ fontSize: 'var(--tp-fs-md)' }}>{tr('ws.tillShift.start.deskCount')}</p>}
        {!countsFirst && prefill !== null && !refusal && (
          // The question the two buttons answer, with the amount as the one
          // thing on the screen worth reading twice.
          <p style={{ fontSize: 'var(--tp-fs-xl)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            <bdi>{tr('ws.tillShift.start.ask', { amount: money(prefill) })}</bdi>
          </p>
        )}
        {countsFirst && handover.kind !== 'noDay' && (
          <>
            <div style={pad}>
              <Field label={tr('ws.tillShift.start.counted')} hint={tr('ws.tillShift.start.countedHint')} style={{ flex: '1 1 12rem', minInlineSize: 0, marginBlockEnd: 0 }}>
                <MoneyInput value={floatIqd} onChange={setFloatIqd} allowEmpty max={MAX_COUNT_IQD} disabled={busy} style={{ fontSize: 'var(--tp-fs-xl)' }} />
              </Field>
              <AmountPad nullable value={floatIqd} onChange={setFloatIqd} max={MAX_COUNT_IQD} disabled={busy} onConfirm={() => floatIqd !== null && void start(floatIqd)} />
            </div>
            {handover.kind !== 'count' && (
              <Field label={tr('ws.tillShift.start.note')} hint={tr('ws.tillShift.start.noteHint')} optional style={{ marginBlockEnd: 0 }}>
                <input style={inputStyle} value={openNote} maxLength={NOTE_MAX} disabled={busy} onChange={(e) => setOpenNote(e.target.value)} />
              </Field>
            )}
          </>
        )}
        <ErrorText error={error} style={{ marginBlock: 0 }} />
      </div>
    );
    const blocked = refusal !== null;
    footer = countsFirst
      ? (x) => (
          <>
            {handover.kind !== 'count' ? (
              <Button
                disabled={busy}
                onClick={() => {
                  setCounting(false);
                  setError(null);
                }}
              >
                {tr('ws.tillShift.start.back')}
              </Button>
            ) : (
              dismissible && (
                <Button onClick={x} disabled={busy}>
                  {tr('common.cancel')}
                </Button>
              )
            )}
            <Button kind="primary" icon="play" busy={busy} disabled={blocked || floatIqd === null} onClick={() => floatIqd !== null && void start(floatIqd)}>
              {tr('ws.tillShift.start.title')}
            </Button>
          </>
        )
      : () => (
          <>
            <Button
              disabled={busy || blocked || prefill === null}
              onClick={() => {
                setCounting(true);
                setFloatIqd(null);
                setError(null);
              }}
            >
              {tr('ws.tillShift.start.different')}
            </Button>
            {/* Inline on the till, the focus stays with the till's own keys. */}
            <Button kind="primary" icon="check" busy={busy} disabled={blocked || prefill === null} autoFocus={!inline} onClick={() => prefill !== null && void start(prefill)}>
              {tr('ws.tillShift.start.confirm')}
            </Button>
          </>
        );
  } else if (target) {
    title = target.isMine ? tr('ws.tillShift.close.titleMine') : tr('ws.tillShift.close.titleOthers', { name: isolate(target.name) });
    if (cs.step === 'count') {
      body = (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
          <p style={{ ...lead, marginBlockEnd: 0 }}>{tr('ws.tillShift.close.countLead')}</p>
          <div style={pad}>
            <Field label={tr('ws.tillShift.close.counted')} style={{ flex: '1 1 12rem', minInlineSize: 0, marginBlockEnd: 0 }}>
              <MoneyInput value={counted} onChange={setCounted} allowEmpty max={MAX_COUNT_IQD} style={{ fontSize: 'var(--tp-fs-xl)' }} />
            </Field>
            <AmountPad nullable value={counted} onChange={setCounted} max={MAX_COUNT_IQD} onConfirm={() => counted !== null && setCountConfirmed(true)} />
          </div>
          <Field label={tr('ws.tillShift.close.note')} optional style={{ marginBlockEnd: 0 }}>
            <input style={inputStyle} value={closeNote} maxLength={NOTE_MAX} onChange={(e) => setCloseNote(e.target.value)} />
          </Field>
        </div>
      );
      footer = (x) => (
        <>
          <Button onClick={x}>{tr('common.cancel')}</Button>
          <Button kind="primary" iconEnd="chevronEnd" disabled={!cs.canConfirmCount} onClick={() => setCountConfirmed(true)}>
            {tr('ws.tillShift.close.next')}
          </Button>
        </>
      );
    } else if (cs.step === 'sign' && counted !== null) {
      const own = cs.signWith === 'own';
      body = (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void close();
          }}
          style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}
        >
          {target.isMine && hasOwnPin === false && <MessagePresenter tone="info" icon="lock" message={tr('ws.tillShift.close.noPin')} />}
          <p style={{ fontSize: 'var(--tp-fs-md)' }}>
            {own ? tr('ws.tillShift.close.signOwn', { amount: money(counted) }) : tr('ws.tillShift.close.signManager', { amount: money(counted) })}
          </p>
          <Field label={own ? tr('ws.tillShift.close.pin') : tr('ws.tillShift.close.managerPin')} style={{ marginBlockEnd: 0 }}>
            <input
              ref={pinRef}
              style={{ ...inputStyle, fontSize: 'var(--tp-fs-2xl)', letterSpacing: '0.35em', textAlign: 'center' }}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              dir="ltr"
              value={pin}
              maxLength={PIN_MAX}
              readOnly={busy}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          {cs.ownOffered && (
            <Button kind="ghost" size="sm" disabled={busy} onClick={() => switchSign(own ? 'manager' : 'own')} style={{ justifySelf: 'start' }}>
              {own ? tr('ws.tillShift.close.useManager') : tr('ws.tillShift.close.useOwn')}
            </Button>
          )}
          <ErrorText error={error} style={{ marginBlock: 0 }} />
        </form>
      );
      footer = () => (
        <>
          <Button
            disabled={busy}
            onClick={() => {
              setCountConfirmed(false);
              setPin('');
              setError(null);
            }}
          >
            {tr('ws.tillShift.close.changeCount')}
          </Button>
          <Button kind="primary" icon="lock" busy={busy} disabled={pin.length < PIN_MIN} onClick={() => void close()}>
            {target.isMine ? tr('ws.tillShift.close.endAction') : tr('ws.tillShift.close.closeAction')}
          </Button>
        </>
      );
    } else if (cs.step === 'done' && result) {
      title = tr('ws.tillShift.close.closedTitle');
      body = <CloseOutcome result={result} />;
      const signOutAfter = target.isMine;
      footer = (x) =>
        entry.kind === 'gate' ? (
          <>
            {!pageGate && <Button onClick={x}>{tr('common.cancel')}</Button>}
            <Button kind="primary" icon="play" onClick={() => setPhase({ kind: 'start' })}>
              {tr('ws.tillShift.close.startMine')}
            </Button>
          </>
        ) : signOutAfter ? (
          <>
            {!(entry.kind === 'close' && entry.thenSignOut) && <Button onClick={finish}>{tr('ws.tillShift.close.stay')}</Button>}
            <Button
              kind="primary"
              icon="logOut"
              onClick={() => {
                finish();
                void signOut();
              }}
            >
              {tr('ws.tillShift.close.signOut')}
            </Button>
          </>
        ) : (
          <Button kind="primary" onClick={finish}>
            {tr('ws.tillShift.close.done')}
          </Button>
        );
    }
  }

  if (inline) {
    return (
      <Panel title={title} data-testid="shift-panel">
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
          {subtitle && <p style={{ ...lead, marginBlockEnd: 0 }}>{subtitle}</p>}
          {body}
          {footer && <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>{footer(dismiss)}</div>}
        </div>
      </Panel>
    );
  }

  return (
    <Modal title={title} subtitle={subtitle} dismissible={!busy} onClose={onClose} footer={footer}>
      {body}
    </Modal>
  );
}

/**
 * The difference first, as a word the colour only repeats (Q29: shown right
 * after the count), then the figures it came from, all the server's.
 */
export function CloseOutcome({ result }: { result: CloseResult }) {
  const { tr, locale } = useLocale();
  const o = outcomeOf(result.cash_variance_iqd);
  const amount = o ? formatIQD(o.magnitude, locale) : '';
  const tone = !o || o.sign === 'exact' ? 'success' : o.sign === 'short' ? 'danger' : 'warn';
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <p role="status" style={{ fontSize: 'var(--tp-fs-2xl)', fontWeight: 700, color: MARK_FG[tone] }}>
        <bdi>
          {!o || o.sign === 'exact'
            ? tr('ws.tillShift.close.exact')
            : o.sign === 'short'
              ? tr('ws.tillShift.close.short', { amount })
              : tr('ws.tillShift.close.over', { amount })}
        </bdi>
      </p>
      <RowList chevrons={false}>
        <FigureRow label={tr('ws.tillShift.figures.float')} value={<Money amount={result.opening_float_iqd} />} />
        <FigureRow label={tr('ws.tillShift.figures.cashIn')} value={<Money amount={result.cash_payments_iqd} />} />
        <FigureRow label={tr('ws.tillShift.figures.cashOut')} value={<Money amount={result.cash_refunds_iqd} />} />
        <FigureRow label={tr('ws.tillShift.figures.expected')} value={<Money amount={result.cash_expected_iqd} />} />
        <FigureRow label={tr('ws.tillShift.figures.counted')} value={<Money amount={result.cash_counted_iqd} />} />
      </RowList>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
        <p>{tr('ws.tillShift.close.leftForNext', { amount: formatIQD(result.left_in_drawer_iqd, locale) })}</p>
        {result.closed_via === 'manager_pin' && result.authorized_by_name && <p>{tr('ws.tillShift.close.signedBy', { name: isolate(result.authorized_by_name) })}</p>}
      </div>
    </div>
  );
}
