/**
 * Venue details tab of VenueSettingsScreen (spec 06.49): the venue's name and
 * phone, the booking rules, and the values fixed when the venue was set up
 * (timezone, currency, tax).
 *
 * The name, phone and booking rules are EDITABLE by the owner since 0104
 * (app.set_venue_details). Timezone, currency and tax stay read-only by the
 * owner's call on 2026-09-17: changing them rewrites how every past business
 * day and amount is read, so they are grouped under "fixed at setup" instead of
 * the whole tab carrying that note.
 *
 * The booking rules are named for what a guest or the desk experiences, and
 * edited in the unit they are shown in — the hold in minutes, not the seconds
 * it is stored in. A manager sees the same values read-only, with one sentence
 * saying who can change them.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, type MessageKey } from '@touch/i18n';
import { appRpc, AppRpcError } from '../../../lib/appRpc';
import { can, useAuth } from '../../../lib/auth';
import { QK } from '../../../lib/queries';
import { useLocale, pickName } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button, ErrorText, Field, Skeleton, inputStyle } from '../../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, MessagePresenter, Panel, StatusBadge, TableSkeleton, asyncStatus, type Column } from '../../../components/kit';
import { TAX_GROUPS_KEY, VENUE_ADMIN_KEY, bpToPercent, fetchTaxGroups, fetchVenueAdmin, type TaxGroupRow, type VenueAdminRow } from './venueQueries';
import { DevicesPanel } from './DevicesPanel';
import {
  VENUE_RANGES,
  draftFromVenue,
  durationParts,
  venueDraftErrors,
  venuePatch,
  type SpanUnit,
  type VenueDraft,
  type VenueField,
  type VenueFieldError,
} from './venueDetailsLogic';

/** The server's field names, for placing a refusal on the field it concerns. */
const SERVER_FIELD: Record<string, VenueField> = {
  venue_name: 'venueName',
  phone: 'phone',
  cancellation_window_hours: 'cancellationHours',
  hold_ttl_seconds: 'holdMinutes',
  max_booking_horizon_days: 'horizonDays',
  max_live_holds_per_guest: 'maxHolds',
  protected_horizon_hours: 'protectedHours',
  heartbeat_stale_seconds: 'staleSeconds',
};

