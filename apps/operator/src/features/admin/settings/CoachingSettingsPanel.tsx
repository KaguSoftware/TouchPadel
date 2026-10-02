/**
 * Owner → Settings → Venue details: the lesson rules of this branch
 * (docs/design/coaching/operator.md §5.12). Reads app.coaching_settings and
 * writes app.set_coaching_settings with only the keys that changed, for the
 * branch the rail shows (p_venue_id = currentBranchId()).
 *
 * Its own draft and its own Save, like the open-match rules above it, so
 * saving one never sends the other. The owner edits (`editVenueDetails`); a
 * manager reads the same rules as Facts with "Only the owner can change
 * these." A server without coaching (RPC_MISSING) shows nothing. Saving is
 * online only (CD-6).
 *
 * The two online payment modes stay disabled, with the reason shown, until
 * the lessons terms version is live (C-26, R50, R67: `online_payments_available`).
 * A refusal lands on its field: INVALID_ARGUMENT names the settings key,
 * ONLINE_PAYMENT_OFF (`provider` / `terms`) lands on the payment mode.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatNumber, isolateLtr, type MessageKey } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { QK } from '../../../lib/queryKeys';
import { useStationReach } from '../../../lib/stationReach';
import { currentBranchId } from '../../../lib/venueScope';
import { useToast } from '../../../components/toast';
import { Switch } from '../../../components/Switch';
import { Button, ErrorText, Field, Skeleton, inputStyle } from '../../../components/ui';
import { MessagePresenter, Panel, SegmentedControl, StatusBadge } from '../../../components/kit';
import { LessonReadNotice } from '../../coaching/LessonReadNotice';
import { coachingErrorText } from '../../coaching/lessonLogic';
import {
  LESSON_PAYMENT_MODES,
  readCoachingSettings,
  type CoachingSettings,
  type LessonPaymentMode,
} from '../../coaching/lessonPayloads';
import {
  invalidateCoachingSettings,
  useCoachingSettings,
  useLessonRead,
} from '../../coaching/useCoaching';
import { Facts, NumberField } from './settingsFields';
import {
  COACH_MAX_OPEN_PRIVATE,
  bpToPercentText,
  coachingSettingsErrors,
  coachingSettingsPatch,
  draftFromCoachingSettings,
  isOnlineMode,
  onlineModeBlock,
  onlineRefusalOf,
  percentInput,
  serverFieldOf,
  type CoachingSettingsDraft,
  type CoachingSettingsField,
  type CoachingSettingsFieldError,
  type OnlineBlockReason,
} from './coachingSettingsLogic';

const K = 'ws.coaching.settings';

export function CoachingSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const { tr } = useLocale();
  const branch = currentBranchId();
  const q = useCoachingSettings(branch);
  const status = useLessonRead(q);

  if (status.kind === 'absent') return null;

  return (
    <Panel title={tr(`${K}.title`)} data-testid="coaching-settings">
      {status.kind === 'loading' && <Skeleton lines={4} />}
      <LessonReadNotice status={status} onRetry={() => void q.refetch()} />
      {status.kind === 'ready' &&
        (canEdit ? (
          <CoachingSettingsForm saved={status.data} />
        ) : (
          <CoachingSettingsFacts settings={status.data} />
        ))}
    </Panel>
  );
}

/** The share as the owner reads it: "62.5%" (Latin digits, the catalog's percent sign). */
function useShareText() {
  const { tr } = useLocale();
  return (bp: number | null) =>
    bp == null ? null : isolateLtr(`${bpToPercentText(bp)}${tr('ws.kit.common.percent')}`);
}

/** A manager's view: the same rules, read-only, and who can change them. */
function CoachingSettingsFacts({ settings: s }: { settings: CoachingSettings }) {
  const { tr, locale } = useLocale();
  const share = useShareText();
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <MessagePresenter tone="info" icon="lock" message={tr(`${K}.ownerOnly`)} />
      <Facts
        rows={[
          {
            label: tr(`${K}.enabled`),
            value: tr(s.coaching_enabled ? `${K}.on` : `${K}.off`),
            hint: tr(s.coaching_enabled ? `${K}.onHint` : `${K}.offHint`),
          },
          {
            label: tr(`${K}.paymentMode`),
            value: tr(`ws.coaching.common.lessonPaymentMode.${s.lesson_payment_mode}`),
            hint: tr(`${K}.paymentModeHint`),
          },
          {
            label: tr(`${K}.coachShare`),
            value: share(s.coach_share_bp),
            empty: '—',
            hint: tr(`${K}.coachShareHint`),
          },
          {
            label: tr(`${K}.pricesPublic`),
            value: tr(s.lesson_prices_public ? `${K}.shown` : `${K}.hidden`),
            hint: tr(`${K}.pricesPublicHint`),
          },
          {
            label: tr(`${K}.maxOpenPrivate`),
            value:
              s.coach_max_open_private == null
                ? null
                : formatNumber(s.coach_max_open_private, locale),
            empty: '—',
            hint: tr(`${K}.maxOpenPrivateHint`),
          },
        ]}
      />
    </div>
  );
}

