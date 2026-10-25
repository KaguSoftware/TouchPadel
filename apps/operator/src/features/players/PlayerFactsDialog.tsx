/**
 * The customer record's Player editor (0368; customers contracts §5): the age
 * band the desk fills in, and the level a coach, the desk, a manager or the
 * owner confirms after seeing someone play, with a one-line note.
 *
 * The two facts sit in one dialog because the desk asks them in one
 * conversation. Only what changed is written (playerLogic.saveSteps), and
 * "Not confirmed" clears the judgment so the player's own answer stands again.
 * A reader (anyone without judgePlayerLevel) sees the same dialog with every
 * control off, because knowing a player's level is useful even when setting it
 * is not yours.
 */
import { useState } from 'react';
import { formatDate, formatNumber, isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { MessagePresenter, SegmentedControl } from '../../components/kit';
import { useSavePlayerFacts } from './usePlayers';
import {
  AGE_BANDS,
  INTEREST_TAGS,
  NOTE_MAX,
  PLAY_LEVELS,
  draftDirty,
  draftErrors,
  draftOf,
  saveSteps,
  type AgeBand,
  type PlayLevel,
  type PlayerFacts,
} from './playerLogic';

const K = 'ws.players';

export function PlayerFactsDialog({
  customerId,
  customerName,
  facts,
  canJudge,
  tz,
  onClose,
}: {
  customerId: string;
  customerName: string;
  facts: PlayerFacts;
  canJudge: boolean;
  tz: string;
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const { reachable } = useStationReach();
  const save = useSavePlayerFacts(customerId);
  const [draft, setDraft] = useState(() => draftOf(facts));
  const [error, setError] = useState<unknown>(null);
  const errors = draftErrors(draft);
  const dirty = draftDirty(draft, facts);
  const busy = save.isPending;
  const offline = tr(`${K}.offline`);
  const disabled = !canJudge || busy || !reachable;

  async function write() {
    if (!dirty || errors.note) return;
    setError(null);
    try {
      await save.mutateAsync(saveSteps(draft, facts));
      toast.ok(tr(`${K}.dialog.saved`, { name: isolate(customerName) }));
      onClose();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Modal
      title={tr(`${K}.dialog.title`)}
      subtitle={<bdi>{customerName}</bdi>}
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            busy={busy}
            disabled={disabled || !dirty || !!errors.note}
            disabledReason={!canJudge ? tr(`${K}.dialog.readerOnly`) : !reachable ? offline : undefined}
            onClick={() => void write()}
          >
            {tr('common.save')}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        {!canJudge && <MessagePresenter tone="refused" icon="lock" message={tr(`${K}.dialog.readerOnly`)} />}

        {/* The age band: six chips, one tap, the same six the app asks. */}
        <section style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{tr(`${K}.dialog.band`)}</h3>
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr(`${K}.dialog.bandHint`)}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)' }}>
            {AGE_BANDS.map((band) => (
              <Chip
                key={band}
                label={tr(`${K}.band.${band}`)}
                selected={draft.band === band}
                disabled={disabled}
                onClick={() => setDraft((d) => ({ ...d, band: d.band === band ? null : (band as AgeBand) }))}
              />
            ))}
          </div>
        </section>

        {/* The level, and whether the club has judged it. */}
        <section style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{tr(`${K}.dialog.level`)}</h3>
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {facts.claimedLevel
              ? tr(`${K}.dialog.levelHint`, { level: tr(`${K}.level.${facts.claimedLevel}`) })
              : tr(`${K}.dialog.levelHintNoClaim`)}
          </p>
          <SegmentedControl<PlayLevel | 'none'>
            aria-label={tr(`${K}.dialog.level`)}
            value={draft.level ?? 'none'}
            onChange={(next) => setDraft((d) => ({ ...d, level: next === 'none' ? null : next, note: next === 'none' ? '' : d.note }))}
            options={[
              { value: 'none', label: tr(`${K}.dialog.notConfirmed`), disabled, testId: 'player-level-none' },
              ...PLAY_LEVELS.map((l) => ({ value: l, label: tr(`${K}.level.${l}`), disabled, testId: `player-level-${l}` })),
            ]}
          />
          {facts.suggested && (
            <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)' }}>
              {tr(`${K}.dialog.suggested`, {
                level: tr(`${K}.level.${facts.suggested.level}`),
                games: formatNumber(facts.suggested.games, locale),
                wins: formatNumber(facts.suggested.wins, locale),
                losses: formatNumber(facts.suggested.losses, locale),
              })}
            </p>
          )}
          <Field
            label={tr(`${K}.dialog.note`)}
            hint={tr(`${K}.dialog.noteHint`)}
            optional
            error={errors.note ? tr(`${K}.dialog.note${errors.note === 'long' ? 'Long' : 'NoLevel'}`) : undefined}
            style={{ marginBlockEnd: 0 }}
          >
            <input
              style={inputStyle}
              value={draft.note}
              maxLength={NOTE_MAX}
              disabled={disabled || draft.level === null}
              placeholder={tr(`${K}.dialog.notePlaceholder`)}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              data-testid="player-note"
            />
          </Field>
          {facts.confirmedAt && (
            <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {tr(`${K}.card.confirmedBy`, {
                who: isolate(facts.confirmedByName ?? tr(`${K}.card.someone`)),
                role: tr(`${K}.role.${facts.confirmedRole ?? 'court_desk'}`),
                date: formatDate(new Date(facts.confirmedAt), locale, tz),
              })}
            </p>
          )}
        </section>

        {/* What the club worked out on its own: read-only, and it says so. */}
        <section style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{tr(`${K}.dialog.interests`)}</h3>
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr(`${K}.dialog.interestsHint`)}</p>
          {facts.interests.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr(`${K}.card.noInterests`)}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)' }}>
              {INTEREST_TAGS.filter((t) => facts.interests.includes(t)).map((tag) => (
                <li
                  key={tag}
                  style={{
                    fontSize: 'var(--tp-fs-xs)',
                    fontWeight: 600,
                    borderRadius: 'var(--tp-radius-chip)',
                    paddingInline: 'var(--tp-sp-2)',
                    paddingBlock: 'var(--tp-sp-1)',
                    background: 'var(--tp-breakdown-violet)',
                    color: 'var(--tp-breakdown-violet-fg)',
                  }}
                >
                  {tr(`${K}.interest.${tag}`)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}

/** One tappable chip: the dialog's age band picker, nothing else uses it yet. */
function Chip({
  label,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      style={{
        minBlockSize: 'var(--tp-touch)',
        paddingInline: 'var(--tp-sp-3)',
        borderRadius: 'var(--tp-radius-pill)',
        border: `1px solid ${selected ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
        background: selected ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
        color: selected ? 'var(--tp-accent-soft-fg)' : 'var(--tp-fg)',
        fontWeight: selected ? 700 : 500,
        fontSize: 'var(--tp-fs-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}
