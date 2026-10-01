/**
 * Move court (docs/design/coaching/operator.md §5.10.9; C-10, R7): the only
 * way to move a lesson's court. Same times, another court of the branch;
 * students are told the new court. The courts are read off the lesson's own
 * trading night (`useTradingNight`, the desk's rows and courts), each free or
 * taken for the lesson's whole period (`slotTaken`, through
 * lessonScreenLogic.moveCourtChoices), the current one shown and disabled.
 *
 * One app.desk_move_lesson_court call. `NO_COURT_FREE` re-reads the night (a
 * row landed meanwhile); `INVALID_TRANSITION` `held` / `ended` and
 * `COURT_NOT_FOUND` say so beside the button. Online only (CD-6).
 */
import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isolate } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Modal, Skeleton } from '../../components/ui';
import { MessagePresenter } from '../../components/kit';
import { Icon } from '../../components/icons';
import { useTradingNight } from '../desk/useTradingNight';
import { coachingErrorText } from './lessonLogic';
import type { LessonInfo } from './lessonPayloads';
import { moveCourtChoices } from './lessonScreenLogic';
import { invalidateLessonBooking } from './useCoaching';

export interface MoveCourtDialogProps {
  lesson: LessonInfo;
  /** The lesson's trading night: the rows its free courts are read from. */
  night: string;
  onClose: () => void;
}

export function MoveCourtDialog({ lesson, night, onClose }: MoveCourtDialogProps) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { reachable } = useStationReach();
  const n = useTradingNight(night);
  const id = useId();
  const [courtId, setCourtId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // isPending, not isLoading: the night's rows wait for the settings (a disabled query is pending).
  const loading = n.courtsQ.isPending || n.reservationsQ.isPending;
  const choices = moveCourtChoices(n.courts, n.reservations, lesson);
  const anyFree = choices.some((c) => c.free);
  const picked = choices.find((c) => c.court.id === courtId && c.free) ?? null;
  const blocked = !reachable
    ? tr('ws.coaching.offline.needsConnection')
    : !picked
      ? tr('ws.coaching.move.pick')
      : undefined;
  const nameOf = (c: { name_en: string; name_ar: string }) => pickName(locale, c);

  async function submit() {
    if (!picked || blocked !== undefined) return;
    setBusy(true);
    setError(null);
    try {
      // No type argument on the call: the assistant map finds callers by `appRpc('<name>'` (§5.1).
      await appRpc('desk_move_lesson_court', {
        p_lesson_id: lesson.id,
        p_court_id: picked.court.id,
      });
      invalidateLessonBooking(qc);
      toast.ok(tr('ws.coaching.move.done', { court: isolate(nameOf(picked.court)) }));
      onClose();
    } catch (e) {
      setError(e);
      invalidateLessonBooking(qc);
      // A row landed on that court meanwhile: read the night again so it shows as taken.
      if (e instanceof AppRpcError && e.code === 'NO_COURT_FREE') {
        setCourtId(null);
        void n.reservationsQ.refetch();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr('ws.coaching.move.title')}
      dismissible={!busy}
      onClose={onClose}
      size="sm"
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="court"
            busy={busy}
            disabled={blocked !== undefined}
            disabledReason={blocked}
            onClick={() => void submit()}
          >
            {tr('ws.coaching.move.submit')}
          </Button>
        </>
      )}
    >
      <p style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.coaching.move.body')}</p>
      <span
        id={`${id}-label`}
        style={{
          display: 'block',
          fontSize: 'var(--tp-fs-sm)',
          fontWeight: 600,
          marginBlockEnd: 'var(--tp-sp-2)',
        }}
      >
        {tr('ws.coaching.move.court')}
      </span>
      {loading ? (
        <Skeleton lines={3} />
      ) : (
        <div
          role="radiogroup"
          aria-labelledby={`${id}-label`}
          style={{ display: 'grid', gap: 'var(--tp-sp-2)', marginBlockEnd: 'var(--tp-sp-3)' }}
        >
          {choices.map(({ court, current, free }) => {
            const name = nameOf(court);
            const label = current
              ? tr('ws.coaching.move.current', { court: isolate(name) })
              : free
                ? name
                : tr('ws.coaching.move.taken', { court: isolate(name) });
            const selected = courtId === court.id && free;
            return (
              <label
                key={court.id}
                className="tp-choice"
                data-selected={selected ? 'true' : undefined}
                aria-disabled={!free || undefined}
                style={!free ? { opacity: 0.6 } : undefined}
              >
                <input
                  className="tp-sr-only"
                  type="radio"
                  name={`${id}-court`}
                  value={court.id}
                  checked={selected}
                  disabled={!free || busy}
                  onChange={() => {
                    setCourtId(court.id);
                    setError(null);
                  }}
                />
                <span style={{ flex: 1 }}>
                  <bdi>{label}</bdi>
                </span>
                {selected && <Icon name="check" size={16} />}
              </label>
            );
          })}
        </div>
      )}
      {!loading && !anyFree && (
        <MessagePresenter tone="refused" message={tr('ws.coaching.move.noneFree')} />
      )}
      <ErrorText
        error={error}
        message={error ? coachingErrorText(error, tr, {}, { scope: 'lesson' }) : null}
      />
    </Modal>
  );
}
