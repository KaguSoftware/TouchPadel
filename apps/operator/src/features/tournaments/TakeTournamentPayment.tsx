/**
 * Take one entry fee (docs/design/tournaments/build-contracts-2026-10-03.md
 * §1.7 settle): the till's PaymentPane over app.tournament_settle, cloned from
 * features/coaching/TakeLessonPayment.tsx.
 *
 * - `due` is the entry's `owed_iqd`, the server's figure, and
 *   `allowPartial={false}`: the exact owed, nothing else.
 * - `p_expected_owed_iqd` is that due; the server re-checks it. On
 *   TOURNAMENT_OWED_CHANGED (or TOTAL_CHANGED) the pane re-reads the entry
 *   (`refetchDue`) and stays open on the new due; a new due of 0 closes it
 *   with "Nothing left to take for this player."
 * - TOURNAMENT_NOT_PAYABLE closes the pane with its detail's line (S14).
 * - The shift gate works unchanged (PaymentPane owns it).
 *
 * One idempotency key per opened pane, sent again on a retry inside it,
 * renewed after a success. `p_device_id` stamps the till shift.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatIQD, isolate } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { PaymentPane, type PaymentMethod } from '../till/PaymentPane';
import { tournamentErrorText } from './tournamentLogic';
import { readSettleAnswer } from './tournamentPayloads';
import { invalidateTournamentMoney, useTournamentIdemKey } from './useTournaments';

export interface TournamentPayTarget {
  entryId: string;
  /** The player as the row shows them. */
  name: string;
  /** `owed_iqd`: what Take payment collects. */
  dueIqd: number;
}

export interface TakeTournamentPaymentProps {
  target: TournamentPayTarget;
  method: PaymentMethod;
  onClose: () => void;
  /** After the server took it (the toast is already shown). */
  onPaid?: () => void;
  /** Re-read the entry after TOURNAMENT_OWED_CHANGED: its new owed, or null when it is gone. */
  refetchDue: () => Promise<number | null>;
  /** A line for the caller to show once the pane has closed itself. */
  onNotice?: (text: string) => void;
}

export function TakeTournamentPayment({
  target,
  method,
  onClose,
  onPaid,
  refetchDue,
  onNotice,
}: TakeTournamentPaymentProps) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const settleKey = useTournamentIdemKey('settle');
  const [due, setDue] = useState(target.dueIqd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const money = (n: number | null | undefined) => formatIQD(n ?? 0, locale);

  // A new target is a new payment: its own key, its own due.
  useEffect(() => {
    settleKey.renew();
    setDue(target.dueIqd);
    setError(null);
    setMessage(null);
  }, [target.entryId, target.dueIqd, settleKey]);

  async function settle(m: PaymentMethod, tenderedIqd: number | null) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // No type argument on the call: the assistant map finds callers by `appRpc('<name>'`.
      const out = readSettleAnswer(
        await appRpc('tournament_settle', {
          p_entry_id: target.entryId,
          p_method: m,
          p_expected_owed_iqd: due,
          p_tendered_iqd: m === 'cash' ? tenderedIqd : null,
          p_idempotency_key: settleKey.key(),
          p_device_id: deviceId(),
        }),
      );
      settleKey.renew();
      invalidateTournamentMoney(qc);
      const took = tr('ws.tournaments.pay.took', {
        amount: money(out.amount_iqd ?? due),
        name: isolate(target.name),
      });
      const change =
        m === 'cash' && (out.change_iqd ?? 0) > 0
          ? ` ${tr('ws.tournaments.pay.change', { change: money(out.change_iqd) })}`
          : '';
      toast.ok(`${took}${change}`);
      onPaid?.();
      onClose();
    } catch (e) {
      await refused(e);
    } finally {
      setBusy(false);
    }
  }

  async function refused(e: unknown) {
    const code = e instanceof AppRpcError ? e.code : null;
    if (code === 'TOURNAMENT_OWED_CHANGED' || code === 'TOTAL_CHANGED') {
      // What this player owes moved under the desk: read it again and ask again.
      settleKey.renew();
      const next = await refetchDue();
      if (next === null || next <= 0) {
        onNotice?.(tr('ws.tournaments.pay.notPayable.nothing_owed'));
        onClose();
        return;
      }
      setDue(next);
      setError(e);
      setMessage(tr('ws.tournaments.pay.owedChanged', { amount: money(next) }));
      return;
    }
    if (code === 'TOURNAMENT_NOT_PAYABLE') {
      onNotice?.(tournamentErrorText(e, tr));
      onClose();
      return;
    }
    setError(e);
    setMessage(tournamentErrorText(e, tr));
  }

  return (
    <PaymentPane
      mode={method}
      due={due}
      busy={busy}
      error={error}
      errorMessage={message}
      subtitle={tr('ws.tournaments.pay.subtitle', { name: isolate(target.name) })}
      allowPartial={false}
      onCancel={onClose}
      onSettle={(m, _amount, tendered) => void settle(m, tendered)}
    />
  );
}
