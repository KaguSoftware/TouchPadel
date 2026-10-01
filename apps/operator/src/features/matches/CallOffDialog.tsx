/**
 * Call off short (docs/design/open-matches/operator.md §5.13.10; OM-47, R12,
 * R39): a started booked match with someone missing is called off, the
 * booking cancelled and nobody paying for the court. Players who came keep
 * their tickets; the ticket of anyone who did not come is lost.
 *
 * The confirmation names both lists (matchLogic.callOffNames: the no-show
 * carriers and the late leavers nobody replaced are "didn't come"), and says
 * so when money was already taken at the desk, which a manager then refunds at
 * the till. It asks for one of its two buttons (`requireChoice`): neither
 * answer is safe to take from a stray tap. app.desk_call_off_short is the
 * wall: it refuses while a carrier is unmarked (MATCH_MARK_SEATS), when
 * nobody is missing or nobody came, and after day close.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatIQD } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { ErrorText } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { byCategory, callOffNames, matchErrorText } from './matchLogic';
import type { MatchDetail } from './matchPayloads';
import { invalidateMatchSeats } from './useMatches';

export interface CallOffDialogProps {
  detail: MatchDetail;
  tz?: string;
  onClose: () => void;
}

export function CallOffDialog({ detail, tz, onClose }: CallOffDialogProps) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const category = detail.match.category;
  const { came, missing } = callOffNames(detail.seats, tr);
  // The house list join (DayClose): the Arabic comma in Arabic.
  const join = (names: readonly string[]) => (names.length > 0 ? names.join(locale === 'ar' ? '، ' : ', ') : '—');
  const deskPaid = detail.money?.desk_paid_iqd ?? 0;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('desk_call_off_short', { p_match_id: detail.match.id });
      invalidateMatchSeats(qc);
      toast.ok(tr('ws.matches.callOff.done'));
      onClose();
    } catch (e) {
      setError(e);
      // A refusal means the panel is behind (a mark, a leaver): show it the server's state.
      invalidateMatchSeats(qc);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open
      kind="danger"
      requireChoice
      busy={busy}
      title={tr('ws.matches.callOff.title')}
      confirmLabel={tr('ws.matches.callOff.confirm')}
      cancelLabel={tr('ws.matches.callOff.keep')}
      onCancel={onClose}
      onConfirm={() => void confirm()}
      body={
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <p>
            {tr(byCategory(category, 'ws.matches.callOff.came'), { names: join(came) })}{' '}
            {tr(byCategory(category, 'ws.matches.callOff.missing'), { names: join(missing) })}
          </p>
          <p>{tr(byCategory(category, 'ws.matches.callOff.body'))}</p>
          {deskPaid > 0 && <p>{tr('ws.matches.callOff.deskPaid', { amount: formatIQD(deskPaid, locale) })}</p>}
          <ErrorText error={error} message={error ? matchErrorText(error, { tr, locale, tz }) : null} />
        </div>
      }
    />
  );
}
