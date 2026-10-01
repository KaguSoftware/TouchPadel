/**
 * Owner → Settings → Venue details: the open-match rules
 * (docs/design/open-matches/operator.md §5.16). Reads app.match_settings,
 * writes app.set_match_settings with only the keys that changed, for the
 * branch the rail shows (p_venue_id = currentBranchId()).
 *
 * Its own draft and its own Save, like the online deposit rules above it, so
 * saving one never sends the other. Two rules are this branch's (whether open
 * matches run here, the fill deadline) and two are every branch's (the ticket
 * price, filling matches per player); the latter sit under a lead that says
 * so. A manager reads the same rules with who can change them. A server
 * without open matches (RPC_MISSING) shows nothing. Saving is online only
 * (DF-11), and a server refusal lands on the field it names.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatNumber, type MessageKey } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { QK } from '../../../lib/queryKeys';
import { useStationReach } from '../../../lib/stationReach';
import { currentBranchId } from '../../../lib/venueScope';
import { useToast } from '../../../components/toast';
import { Switch } from '../../../components/Switch';
import { Button, ErrorText, Skeleton } from '../../../components/ui';
import { MessagePresenter, Panel, StatusBadge } from '../../../components/kit';
import { MatchReadNotice } from '../../matches/MatchReadNotice';
import { readMatchSettings, type MatchSettings } from '../../matches/matchPayloads';
import { invalidateMatchSettings, useMatchRead, useMatchSettings } from '../../matches/useMatches';
import { Facts, NumberField } from './settingsFields';
import {
  MATCH_SETTINGS_RANGES,
  draftFromMatchSettings,
  matchSettingsErrors,
  matchSettingsPatch,
  serverFieldOf,
  type MatchSettingsDraft,
  type MatchSettingsField,
  type MatchSettingsFieldError,
} from './matchSettingsLogic';

const K = 'ws.matches.settings';

export function MatchSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const { tr } = useLocale();
  const branch = currentBranchId();
  const q = useMatchSettings(branch);
  const status = useMatchRead(q);

  if (status.kind === 'absent') return null;

  return (
    <Panel title={tr(`${K}.title`)} data-testid="match-settings">
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)', maxInlineSize: '70ch' }}>{tr(`${K}.lead`)}</p>
      {status.kind === 'loading' && <Skeleton lines={4} />}
      <MatchReadNotice status={status} onRetry={() => void q.refetch()} />
      {status.kind === 'ready' && (canEdit ? <MatchSettingsForm saved={status.data} /> : <MatchSettingsFacts settings={status.data} />)}
    </Panel>
  );
}

/** A group heading with its scope ("This branch" / "All branches"). */
function ScopeHeading({ scope, lead }: { scope: string; lead?: string }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
      <StatusBadge tone="neutral" size="sm" dot={false} label={scope} style={{ justifySelf: 'start' }} />
      {lead && <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{lead}</p>}
    </div>
  );
}

/** A manager's view: the same rules, read-only, and who can change them. */
function MatchSettingsFacts({ settings: s }: { settings: MatchSettings }) {
  const { tr, locale } = useLocale();
  const n = (v: number | null) => (v == null ? null : formatNumber(v, locale));
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <MessagePresenter tone="info" icon="lock" message={tr(`${K}.ownerOnly`)} />
      <ScopeHeading scope={tr(`${K}.thisBranch`)} />
      <Facts
        rows={[
          { label: tr(`${K}.enabled`), value: tr(s.matches_enabled ? `${K}.on` : `${K}.off`), hint: tr(s.matches_enabled ? `${K}.onHint` : `${K}.offHint`) },
          {
            label: tr(`${K}.deadline`),
            value: s.match_fill_deadline_minutes == null ? null : tr('ws.owner.settings.trading.minutes', { count: n(s.match_fill_deadline_minutes) ?? '' }),
            empty: '—',
            hint: tr(`${K}.deadlineHint`),
          },
        ]}
      />
      <ScopeHeading scope={tr(`${K}.allBranches`)} lead={tr(`${K}.allLead`)} />
      <Facts
        rows={[
          { label: tr(`${K}.price`), value: s.match_ticket_price_iqd == null ? null : formatIQD(s.match_ticket_price_iqd, locale), empty: '—', hint: tr(`${K}.priceHint`) },
          { label: tr(`${K}.maxFilling`), value: n(s.max_filling_matches_per_guest), empty: '—', hint: tr(`${K}.maxFillingHint`) },
        ]}
      />
    </div>
  );
}