/** The owner's form: its own draft, its own Save, only the changed keys sent. */
function CoachingSettingsForm({ saved }: { saved: CoachingSettings }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { reachable } = useStationReach();
  const [draft, setDraft] = useState<CoachingSettingsDraft>(() => draftFromCoachingSettings(saved));
  const [tried, setTried] = useState(false);
  const [serverField, setServerField] = useState<CoachingSettingsField | null>(null);
  const [onlineRefused, setOnlineRefused] = useState<OnlineBlockReason | null>(null);

  // A save (this one's answer, or another owner's) resets the form to what is stored.
  useEffect(() => setDraft(draftFromCoachingSettings(saved)), [saved]);

  const errors = coachingSettingsErrors(draft);
  const invalid = Object.keys(errors).length > 0;
  const patch = invalid ? null : coachingSettingsPatch(saved, draft);
  const dirty = invalid
    ? JSON.stringify(draft) !== JSON.stringify(draftFromCoachingSettings(saved))
    : Object.keys(patch ?? {}).length > 0;
  const blocked = onlineModeBlock(saved, onlineRefused);

  const save = useMutation({
    mutationFn: async () =>
      readCoachingSettings(
        await appRpc('set_coaching_settings', {
          p_venue_id: currentBranchId(),
          p_patch: patch ?? {},
        }),
      ),
    onSuccess: (next) => {
      toast.ok(tr(`${K}.saved`));
      setTried(false);
      setServerField(null);
      setOnlineRefused(null);
      // The answer IS the new settings; the refresh is for the desk's envelope (desk_lessons).
      if (next.venue_id !== null) qc.setQueryData(QK.coaching.settings(currentBranchId()), next);
      invalidateCoachingSettings(qc);
    },
    onError: (e) => {
      if (!(e instanceof AppRpcError)) return;
      if (e.code === 'INVALID_ARGUMENT') {
        const field = serverFieldOf(e.details);
        if (field) setServerField(field);
      } else if (e.code === 'ONLINE_PAYMENT_OFF') {
        setServerField('paymentMode');
        setOnlineRefused(onlineRefusalOf(e.details ?? e.hint));
      }
    },
  });

  function set<F extends CoachingSettingsField>(field: F, value: CoachingSettingsDraft[F]) {
    setDraft((d) => ({ ...d, [field]: value }));
    if (serverField === field) setServerField(null);
  }

  /** A problem shows once Save was pressed, or when the server refused that field. */
  function errorFor(field: CoachingSettingsField): string | undefined {
    if (serverField === field && save.error) {
      // The server's own line for its refusal (the online reasons, or "not accepted").
      if (save.error instanceof AppRpcError && save.error.code === 'ONLINE_PAYMENT_OFF') {
        return coachingErrorText(save.error, tr, {}, { scope: 'settings' });
      }
      return tr(`${K}.errors.refused`);
    }
    const e: CoachingSettingsFieldError | undefined = tried ? errors[field] : undefined;
    if (!e) return undefined;
    if (e === 'range') {
      return tr(`${K}.errors.range`, {
        min: formatNumber(COACH_MAX_OPEN_PRIVATE.min, locale),
        max: formatNumber(COACH_MAX_OPEN_PRIVATE.max, locale),
      });
    }
    return tr(`${K}.errors.${e}` as MessageKey);
  }

  function submit() {
    setTried(true);
    if (invalid || !dirty || !reachable) return;
    save.mutate();
  }

  function discard() {
    setDraft(draftFromCoachingSettings(saved));
    setTried(false);
    setServerField(null);
  }

  const modeOptions = LESSON_PAYMENT_MODES.map((m: LessonPaymentMode) => ({
    value: m,
    label: tr(`ws.coaching.common.lessonPaymentMode.${m}`),
    // The saved mode stays choosable even if a rule changed under it.
    disabled:
      save.isPending || (isOnlineMode(m) && blocked.length > 0 && m !== saved.lesson_payment_mode),
  }));
  const fieldRefused =
    save.error != null &&
    save.error instanceof AppRpcError &&
    ((save.error.code === 'INVALID_ARGUMENT' && serverFieldOf(save.error.details) !== null) ||
      save.error.code === 'ONLINE_PAYMENT_OFF');
  const enabledError = errorFor('enabled');
  const publicError = errorFor('pricesPublic');

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        <Switch
          checked={draft.enabled}
          onChange={(v) => set('enabled', v)}
          label={tr(`${K}.enabled`)}
          disabled={save.isPending}
        />
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {tr(draft.enabled ? `${K}.onHint` : `${K}.offHint`)}
        </p>
        {enabledError && <FieldLine text={enabledError} />}
      </div>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        <Field
          label={tr(`${K}.paymentMode`)}
          hint={tr(`${K}.paymentModeHint`)}
          error={errorFor('paymentMode')}
          group
          style={{ marginBlockEnd: 0 }}
        >
          <SegmentedControl<LessonPaymentMode>
            value={draft.paymentMode}
            onChange={(v) => set('paymentMode', v)}
            options={modeOptions}
          />
        </Field>
        {blocked.length > 0 && (
          <ul
            data-testid="online-mode-block"
            style={{
              margin: 0,
              paddingInlineStart: 'var(--tp-sp-4)',
              display: 'grid',
              gap: 'var(--tp-sp-0)',
            }}
          >
            {blocked.map((r) => (
              <li key={r} style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                {tr(`ws.coaching.errors.onlineOff.${r}`)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gap: 'var(--tp-sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
        }}
      >
        <Field
          label={tr(`${K}.coachShare`)}
          hint={tr(`${K}.coachShareHint`)}
          error={errorFor('sharePercent')}
          style={{ marginBlockEnd: 0 }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
            <input
              style={{ ...inputStyle, inlineSize: '7rem', fontVariantNumeric: 'tabular-nums' }}
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
              value={draft.sharePercent}
              disabled={save.isPending}
              // Arabic digits and ٫ are read, not dropped (OP-16).
              onChange={(e) => set('sharePercent', percentInput(e.target.value))}
            />
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
              {tr('ws.kit.common.percent')}
            </span>
          </span>
        </Field>
        <NumberField
          label={tr(`${K}.maxOpenPrivate`)}
          hint={tr(`${K}.maxOpenPrivateHint`)}
          unit={tr(`${K}.lessonsUnit`)}
          value={draft.maxOpenPrivate}
          onChange={(v) => set('maxOpenPrivate', v)}
          error={errorFor('maxOpenPrivate')}
        />
      </div>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        <Switch
          checked={draft.pricesPublic}
          onChange={(v) => set('pricesPublic', v)}
          label={tr(`${K}.pricesPublic`)}
          disabled={save.isPending}
        />
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {tr(`${K}.pricesPublicHint`)}
        </p>
        {publicError && <FieldLine text={publicError} />}
      </div>

      {dirty && (
        <div
          role="region"
          aria-label={tr(`${K}.unsaved`)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-2)',
            flexWrap: 'wrap',
            paddingBlockStart: 'var(--tp-sp-3)',
            borderBlockStart: '1px solid var(--tp-border)',
          }}
        >
          <StatusBadge tone="warn" label={tr(`${K}.unsaved`)} />
          <span
            style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', flex: '1 1 14rem' }}
          >
            {tr(`${K}.appliesNow`)}
          </span>
          <Button kind="ghost" disabled={save.isPending} onClick={discard}>
            {tr(`${K}.discard`)}
          </Button>
          <Button
            kind="primary"
            icon="check"
            busy={save.isPending}
            disabled={!reachable}
            disabledReason={tr('ws.coaching.offline.needsConnection')}
            onClick={submit}
          >
            {tr(`${K}.save`)}
          </Button>
        </div>
      )}
      {save.error != null && !fieldRefused && (
        <ErrorText
          error={save.error}
          message={coachingErrorText(save.error, tr, {}, { scope: 'settings' })}
        />
      )}
    </div>
  );
}

function FieldLine({ text }: { text: string }) {
  return (
    <p
      role="alert"
      style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}
    >
      {text}
    </p>
  );
}
