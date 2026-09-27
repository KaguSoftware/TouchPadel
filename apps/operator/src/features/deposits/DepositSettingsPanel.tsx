/**
 * Owner → Settings → Venue details: the online deposit (Qi Card) rules,
 * build-contracts-2026-09-27 §6. Reads app.deposit_settings, writes
 * app.set_deposit_settings with only the keys that changed, for the branch the
 * rail shows (p_venue_id = currentBranchId(), like every branch-naming RPC).
 *
 * It sits under the booking rules because that is what it is to the owner,
 * but it is its own write, so it keeps its own draft and its own Save rather
 * than joining the venue form's sticky bar: saving one never sends the other.
 *
 * The owner decides three things in the order they would ask them: whether
 * guests are asked at all (the mode, with what each choice means to a guest),
 * how much, and what happens on a no-show. Nothing here computes a deposit;
 * the server rounds and clamps, and the guest sees the server's figure. A
 * manager reads the same rules and is told who can change them.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatNumber, type MessageKey } from '@touch/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { currentBranchId } from '../../lib/venueScope';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Skeleton } from '../../components/ui';
import { AsyncStateWrapper, MessagePresenter, Panel, StatusBadge, asyncStatus } from '../../components/kit';
import { Facts, NumberField } from '../admin/settings/settingsFields';
import { bpToPercent } from '../admin/settings/venueQueries';
import { DEPOSIT_MODES, depositSettingsKey, fetchDepositSettings, saveDepositSettings, type DepositSettings } from './depositApi';
import {
  DEPOSIT_RANGES,
  DEPOSIT_SERVER_FIELD,
  depositDraftErrors,
  depositPatch,
  draftFromDeposit,
  secondsToWholeMinutes,
  type DepositDraft,
  type DepositField,
  type DepositFieldError,
} from './depositSettingsLogic';

const K = 'ws.owner.settings.deposit';

export function DepositSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const { tr } = useLocale();
  const branch = currentBranchId();
  const settingsQ = useQuery({
    queryKey: depositSettingsKey(branch),
    queryFn: () => fetchDepositSettings(branch),
    staleTime: 60_000,
    retry: false,
  });

  return (
    <Panel title={tr(`${K}.title`)} data-testid="deposit-settings">
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)', maxInlineSize: '70ch' }}>{tr(`${K}.lead`)}</p>
      <AsyncStateWrapper status={asyncStatus(settingsQ, () => false)} error={settingsQ.error} onRetry={() => void settingsQ.refetch()} compact skeleton={<Skeleton lines={5} />}>
        {settingsQ.data && (canEdit ? <DepositForm saved={settingsQ.data} /> : <DepositFacts settings={settingsQ.data} />)}
      </AsyncStateWrapper>
    </Panel>
  );
}

/** A manager's view: the same rules, read-only, and who can change them. */
function DepositFacts({ settings: s }: { settings: DepositSettings }) {
  const { tr, locale } = useLocale();
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <MessagePresenter tone="info" icon="lock" message={tr(`${K}.ownerOnly`)} />
      <Facts
        rows={[
          { label: tr(`${K}.modeLabel`), value: tr(`${K}.mode.${s.deposit_mode}.label` as MessageKey), hint: tr(`${K}.mode.${s.deposit_mode}.body` as MessageKey) },
          { label: tr(`${K}.percent`), value: tr(`${K}.percentValue`, { percent: formatNumber(bpToPercent(s.deposit_percent_bp), locale) }), hint: tr(`${K}.percentHint`) },
          { label: tr(`${K}.min`), value: formatIQD(s.deposit_min_iqd, locale), hint: tr(`${K}.minHint`) },
          { label: tr(`${K}.max`), value: s.deposit_max_iqd == null ? null : formatIQD(s.deposit_max_iqd, locale), empty: tr(`${K}.noMax`), hint: tr(`${K}.maxHint`) },
          {
            label: tr(`${K}.window`),
            value: tr('ws.owner.settings.trading.minutes', { count: formatNumber(secondsToWholeMinutes(s.deposit_window_seconds), locale) }),
            hint: tr(`${K}.windowHint`),
          },
          { label: tr(`${K}.noShow`), value: tr(s.deposit_forfeit_no_show ? `${K}.noShowKeep` : `${K}.noShowRefund`), hint: tr(`${K}.noShowHint`) },
        ]}
      />
    </div>
  );
}

