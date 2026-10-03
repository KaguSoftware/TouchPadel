/**
 * "Publish as tournament" (docs/design/tournaments/build-contracts-2026-10-03.md
 * §1.6 publish, §1.9; plan §5.1 "Publish"), opened from a done tournament run
 * on the run sheet. Logic in publishLogic.ts.
 *
 * The name, class, fee, capacity and courts are the plan's and read-only; the
 * desk picks the format (type 2, or confirms the plan's), the category, the
 * points per game, Mexicano's rounds, the minimum, the waitlist, the cut-off
 * and the prizes. `fee_not_approved` explains itself: the feasibility step's
 * owner OK is what lets a fee through. On success it offers "Open tournament".
 */
import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatIQD, formatNumber, isolate, type MessageKey } from '@touch/i18n';
import {
  TOUR_CATEGORIES,
  TOUR_FORMATS,
  type TourCategory,
  type TourFormat,
} from '@touch/core/tournaments';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, Field, Modal, inputStyle } from '../../components/ui';
import { MessagePresenter, SegmentedControl } from '../../components/kit';
import {
  draftFromPlan,
  fieldOfSetting,
  planBlocker,
  publishErrors,
  publishSettings,
  readPlanFacts,
  type PublishDraft,
  type PublishField,
  type PublishFieldError,
} from './publishLogic';
import { codeOf, pickName, refusedSetting, tournamentErrorText } from './tournamentLogic';
import { readPublishAnswer } from './tournamentPayloads';
import { invalidateTournamentCourts, useTournamentIdemKey } from './useTournaments';