/** The owner's form: its own draft, its own Save, only the changed keys sent. */
function MatchSettingsForm({ saved }: { saved: MatchSettings }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { reachable } = useStationReach();
  const [draft, setDraft] = useState<MatchSettingsDraft>(() => draftFromMatchSettings(saved));
  const [tried, setTried] = useState(false);
  const [serverField, setServerField] = useState<MatchSettingsField | null>(null);

  // A save (this one's answer, or another owner's) resets the form to what is stored.
  useEffect(() => setDraft(draftFromMatchSettings(saved)), [saved]);

  const errors = matchSettingsErrors(draft);
  const invalid = Object.keys(errors).length > 0;
  const patch = invalid ? null : matchSettingsPatch(saved, draft);
  const dirty = invalid ? JSON.stringify(draft) !== JSON.stringify(draftFromMatchSettings(saved)) : Object.keys(patch ?? {}).length > 0;

  const save = useMutation({
    mutationFn: () => appRpc('set_match_settings', { p_patch: patch ?? {}, p_venue_id: currentBranchId() }),
    onSuccess: (next) => {
      toast.ok(tr(`${K}.saved`));
      setTried(false);
      setServerField(null);
      // The answer IS the new settings; the refresh is for the desk's envelope (desk_open_matches).
      if (next && typeof next === 'object') qc.setQueryData(QK.deskMatches.settings(currentBranchId()), readMatchSettings(next));
      invalidateMatchSettings(qc);
    },
    onError: (e) => {
      const field = e instanceof AppRpcError && e.code === 'INVALID_ARGUMENT' ? serverFieldOf(e.details) : null;
      if (field) setServerField(field);
    },
  });

  function set<F extends MatchSettingsField>(field: F, value: MatchSettingsDraft[F]) {
    setDraft((d) => ({ ...d, [field]: value }));
    if (serverField === field) setServerField(null);
  }

  /** A problem shows once Save was pressed, or when the server refused that field. */
  function errorFor(field: MatchSettingsField): string | undefined {
    const e: MatchSettingsFieldError | undefined = serverField === field ? 'refused' : tried ? errors[field] : undefined;
    if (!e) return undefined;
    if (e === 'range' && field in MATCH_SETTINGS_RANGES) {
      const r = MATCH_SETTINGS_RANGES[field as keyof typeof MATCH_SETTINGS_RANGES];
      return tr('ws.owner.settings.details.errors.range', { min: formatNumber(r.min, locale), max: formatNumber(r.max, locale) });
    }
    if (e === 'step') return tr(`${K}.errors.step`);
    if (e === 'refused') return tr(`${K}.errors.refused`);
    return tr(`ws.owner.settings.details.errors.${e}` as MessageKey);
  }

  function submit() {
    setTried(true);
    if (invalid || !dirty || !reachable) return;
    save.mutate();
  }

  function discard() {
    setDraft(draftFromMatchSettings(saved));
    setTried(false);
    setServerField(null);
  }

  const enabledError = errorFor('enabled');

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <ScopeHeading scope={tr(`${K}.thisBranch`)} />
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <Switch checked={draft.enabled} onChange={(v) => set('enabled', v)} label={tr(`${K}.enabled`)} disabled={save.isPending} />
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr(draft.enabled ? `${K}.onHint` : `${K}.offHint`)}</p>
          {enabledError && <p style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>{enabledError}</p>}
        </div>
        <NumberField
          label={tr(`${K}.deadline`)}
          hint={tr(`${K}.deadlineHint`)}
          unit={tr('ws.owner.settings.details.units.minutes')}
          value={draft.deadlineMinutes}
          onChange={(v) => set('deadlineMinutes', v)}
          error={errorFor('deadlineMinutes')}
        />
      </div>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <ScopeHeading scope={tr(`${K}.allBranches`)} lead={tr(`${K}.allLead`)} />
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
          <NumberField label={tr(`${K}.price`)} hint={tr(`${K}.priceHint`)} unit={tr(`${K}.iqd`)} value={draft.priceIqd} onChange={(v) => set('priceIqd', v)} error={errorFor('priceIqd')} />
          <NumberField
            label={tr(`${K}.maxFilling`)}
            hint={tr(`${K}.maxFillingHint`)}
            unit={tr(`${K}.matchesUnit`)}
            value={draft.maxFilling}
            onChange={(v) => set('maxFilling', v)}
            error={errorFor('maxFilling')}
          />
        </div>
      </div>

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
          <Button kind="primary" icon="check" busy={save.isPending} disabled={!reachable} disabledReason={tr('ws.matches.offline.needsConnection')} onClick={submit}>
            {tr(`${K}.save`)}
          </Button>
        </div>
      )}
      {save.error != null && serverFieldOf(save.error instanceof AppRpcError && save.error.code === 'INVALID_ARGUMENT' ? save.error.details : null) === null && (
        <ErrorText error={save.error} />
      )}
    </div>
  );
}