/** The owner's form: its own draft, its own Save, only the changed keys sent. */
function DepositForm({ saved }: { saved: DepositSettings }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState<DepositDraft>(() => draftFromDeposit(saved));
  const [tried, setTried] = useState(false);
  const [serverField, setServerField] = useState<DepositField | null>(null);

  // A save (this one's answer, or another owner's) resets the form to what is stored.
  useEffect(() => setDraft(draftFromDeposit(saved)), [saved]);

  const errors = depositDraftErrors(draft);
  const invalid = Object.keys(errors).length > 0;
  // Read only once the numbers are whole: the patch reads them as typed.
  const patch = invalid ? null : depositPatch(saved, draft);
  const dirty = invalid ? JSON.stringify(draft) !== JSON.stringify(draftFromDeposit(saved)) : Object.keys(patch ?? {}).length > 0;

  const save = useMutation({
    mutationFn: () => saveDepositSettings(patch ?? {}, currentBranchId()),
    onSuccess: (next) => {
      toast.ok(tr(`${K}.saved`));
      setTried(false);
      setServerField(null);
      // The answer IS the new settings; the refetch is for anything else that read them.
      if (next && typeof next === 'object') qc.setQueryData(depositSettingsKey(currentBranchId()), next);
      void qc.invalidateQueries({ queryKey: ['depositSettings'] });
    },
    onError: (e) => {
      const field = e instanceof AppRpcError && e.code === 'INVALID_ARGUMENT' && e.details ? DEPOSIT_SERVER_FIELD[e.details] : undefined;
      if (field) setServerField(field);
      else toast.err(e);
    },
  });

  function set<F extends DepositField>(field: F, value: DepositDraft[F]) {
    setDraft((d) => ({ ...d, [field]: value }));
    if (serverField === field) setServerField(null);
  }

  /** A problem shows once Save was pressed, or when the server refused that field. */
  function errorFor(field: DepositField): string | undefined {
    const e: DepositFieldError | undefined = serverField === field ? 'range' : tried ? errors[field] : undefined;
    if (!e) return undefined;
    if (e === 'range' && field in DEPOSIT_RANGES) {
      const r = DEPOSIT_RANGES[field as keyof typeof DEPOSIT_RANGES];
      return tr('ws.owner.settings.details.errors.range', { min: formatNumber(r.min, locale), max: formatNumber(r.max, locale) });
    }
    if (e === 'maxBelowMin') return tr(`${K}.errors.maxBelowMin`);
    if (e === 'range') return tr(`${K}.errors.refused`);
    return tr(`ws.owner.settings.details.errors.${e}` as MessageKey);
  }

  function submit() {
    setTried(true);
    if (invalid || !dirty) return;
    save.mutate();
  }

  function discard() {
    setDraft(draftFromDeposit(saved));
    setTried(false);
    setServerField(null);
  }

  const modeError = errorFor('mode');
  const noShowError = errorFor('forfeitNoShow');

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <MessagePresenter tone="info" icon="card" message={tr(`${K}.connectNote`)} />

      <fieldset style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-2)', padding: 0 }}>{tr(`${K}.modeLabel`)}</legend>
        <div role="radiogroup" aria-label={tr(`${K}.modeLabel`)} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          {DEPOSIT_MODES.map((m) => (
            <ChoiceRow key={m} name={`${id}-mode`} checked={draft.mode === m} onChange={() => set('mode', m)} disabled={save.isPending}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                <strong>{tr(`${K}.mode.${m}.label` as MessageKey)}</strong>
                {m === 'optional' && <StatusBadge tone="accent" size="sm" dot={false} label={tr(`${K}.recommended`)} />}
              </span>
              <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr(`${K}.mode.${m}.body` as MessageKey)}</span>
            </ChoiceRow>
          ))}
        </div>
        {modeError && <p style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockStart: 'var(--tp-sp-1)' }}>{modeError}</p>}
      </fieldset>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
        <NumberField label={tr(`${K}.percent`)} hint={tr(`${K}.percentHint`)} unit={tr(`${K}.percentUnit`)} value={draft.percent} onChange={(v) => set('percent', v)} error={errorFor('percent')} />
        <NumberField label={tr(`${K}.window`)} hint={tr(`${K}.windowHint`)} unit={tr('ws.owner.settings.details.units.minutes')} value={draft.windowMinutes} onChange={(v) => set('windowMinutes', v)} error={errorFor('windowMinutes')} />
        <NumberField label={tr(`${K}.min`)} hint={tr(`${K}.minHint`)} unit={tr(`${K}.iqd`)} value={draft.minIqd} onChange={(v) => set('minIqd', v)} error={errorFor('minIqd')} />
        <NumberField
          label={tr(`${K}.max`)}
          hint={tr(`${K}.maxHint`)}
          unit={tr(`${K}.iqd`)}
          value={draft.maxIqd}
          onChange={(v) => set('maxIqd', v)}
          error={errorFor('maxIqd')}
          optional
          placeholder={tr(`${K}.noMax`)}
        />
      </div>

      <fieldset style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-0)', padding: 0 }}>{tr(`${K}.noShow`)}</legend>
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr(`${K}.noShowHint`)}</p>
        <div role="radiogroup" aria-label={tr(`${K}.noShow`)} style={{ display: 'grid', gap: 'var(--tp-sp-1)', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
          {([true, false] as const).map((keep) => (
            <ChoiceRow key={String(keep)} name={`${id}-noshow`} checked={draft.forfeitNoShow === keep} onChange={() => set('forfeitNoShow', keep)} disabled={save.isPending}>
              <strong>{tr(keep ? `${K}.noShowKeep` : `${K}.noShowRefund`)}</strong>
            </ChoiceRow>
          ))}
        </div>
        {noShowError && <p style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockStart: 'var(--tp-sp-1)' }}>{noShowError}</p>}
      </fieldset>

      {dirty && (
        <div
          role="region"
          aria-label={tr('ws.owner.settings.details.unsaved')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-2)',
            flexWrap: 'wrap',
            paddingBlockStart: 'var(--tp-sp-3)',
            borderBlockStart: '1px solid var(--tp-border)',
          }}
        >
          <StatusBadge tone="warn" label={tr('ws.owner.settings.details.unsaved')} />
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', flex: '1 1 14rem' }}>{tr(`${K}.appliesNow`)}</span>
          <Button kind="ghost" disabled={save.isPending} onClick={discard}>
            {tr('ws.owner.settings.details.discard')}
          </Button>
          <Button kind="primary" icon="check" busy={save.isPending} onClick={submit}>
            {tr(`${K}.save`)}
          </Button>
        </div>
      )}
      {save.error != null && !(save.error instanceof AppRpcError && save.error.code === 'INVALID_ARGUMENT') && <ErrorText error={save.error} />}
    </div>
  );
}

/** One choice of a radio group, as the series and reason prompts draw theirs. */
function ChoiceRow({ name, checked, onChange, disabled, children }: { name: string; checked: boolean; onChange: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <label
      className="tp-row"
      data-clickable={disabled ? undefined : 'true'}
      data-selected={checked ? 'true' : undefined}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--tp-sp-2)',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-2)',
        borderRadius: 'var(--tp-radius-ctl)',
        border: '1px solid var(--tp-border)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} style={{ marginBlockStart: '0.2rem' }} />
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>{children}</span>
    </label>
  );
}