export function PublishDialog({
  runId,
  data,
  tz,
  onClose,
}: {
  runId: string;
  /** The run's plan (`protocol_runs.data`). */
  data: unknown;
  tz: string;
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { reachable } = useStationReach();
  const key = useTournamentIdemKey('publish');
  const facts = useMemo(() => readPlanFacts(data), [data]);
  const [draft, setDraft] = useState<PublishDraft>(() => draftFromPlan(facts, tz));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [serverField, setServerField] = useState<PublishField | null>(null);
  const [published, setPublished] = useState<{ id: string; unblocked: number } | null>(null);
  const blocker = planBlocker(facts);
  const errors = publishErrors(draft, facts, tz, Date.now());
  const invalid = Object.keys(errors).length > 0;

  function set<F extends PublishField>(field: F, value: PublishDraft[F]) {
    setDraft((d) => ({ ...d, [field]: value }));
    if (serverField === field) setServerField(null);
  }

  function errorText(field: PublishField): string | undefined {
    if (serverField === field && error) return tr('ws.tournaments.publish.refused.settings');
    const e: PublishFieldError | undefined = tried ? errors[field] : undefined;
    if (!e) return undefined;
    switch (e.kind) {
      case 'required':
        return tr('ws.tournaments.publish.errors.required');
      case 'range':
        return tr('ws.tournaments.publish.errors.range', {
          min: formatNumber(e.min, locale),
          max: formatNumber(e.max, locale),
        });
      case 'tooLong':
        return tr('ws.tournaments.publish.errors.tooLong', { max: formatNumber(e.max, locale) });
      case 'cutoffPast':
        return tr('ws.tournaments.publish.errors.cutoffPast');
      case 'cutoffLate':
        return tr('ws.tournaments.publish.errors.cutoffLate', {
          time: facts.firstStart ? formatDateTime(new Date(facts.firstStart), locale, tz) : '—',
        });
    }
  }

  async function submit() {
    setTried(true);
    if (invalid || blocker || !reachable) return;
    setBusy(true);
    setError(null);
    setServerField(null);
    try {
      const out = readPublishAnswer(
        await appRpc('tournament_publish', {
          p_run_id: runId,
          p_settings: publishSettings(draft, tz),
          p_idempotency_key: key.key(),
        }),
      );
      key.renew();
      toast.ok(tr('ws.tournaments.publish.published'));
      invalidateTournamentCourts(qc);
      if (out.tournament_id)
        setPublished({ id: out.tournament_id, unblocked: out.unblocked_windows.length });
      else onClose();
    } catch (e) {
      // A refused key is spent: the next try is a new write.
      if (codeOf(e) === 'TOURNAMENT_PUBLISH_REFUSED') key.renew();
      setServerField(fieldOfSetting(refusedSetting(e)));
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (published) {
    return (
      <Modal
        title={tr('ws.tournaments.publish.published')}
        onClose={onClose}
        size="sm"
        footer={
          <>
            <Button onClick={onClose}>{tr('common.close')}</Button>
            <Button
              kind="primary"
              icon="trophy"
              onClick={() =>
                void navigate({ to: '/desk/tournaments/$id', params: { id: published.id } })
              }
            >
              {tr('ws.tournaments.publish.openTournament')}
            </Button>
          </>
        }
      >
        {published.unblocked > 0 && (
          <MessagePresenter
            tone="info"
            message={tr('ws.tournaments.publish.unblocked', {
              count: formatNumber(published.unblocked, locale),
            })}
          />
        )}
      </Modal>
    );
  }

  const formatOptions = TOUR_FORMATS.map((f: TourFormat) => ({
    value: f,
    label: tr(`tournaments.common.format.${f}`),
    // The plan's own format is fixed (type 1 / type 3); type 2 picks one.
    disabled: busy || (facts.format !== null && f !== facts.format),
  }));
  const categoryOptions = TOUR_CATEGORIES.map((c: TourCategory) => ({
    value: c,
    label: tr(`ws.matches.common.category.${c}`),
    disabled: busy,
  }));
  const num = (
    field: 'pointsTarget' | 'rounds' | 'minEntries' | 'waitlistMax',
    label: MessageKey,
    hint?: MessageKey,
  ) => (
    <Field label={tr(label)} hint={hint ? tr(hint) : undefined} error={errorText(field)}>
      <input
        style={inputStyle}
        inputMode="numeric"
        dir="ltr"
        value={draft[field]}
        disabled={busy}
        onChange={(e) => set(field, e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
      />
    </Field>
  );
  const refusal = error && !serverField ? tournamentErrorText(error, tr) : null;

  return (
    <Modal
      title={tr('ws.tournaments.publish.title')}
      subtitle={tr('ws.tournaments.publish.lead')}
      onClose={onClose}
      dismissible={!busy}
      size="md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            busy={busy}
            disabled={blocker !== null || !reachable}
            disabledReason={!reachable ? tr('ws.tournaments.detail.offline') : undefined}
            onClick={() => void submit()}
          >
            {tr('ws.tournaments.publish.submit')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="publish-dialog">
        {blocker && (
          <MessagePresenter
            tone="refused"
            message={tr(`ws.tournaments.publish.refused.${blocker}`)}
          />
        )}
        <dl
          style={{
            margin: 0,
            display: 'grid',
            gap: 'var(--tp-sp-1) var(--tp-sp-4)',
            gridTemplateColumns: 'auto 1fr',
          }}
        >
          <dt style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.tournaments.publish.name')}</dt>
          <dd style={{ margin: 0, fontWeight: 600 }}>
            <bdi>{pickName(locale, facts.nameEn, facts.nameAr)}</bdi>
            {facts.tournamentClass ? ` · ${facts.tournamentClass}` : ''}
          </dd>
          <dt style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.tournaments.publish.fee')}</dt>
          <dd style={{ margin: 0 }}>
            {facts.feeIqd > 0 ? formatIQD(facts.feeIqd, locale) : tr('tournaments.common.free')}
            <span
              style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}
            >
              {tr('ws.tournaments.publish.feeHint')}
            </span>
          </dd>
          <dt style={{ color: 'var(--tp-muted-fg)' }}>
            {tr('ws.tournaments.detail.facts.players')}
          </dt>
          <dd style={{ margin: 0 }}>
            {tr('ws.tournaments.publish.capacity', {
              count: formatNumber(facts.maxEntries, locale),
            })}
          </dd>
          <dt style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.tournaments.publish.courts')}</dt>
          <dd style={{ margin: 0 }}>
            {isolate(formatNumber(new Set(facts.windows.map((w) => w.courtId)).size, locale))}
          </dd>
        </dl>

        <Field label={tr('ws.tournaments.publish.format')} error={errorText('format')} group>
          <SegmentedControl<TourFormat>
            value={(draft.format || facts.format || 'americano') as TourFormat}
            onChange={(v) => set('format', v)}
            options={formatOptions}
          />
        </Field>
        <Field label={tr('ws.tournaments.publish.category')} error={errorText('category')} group>
          <SegmentedControl<TourCategory>
            value={draft.category}
            onChange={(v) => set('category', v)}
            options={categoryOptions}
          />
        </Field>
        <div
          style={{
            display: 'grid',
            gap: 'var(--tp-sp-3)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
          }}
        >
          {num(
            'pointsTarget',
            'ws.tournaments.publish.pointsTarget',
            'ws.tournaments.publish.pointsTargetHint',
          )}
          {draft.format === 'mexicano' &&
            num('rounds', 'ws.tournaments.publish.rounds', 'ws.tournaments.publish.roundsHint')}
          {num('minEntries', 'ws.tournaments.publish.minEntries')}
          {num('waitlistMax', 'ws.tournaments.publish.waitlist')}
        </div>
        <Field
          label={tr('ws.tournaments.publish.cutoff')}
          hint={tr('ws.tournaments.publish.cutoffHint')}
          error={errorText('cutoffDate')}
          group
        >
          <span style={{ display: 'flex', gap: 'var(--tp-sp-2)' }}>
            <input
              type="date"
              aria-label={tr('ws.tournaments.publish.cutoffDay')}
              style={inputStyle}
              value={draft.cutoffDate}
              disabled={busy}
              onChange={(e) => set('cutoffDate', e.target.value)}
            />
            <input
              type="time"
              aria-label={tr('ws.tournaments.publish.cutoffTime')}
              style={inputStyle}
              value={draft.cutoffTime}
              disabled={busy}
              onChange={(e) => set('cutoffTime', e.target.value)}
            />
          </span>
        </Field>
        <div
          style={{
            display: 'grid',
            gap: 'var(--tp-sp-3)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
          }}
        >
          <Field label={tr('ws.tournaments.publish.prizeEn')} error={errorText('prizeEn')} optional>
            <input
              style={inputStyle}
              dir="ltr"
              value={draft.prizeEn}
              disabled={busy}
              maxLength={220}
              onChange={(e) => set('prizeEn', e.target.value)}
            />
          </Field>
          <Field label={tr('ws.tournaments.publish.prizeAr')} error={errorText('prizeAr')} optional>
            <input
              style={inputStyle}
              dir="rtl"
              value={draft.prizeAr}
              disabled={busy}
              maxLength={220}
              onChange={(e) => set('prizeAr', e.target.value)}
            />
          </Field>
        </div>
        {refusal && (
          <p
            role="alert"
            style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}
          >
            {refusal}
          </p>
        )}
      </div>
    </Modal>
  );
}