export function VenueDetailsTab() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const canEdit = can(staff?.role, 'editVenueDetails');
  const venueQ = useQuery({ queryKey: VENUE_ADMIN_KEY, queryFn: fetchVenueAdmin, staleTime: 60_000 });
  const taxQ = useQuery({ queryKey: TAX_GROUPS_KEY, queryFn: fetchTaxGroups, staleTime: 60_000 });
  const n = (v: number) => formatNumber(v, locale);

  /** A stored number of seconds, said in the largest whole unit. */
  const span = (seconds: number, largest?: SpanUnit) => {
    const p = durationParts(seconds, largest);
    return tr(`ws.owner.settings.trading.${p.unit}`, { count: n(p.count) });
  };

  const taxColumns: Column<TaxGroupRow>[] = [
    { key: 'name', header: tr('ws.owner.settings.trading.taxGroup'), render: (g) => <bdi>{pickName(locale, g)}</bdi> },
    { key: 'rate', header: tr('ws.owner.settings.trading.taxRate'), numeric: true, render: (g) => `${n(bpToPercent(g.rate_bp))}%` },
    {
      key: 'status',
      header: tr('ws.owner.settings.trading.taxStatus'),
      render: (g) =>
        g.is_active ? (
          <StatusBadge tone="success" size="sm" label={tr('ws.owner.settings.trading.taxInUse')} />
        ) : (
          <StatusBadge tone="neutral" size="sm" label={tr('ws.owner.settings.trading.taxInactive')} />
        ),
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', maxInlineSize: 'var(--tp-measure-wide)', marginBlockStart: 'var(--tp-sp-3)' }}>
      {!canEdit && <MessagePresenter tone="info" icon="lock" message={tr('ws.owner.settings.details.ownerOnly')} />}
      <AsyncStateWrapper status={asyncStatus(venueQ, () => false)} error={venueQ.error} onRetry={() => void venueQ.refetch()} skeleton={<Skeleton lines={6} />}>
        {venueQ.data &&
          (canEdit ? (
            <VenueForm saved={venueQ.data} />
          ) : (
            <>
              <Panel title={tr('ws.owner.settings.details.venueTitle')}>
                <Facts
                  rows={[
                    { label: tr('ws.owner.settings.contact.venueName'), value: <bdi>{venueQ.data.venue_name}</bdi>, hint: tr('ws.owner.settings.details.venueNameHint') },
                    {
                      label: tr('ws.owner.settings.contact.phone'),
                      value: venueQ.data.phone ? <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{venueQ.data.phone}</span> : null,
                      empty: tr('ws.owner.settings.contact.phoneNone'),
                      hint: tr('ws.owner.settings.details.phoneHint'),
                    },
                  ]}
                />
              </Panel>
              <Panel title={tr('ws.owner.settings.trading.policyTitle')}>
                <Facts
                  rows={[
                    {
                      label: tr('ws.owner.settings.trading.cancellationWindow'),
                      value: tr('ws.owner.settings.trading.beforeStart', { time: span(venueQ.data.cancellation_window_hours * 3600, 'hours') }),
                      hint: tr('ws.owner.settings.trading.cancellationWindowHint'),
                    },
                    { label: tr('ws.owner.settings.trading.holdTtl'), value: span(venueQ.data.hold_ttl_seconds), hint: tr('ws.owner.settings.trading.holdTtlHint') },
                    {
                      label: tr('ws.owner.settings.trading.bookingHorizon'),
                      value: venueQ.data.max_booking_horizon_days === 0 ? tr('ws.owner.settings.trading.noLimit') : span(venueQ.data.max_booking_horizon_days * 86400),
                      hint: tr('ws.owner.settings.trading.bookingHorizonHint'),
                    },
                    { label: tr('ws.owner.settings.trading.maxHolds'), value: n(venueQ.data.max_live_holds_per_guest), hint: tr('ws.owner.settings.trading.maxHoldsHint') },
                  ]}
                />
              </Panel>
              <Panel title={tr('ws.owner.settings.details.offlineTitle')}>
                <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.owner.settings.details.offlineLead')}</p>
                <Facts
                  rows={[
                    { label: tr('ws.owner.settings.trading.heartbeatStale'), value: span(venueQ.data.heartbeat_stale_seconds), hint: tr('ws.owner.settings.details.staleHint') },
                    { label: tr('ws.owner.settings.trading.protectedHorizon'), value: span(venueQ.data.protected_horizon_hours * 3600, 'hours'), hint: tr('ws.owner.settings.details.protectedHint') },
                  ]}
                />
              </Panel>
            </>
          ))}
        {venueQ.data && <DevicesPanel staleSeconds={venueQ.data.heartbeat_stale_seconds} />}
        {venueQ.data && (
          <Panel title={tr('ws.owner.settings.details.fixedTitle')}>
            <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.owner.settings.details.fixedNote')}</p>
            <Facts
              rows={[
                { label: tr('ws.owner.settings.contact.timezone'), value: <span dir="ltr">{venueQ.data.timezone}</span>, hint: tr('ws.owner.settings.details.timezoneHint') },
                { label: tr('ws.owner.settings.trading.currency'), value: <span dir="ltr">{venueQ.data.currency}</span>, hint: tr('ws.owner.settings.trading.currencyHint') },
                { label: tr('ws.owner.settings.trading.taxInclusive'), value: venueQ.data.tax_inclusive ? tr('ws.owner.settings.details.yes') : tr('ws.owner.settings.details.no') },
                { label: tr('ws.owner.settings.trading.noShow'), value: tr('ws.owner.settings.trading.noShowValue'), hint: tr('ws.owner.settings.trading.noShowBody') },
              ]}
            />
          </Panel>
        )}
      </AsyncStateWrapper>

      <Panel title={tr('ws.owner.settings.trading.taxTitle')}>
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.owner.settings.trading.taxLead')}</p>
        <AsyncStateWrapper
          status={asyncStatus(taxQ, (rows) => rows.length === 0)}
          error={taxQ.error}
          onRetry={() => void taxQ.refetch()}
          compact
          skeleton={<TableSkeleton columns={taxColumns} rows={3} />}
          emptyContent={<EmptyState compact icon="tag" title={tr('ws.owner.settings.trading.taxNone')} />}
        >
          <DataTable columns={taxColumns} rows={taxQ.data ?? []} rowKey={(g) => g.id} dense aria-label={tr('ws.owner.settings.trading.taxTitle')} />
        </AsyncStateWrapper>
      </Panel>
    </div>
  );
}

