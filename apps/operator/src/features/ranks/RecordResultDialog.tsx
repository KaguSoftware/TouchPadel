/**
 * "Record a result" (app.ranks_desk_record, 0364): who played on each side, who won and,
 * optionally, the score set by set. Confirmed at once and its points written. Opened from the
 * ranks page (no booking) and from a booking's screen at the court desk (that booking, its
 * booker already on side A), where it replaces a player's report still waiting on that booking.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Modal, inputStyle } from '../../components/ui';
import { MessagePresenter, SegmentedControl } from '../../components/kit';
import { digitsOnly } from '../../components/inputs';
import {
  MAX_SETS,
  buildScore,
  recordArgs,
  recordDraft,
  recordErrors,
  seatPlayer,
  type RecordDraft,
  type RecordError,
  type SeatKey,
  type SeatPlayer,
  type Winner,
} from './ranksLogic';
import { invalidateRanks, recordResult } from './useRanks';
import { PlayerPicker } from './PlayerPicker';

const K = 'ws.ranks.record';

const ERROR_KEY: Record<RecordError, `${typeof K}.${'errorSides' | 'errorTwice' | 'errorWinner' | 'errorScore'}`> = {
  sides: `${K}.errorSides`,
  twice: `${K}.errorTwice`,
  winner: `${K}.errorWinner`,
  score: `${K}.errorScore`,
};

export function RecordResultDialog({
  reservationId = null,
  booker = null,
  onClose,
}: {
  reservationId?: string | null;
  booker?: SeatPlayer | null;
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const [d, setD] = useState<RecordDraft>(() => recordDraft({ reservationId, booker }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errors = touched ? recordErrors(d) : [];
  const seat = (k: SeatKey) => (p: SeatPlayer | null) => setD((x) => seatPlayer(x, k, p));
  const setSet = (i: number, side: 'a' | 'b', v: string) =>
    setD((x) => ({ ...x, sets: x.sets.map((s, j) => (j === i ? { ...s, [side]: digitsOnly(v).slice(0, 2) } : s)) }));

  async function submit() {
    setTouched(true);
    const args = recordArgs(d);
    if (!args) return;
    setBusy(true);
    setError(null);
    try {
      await recordResult(args);
      invalidateRanks(qc);
      toast.ok(tr(`${K}.recorded`));
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const scoreBad = touched && !buildScore(d.sets).ok;
  const sideStyle = {
    display: 'grid',
    gap: 'var(--tp-sp-3)',
    alignContent: 'start',
    padding: 'var(--tp-sp-3)',
    border: '1px solid var(--tp-border)',
    borderRadius: 'var(--tp-radius-panel)',
    minInlineSize: 0,
  } as const;
  const sideTitle = { margin: 0, fontSize: 'var(--tp-fs-md)', fontWeight: 700 } as const;

  return (
    <Modal
      title={tr(reservationId ? `${K}.titleBooking` : `${K}.title`)}
      subtitle={tr(`${K}.lead`)}
      size="lg"
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('ws.ranks.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="trophy"
            busy={busy}
            disabled={!reachable}
            onClick={() => void submit()}
            data-testid="ranks-record-submit"
          >
            {tr(`${K}.submit`)}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }} data-testid="ranks-record">
        {reservationId && <MessagePresenter tone="info" message={tr(`${K}.replaces`)} />}

        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))' }}>
          {(['a', 'b'] as const).map((side) => {
            const first = `${side}1` as SeatKey;
            const second = `${side}2` as SeatKey;
            return (
              <section key={side} style={sideStyle} aria-label={tr(side === 'a' ? `${K}.sideA` : `${K}.sideB`)}>
                <h3 style={sideTitle}>{tr(side === 'a' ? `${K}.sideA` : `${K}.sideB`)}</h3>
                <PlayerPicker
                  label={tr(`${K}.player`)}
                  value={d.seats[first]}
                  onChange={seat(first)}
                  disabled={busy}
                  invalid={touched && !d.seats[first]}
                  testId={`ranks-seat-${first}`}
                />
                <PlayerPicker
                  label={tr(`${K}.partner`)}
                  hint={tr(`${K}.partnerHint`)}
                  value={d.seats[second]}
                  onChange={seat(second)}
                  disabled={busy || !d.seats[first]}
                  testId={`ranks-seat-${second}`}
                />
              </section>
            );
          })}
        </div>

        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <span id="ranks-winner-label" style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
            {tr(`${K}.winner`)}
          </span>
          <div>
            <SegmentedControl<Winner | 'none'>
              aria-labelledby="ranks-winner-label"
              value={d.winner ?? 'none'}
              onChange={(w) => setD((x) => ({ ...x, winner: w === 'none' ? null : w }))}
              options={[
                { value: 'a', label: tr(`${K}.winnerA`), testId: 'ranks-winner-a' },
                { value: 'b', label: tr(`${K}.winnerB`), testId: 'ranks-winner-b' },
                { value: 'draw', label: tr(`${K}.winnerDraw`), testId: 'ranks-winner-draw' },
              ]}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr(`${K}.score`)}</span>
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr(`${K}.scoreHint`)}</span>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 3.25rem auto 3.25rem auto',
              alignItems: 'center',
              justifyContent: 'start',
              columnGap: 'var(--tp-sp-2)',
              rowGap: 'var(--tp-sp-1-5)',
            }}
          >
            <span />
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', textAlign: 'center' }}>
              {tr(`${K}.winnerA`)}
            </span>
            <span />
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', textAlign: 'center' }}>
              {tr(`${K}.winnerB`)}
            </span>
            <span />
            {d.sets.map((s, i) => {
              const n = formatNumber(i + 1, locale);
              const setName = tr(`${K}.set`, { n });
              return (
                <SetRow
                  key={i}
                  name={setName}
                  a={s.a}
                  b={s.b}
                  bad={scoreBad}
                  disabled={busy}
                  onA={(v) => setSet(i, 'a', v)}
                  onB={(v) => setSet(i, 'b', v)}
                  removeLabel={i > 0 ? tr(`${K}.removeSet`, { n }) : null}
                  onRemove={() => setD((x) => ({ ...x, sets: x.sets.filter((_, j) => j !== i) }))}
                  testId={`ranks-set-${i + 1}`}
                  labelA={tr(`${K}.winnerA`)}
                  labelB={tr(`${K}.winnerB`)}
                />
              );
            })}
          </div>
          {d.sets.length < MAX_SETS && (
            <div>
              <Button
                size="sm"
                kind="ghost"
                icon="plus"
                disabled={busy}
                onClick={() => setD((x) => ({ ...x, sets: [...x.sets, { a: '', b: '' }] }))}
                data-testid="ranks-add-set"
              >
                {tr(`${K}.addSet`)}
              </Button>
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <ul
            role="alert"
            style={{
              margin: 0,
              paddingBlock: 'var(--tp-sp-2)',
              paddingInline: 'var(--tp-sp-3)',
              listStyle: 'none',
              display: 'grid',
              gap: 'var(--tp-sp-1)',
              color: 'var(--tp-danger-fg)',
              background: 'var(--tp-danger-soft)',
              borderRadius: 'var(--tp-radius-ctl)',
              fontSize: 'var(--tp-fs-sm)',
            }}
            data-testid="ranks-record-errors"
          >
            {errors.map((e) => (
              <li key={e}>{tr(ERROR_KEY[e])}</li>
            ))}
          </ul>
        )}
        <ErrorText error={error} style={{ marginBlock: 0 }} />
      </div>
    </Modal>
  );
}

function SetRow({
  name,
  a,
  b,
  bad,
  disabled,
  onA,
  onB,
  removeLabel,
  onRemove,
  testId,
  labelA,
  labelB,
}: {
  labelA: string;
  labelB: string;
  name: string;
  a: string;
  b: string;
  bad: boolean;
  disabled: boolean;
  onA: (v: string) => void;
  onB: (v: string) => void;
  removeLabel: string | null;
  onRemove: () => void;
  testId: string;
}) {
  const half = a.trim() !== '' !== (b.trim() !== '');
  const box = {
    ...inputStyle,
    inlineSize: '3.25rem',
    textAlign: 'center' as const,
    fontVariantNumeric: 'tabular-nums',
    borderColor: bad && half ? 'var(--tp-danger-mark)' : undefined,
  };
  return (
    <>
      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', whiteSpace: 'nowrap' }}>{name}</span>
      <input
        style={box}
        dir="ltr"
        inputMode="numeric"
        aria-label={`${name}, ${labelA}`}
        value={a}
        disabled={disabled}
        onChange={(e) => onA(e.target.value)}
        data-testid={`${testId}-a`}
      />
      <span aria-hidden="true" style={{ color: 'var(--tp-muted-fg)' }}>
        –
      </span>
      <input
        style={box}
        dir="ltr"
        inputMode="numeric"
        aria-label={`${name}, ${labelB}`}
        value={b}
        disabled={disabled}
        onChange={(e) => onB(e.target.value)}
        data-testid={`${testId}-b`}
      />
      {removeLabel ? (
        <Button kind="ghost" size="sm" icon="x" aria-label={removeLabel} title={removeLabel} disabled={disabled} onClick={onRemove} />
      ) : (
        <span />
      )}
    </>
  );
}