/** The owner's editor: the venue, the booking rules, and a save bar once something changed. */
function VenueForm({ saved }: { saved: VenueAdminRow }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<VenueDraft>(() => draftFromVenue(saved));
  const [tried, setTried] = useState(false);
  const [serverField, setServerField] = useState<VenueField | null>(null);

  // A save elsewhere (or this one's refetch) resets the form to what is stored.
  useEffect(() => setDraft(draftFromVenue(saved)), [saved]);

  const patch = venuePatch(saved, draft);
  const dirty = Object.keys(patch).length > 0;
  const errors = venueDraftErrors(draft);
  const invalid = Object.keys(errors).length > 0;

  const save = useMutation({
    mutationFn: () => appRpc('set_venue_details', { p_patch: patch }),
    onSuccess: () => {
      toast.ok(tr('ws.owner.settings.details.saved'));
      setTried(false);
      setServerField(null);
      void qc.invalidateQueries({ queryKey: VENUE_ADMIN_KEY });
      // The guest site and the desk read the same row.
      void qc.invalidateQueries({ queryKey: QK.venueSettings });
    },
    onError: (e) => {
      if (e instanceof AppRpcError && e.code === 'INVALID_ARGUMENT' && e.details && SERVER_FIELD[e.details]) setServerField(SERVER_FIELD[e.details]!);
      else toast.err(e);
    },
  });

  const set = (field: VenueField) => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (serverField === field) setServerField(null);
  };
  /** A problem shows once Save was pressed, or when the server refused that field. */
  const errorFor = (field: VenueField): string | undefined => {
    const e: VenueFieldError | undefined = serverField === field ? 'range' : tried ? errors[field] : undefined;
    if (!e) return undefined;
    if (e === 'range' && field in VENUE_RANGES) {
      const r = VENUE_RANGES[field as keyof typeof VENUE_RANGES];
      return tr('ws.owner.settings.details.errors.range', { min: formatNumber(r.min, locale), max: formatNumber(r.max, locale) });
    }
    return tr(`ws.owner.settings.details.errors.${e}` as MessageKey);
  };

  function submit() {
    setTried(true);
    if (invalid || !dirty) return;
    save.mutate();
  }

  return (
    <>
      <Panel title={tr('ws.owner.settings.details.venueTitle')}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
          <Field label={tr('ws.owner.settings.contact.venueName')} hint={tr('ws.owner.settings.details.venueNameHint')} error={errorFor('venueName')} required style={{ marginBlockEnd: 0 }}>
            <input style={inputStyle} value={draft.venueName} maxLength={80} onChange={(e) => set('venueName')(e.target.value)} />
          </Field>
          <Field label={tr('ws.owner.settings.contact.phone')} hint={tr('ws.owner.settings.details.phoneHint')} error={errorFor('phone')} optional style={{ marginBlockEnd: 0 }}>
            <input style={inputStyle} dir="ltr" inputMode="tel" value={draft.phone} maxLength={20} onChange={(e) => set('phone')(e.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel title={tr('ws.owner.settings.trading.policyTitle')}>
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.owner.settings.details.rulesLead')}</p>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
          <NumberField
            label={tr('ws.owner.settings.trading.cancellationWindow')}
            hint={tr('ws.owner.settings.details.cancellationHint')}
            unit={tr('ws.owner.settings.details.units.hours')}
            value={draft.cancellationHours}
            onChange={set('cancellationHours')}
            error={errorFor('cancellationHours')}
          />
          <NumberField
            label={tr('ws.owner.settings.trading.holdTtl')}
            hint={tr('ws.owner.settings.trading.holdTtlHint')}
            unit={tr('ws.owner.settings.details.units.minutes')}
            value={draft.holdMinutes}
            onChange={set('holdMinutes')}
            error={errorFor('holdMinutes')}
          />
          <NumberField
            label={tr('ws.owner.settings.trading.bookingHorizon')}
            hint={tr('ws.owner.settings.details.horizonHint')}
            unit={tr('ws.owner.settings.details.units.days')}
            value={draft.horizonDays}
            onChange={set('horizonDays')}
            error={errorFor('horizonDays')}
          />
          <NumberField
            label={tr('ws.owner.settings.trading.maxHolds')}
            hint={tr('ws.owner.settings.trading.maxHoldsHint')}
            unit={tr('ws.owner.settings.details.units.slots')}
            value={draft.maxHolds}
            onChange={set('maxHolds')}
            error={errorFor('maxHolds')}
          />
        </div>
      </Panel>

      <Panel title={tr('ws.owner.settings.details.offlineTitle')}>
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.owner.settings.details.offlineLead')}</p>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
          <NumberField
            label={tr('ws.owner.settings.trading.heartbeatStale')}
            hint={tr('ws.owner.settings.details.staleHint')}
            unit={tr('ws.owner.settings.details.units.seconds')}
            value={draft.staleSeconds}
            onChange={set('staleSeconds')}
            error={errorFor('staleSeconds')}
          />
          <NumberField
            label={tr('ws.owner.settings.trading.protectedHorizon')}
            hint={tr('ws.owner.settings.details.protectedHint')}
            unit={tr('ws.owner.settings.details.units.hours')}
            value={draft.protectedHours}
            onChange={set('protectedHours')}
            error={errorFor('protectedHours')}
          />
        </div>
      </Panel>

      {dirty && (
        <div
          role="region"
          aria-label={tr('ws.owner.settings.details.unsaved')}
          style={{
            position: 'sticky',
            insetBlockEnd: 'var(--tp-sp-3)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-2)',
            flexWrap: 'wrap',
            padding: 'var(--tp-sp-3)',
            borderRadius: 'var(--tp-radius-panel)',
            border: '1px solid var(--tp-border)',
            background: 'var(--tp-surface)',
            boxShadow: 'var(--tp-shadow-2, 0 4px 16px rgb(0 0 0 / 0.08))',
          }}
        >
          <StatusBadge tone="warn" label={tr('ws.owner.settings.details.unsaved')} />
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', flex: '1 1 14rem' }}>{tr('ws.owner.settings.details.appliesNow')}</span>
          <Button kind="ghost" disabled={save.isPending} onClick={() => { setDraft(draftFromVenue(saved)); setTried(false); setServerField(null); }}>
            {tr('ws.owner.settings.details.discard')}
          </Button>
          <Button kind="primary" icon="check" busy={save.isPending} onClick={submit}>
            {tr('ws.owner.settings.details.save')}
          </Button>
        </div>
      )}
      {save.error != null && !(save.error instanceof AppRpcError && save.error.code === 'INVALID_ARGUMENT') && <ErrorText error={save.error} />}
    </>
  );
}

function NumberField({ label, hint, unit, value, onChange, error }: { label: string; hint: string; unit: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field label={label} hint={hint} error={error} style={{ marginBlockEnd: 0 }}>
      <UnitInput unit={unit} value={value} onChange={onChange} />
    </Field>
  );
}

/** A whole-number input with its unit written after it, so "12" is never read as minutes. */
function UnitInput({ unit, value, onChange, ...rest }: { unit: string; value: string; onChange: (v: string) => void; [aria: string]: unknown }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
      <input
        {...(rest as Record<string, unknown>)}
        style={{ ...inputStyle, inlineSize: '7rem', fontVariantNumeric: 'tabular-nums' }}
        dir="ltr"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
      />
      <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{unit}</span>
    </span>
  );
}

/**
 * Label, value and one line of what it means — the value at the end of the
 * row, where the eye lands after reading the label, as on the /ops cards.
 */
function Facts({ rows }: { rows: { label: string; value: ReactNode | null; empty?: string; hint?: string }[] }) {
  return (
    <dl style={{ margin: 0, display: 'grid' }}>
      {rows.map((r, i) => (
        <div
          key={r.label}
          style={{
            display: 'flex',
            gap: 'var(--tp-sp-4)',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            paddingBlock: 'var(--tp-sp-2)',
            borderBlockStart: i > 0 ? '1px solid var(--tp-border)' : undefined,
          }}
        >
          <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 18rem', minInlineSize: 0 }}>
            <dt style={{ fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}>{r.label}</dt>
            {r.hint && <dd style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{r.hint}</dd>}
          </div>
          <dd style={{ margin: 0, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'end', color: r.value === null ? 'var(--tp-muted-fg)' : undefined }}>
            {r.value === null ? r.empty : r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
