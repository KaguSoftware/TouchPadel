/**
 * The venue's own settings, in the three parts Setup now shows on three pages
 * (management rebuild, 2026-10-17): the venue (name, phone), the booking
 * rules, and offline mode. They were one form on one tab of "Venue settings"
 * with fourteen panels; each part is now a page in the family it belongs to
 * (Venue › Details, Courts › Booking rules, Devices › Offline mode).
 *
 * The three still write through one RPC, app.set_venue_details (0104, 0118,
 * 0248), each sending only the keys its own fields changed. Timezone,
 * currency and tax stay read-only by the owner's call on 2026-09-17: changing
 * them rewrites how every past business day and amount is read.
 *
 * The booking rules are named for what a guest or the desk experiences, and
 * edited in the unit they are shown in — the hold in minutes, not the seconds
 * it is stored in. A manager sees the same values read-only, with one
 * sentence saying who can change them.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatNumber, type MessageKey } from '@touch/i18n';
import { appRpc, AppRpcError } from '../../../lib/appRpc';
import { QK } from '../../../lib/queries';
import { useLocale, pickName } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Switch } from '../../../components/Switch';
import { Button, ErrorText, Field, inputStyle } from '../../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, Panel, StatusBadge, TableSkeleton, asyncStatus, type Column } from '../../../components/kit';
import { useQuery } from '@tanstack/react-query';
import { TAX_GROUPS_KEY, VENUE_ADMIN_KEY, bpToPercent, fetchTaxGroups, type TaxGroupRow, type VenueAdminRow } from './venueQueries';
import { Facts, NumberField } from './settingsFields';
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

export type VenuePart = 'venue' | 'booking' | 'offline';

/** The fields each page edits. */
const PART_FIELDS: Record<VenuePart, readonly VenueField[]> = {
  venue: ['venueName', 'phone'],
  booking: ['cancellationHours', 'holdMinutes', 'horizonDays', 'maxHolds'],
  offline: ['staleSeconds', 'protectedHours'],
};

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

/** A stored number of seconds, said in the largest whole unit. */
function useSpan() {
  const { tr, locale } = useLocale();
  return (seconds: number, largest?: SpanUnit) => {
    const p = durationParts(seconds, largest);
    return tr(`ws.owner.settings.trading.${p.unit}`, { count: formatNumber(p.count, locale) });
  };
}

/**
 * The owner's editor for one part, with a save bar once something changed.
 * The draft holds every field, seeded from what is stored; only this part's
 * fields can change, so the patch only ever carries them.
 */
export function VenuePartForm({ saved, part, untitled }: { saved: VenueAdminRow; part: VenuePart; untitled?: boolean }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const fields = PART_FIELDS[part];
  const [draft, setDraft] = useState<VenueDraft>(() => draftFromVenue(saved));
  const [tried, setTried] = useState(false);
  const [serverField, setServerField] = useState<VenueField | null>(null);

  // A save elsewhere (or this one's refetch) resets the form to what is stored.
  useEffect(() => setDraft(draftFromVenue(saved)), [saved]);

  const patch = venuePatch(saved, draft);
  const dirty = Object.keys(patch).length > 0;
  const allErrors = venueDraftErrors(draft);
  const errors = Object.fromEntries(Object.entries(allErrors).filter(([k]) => fields.includes(k as VenueField))) as typeof allErrors;
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
    const e: VenueFieldError | undefined = serverField === field ? (field in VENUE_RANGES ? 'range' : field === 'phone' ? 'phoneFormat' : 'nameLength') : tried ? errors[field] : undefined;
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

  const grid = { display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' } as const;

  return (
    <>
      {part === 'venue' && (
        <Panel title={untitled ? undefined : tr('ws.owner.settings.details.venueTitle')}>
          <div style={grid}>
            <Field label={tr('ws.owner.settings.contact.venueName')} hint={tr('ws.owner.settings.details.venueNameHint')} error={errorFor('venueName')} required style={{ marginBlockEnd: 0 }}>
              <input style={inputStyle} value={draft.venueName} maxLength={80} onChange={(e) => set('venueName')(e.target.value)} />
            </Field>
            <Field label={tr('ws.owner.settings.contact.phone')} hint={tr('ws.owner.settings.details.phoneHint')} error={errorFor('phone')} optional style={{ marginBlockEnd: 0 }}>
              <input style={inputStyle} dir="ltr" inputMode="tel" value={draft.phone} maxLength={20} onChange={(e) => set('phone')(e.target.value)} />
            </Field>
          </div>
        </Panel>
      )}

      {part === 'booking' && (
        <Panel title={untitled ? undefined : tr('ws.owner.settings.trading.policyTitle')}>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.owner.settings.details.rulesLead')}</p>
          <div style={grid}>
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
      )}

      {part === 'offline' && (
        <Panel title={untitled ? undefined : tr('ws.owner.settings.details.offlineTitle')}>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.owner.settings.details.offlineLead')}</p>
          <OfflineModeSwitch enabled={saved.offline_mode_enabled} />
          <div style={grid}>
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
      )}

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
          <Button
            kind="ghost"
            disabled={save.isPending}
            onClick={() => {
              setDraft(draftFromVenue(saved));
              setTried(false);
              setServerField(null);
            }}
          >
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

/**
 * 0248: offline mode on or off for this branch. Its own write, saved on the
 * flip rather than with the form: the owner turning it off wants the banner
 * gone now, not after finding the Save bar.
 */
function OfflineModeSwitch({ enabled }: { enabled: boolean }) {
  const { tr } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();

  async function change(next: boolean) {
    await appRpc('set_venue_details', { p_patch: { offline_mode_enabled: next } });
    toast.ok(tr(next ? 'ws.owner.settings.details.offlineTurnedOn' : 'ws.owner.settings.details.offlineTurnedOff'));
    void qc.invalidateQueries({ queryKey: VENUE_ADMIN_KEY });
    // The banner reads the degraded flag every screen polls.
    void qc.invalidateQueries({ queryKey: QK.venueSettings });
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', marginBlockEnd: 'var(--tp-sp-3)' }}>
      <Switch checked={enabled} onChange={change} label={tr('ws.owner.settings.details.offlineSwitch')} />
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>
        {tr(enabled ? 'ws.owner.settings.details.offlineOnHint' : 'ws.owner.settings.details.offlineOffHint')}
      </p>
    </div>
  );
}

/** What a manager reads in place of a part's form: the same values, read-only. */
export function VenuePartFacts({ venue, part, untitled }: { venue: VenueAdminRow; part: VenuePart; untitled?: boolean }) {
  const { tr, locale } = useLocale();
  const span = useSpan();
  const n = (v: number) => formatNumber(v, locale);
  if (part === 'venue') {
    return (
      <Panel title={tr('ws.owner.settings.details.venueTitle')}>
        <Facts
          rows={[
            { label: tr('ws.owner.settings.contact.venueName'), value: <bdi>{venue.venue_name}</bdi>, hint: tr('ws.owner.settings.details.venueNameHint') },
            {
              label: tr('ws.owner.settings.contact.phone'),
              value: venue.phone ? <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{venue.phone}</span> : null,
              empty: tr('ws.owner.settings.contact.phoneNone'),
              hint: tr('ws.owner.settings.details.phoneHint'),
            },
          ]}
        />
      </Panel>
    );
  }
  if (part === 'booking') {
    return (
      <Panel title={untitled ? undefined : tr('ws.owner.settings.trading.policyTitle')}>
        <Facts
          rows={[
            {
              label: tr('ws.owner.settings.trading.cancellationWindow'),
              value: tr('ws.owner.settings.trading.beforeStart', { time: span(venue.cancellation_window_hours * 3600, 'hours') }),
              hint: tr('ws.owner.settings.trading.cancellationWindowHint'),
            },
            { label: tr('ws.owner.settings.trading.holdTtl'), value: span(venue.hold_ttl_seconds), hint: tr('ws.owner.settings.trading.holdTtlHint') },
            {
              label: tr('ws.owner.settings.trading.bookingHorizon'),
              value: venue.max_booking_horizon_days === 0 ? tr('ws.owner.settings.trading.noLimit') : span(venue.max_booking_horizon_days * 86400),
              hint: tr('ws.owner.settings.trading.bookingHorizonHint'),
            },
            { label: tr('ws.owner.settings.trading.maxHolds'), value: n(venue.max_live_holds_per_guest), hint: tr('ws.owner.settings.trading.maxHoldsHint') },
          ]}
        />
      </Panel>
    );
  }
  return (
    <Panel title={untitled ? undefined : tr('ws.owner.settings.details.offlineTitle')}>
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.owner.settings.details.offlineLead')}</p>
      <Facts
        rows={[
          {
            label: tr('ws.owner.settings.details.offlineSwitch'),
            value: tr(venue.offline_mode_enabled ? 'ws.owner.settings.details.offlineOn' : 'ws.owner.settings.details.offlineOff'),
            hint: tr(venue.offline_mode_enabled ? 'ws.owner.settings.details.offlineOnHint' : 'ws.owner.settings.details.offlineOffHint'),
          },
          { label: tr('ws.owner.settings.trading.heartbeatStale'), value: span(venue.heartbeat_stale_seconds), hint: tr('ws.owner.settings.details.staleHint') },
          { label: tr('ws.owner.settings.trading.protectedHorizon'), value: span(venue.protected_horizon_hours * 3600, 'hours'), hint: tr('ws.owner.settings.details.protectedHint') },
        ]}
      />
    </Panel>
  );
}

/** The values fixed when the venue was set up: read-only for everyone. */
export function FixedAtSetupPanel({ venue }: { venue: VenueAdminRow }) {
  const { tr } = useLocale();
  return (
    <Panel title={tr('ws.owner.settings.details.fixedTitle')}>
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.owner.settings.details.fixedNote')}</p>
      <Facts
        rows={[
          { label: tr('ws.owner.settings.contact.timezone'), value: <span dir="ltr">{venue.timezone}</span>, hint: tr('ws.owner.settings.details.timezoneHint') },
          { label: tr('ws.owner.settings.trading.currency'), value: <span dir="ltr">{venue.currency}</span>, hint: tr('ws.owner.settings.trading.currencyHint') },
          { label: tr('ws.owner.settings.trading.taxInclusive'), value: venue.tax_inclusive ? tr('ws.owner.settings.details.yes') : tr('ws.owner.settings.details.no') },
          { label: tr('ws.owner.settings.trading.noShow'), value: tr('ws.owner.settings.trading.noShowValue'), hint: tr('ws.owner.settings.trading.noShowBody') },
        ]}
      />
    </Panel>
  );
}

/** The tax rate each group of menu items carries: read-only. */
export function TaxGroupsPanel() {
  const { tr, locale } = useLocale();
  const taxQ = useQuery({ queryKey: TAX_GROUPS_KEY, queryFn: fetchTaxGroups, staleTime: 60_000 });
  const columns: Column<TaxGroupRow>[] = [
    { key: 'name', header: tr('ws.owner.settings.trading.taxGroup'), render: (g) => <bdi>{pickName(locale, g)}</bdi> },
    { key: 'rate', header: tr('ws.owner.settings.trading.taxRate'), numeric: true, render: (g) => `${formatNumber(bpToPercent(g.rate_bp), locale)}%` },
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
    <Panel title={tr('ws.owner.settings.trading.taxTitle')}>
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.owner.settings.trading.taxLead')}</p>
      <AsyncStateWrapper
        status={asyncStatus(taxQ, (rows) => rows.length === 0)}
        error={taxQ.error}
        onRetry={() => void taxQ.refetch()}
        compact
        skeleton={<TableSkeleton columns={columns} rows={3} />}
        emptyContent={<EmptyState compact icon="tag" title={tr('ws.owner.settings.trading.taxNone')} />}
      >
        <DataTable columns={columns} rows={taxQ.data ?? []} rowKey={(g) => g.id} dense aria-label={tr('ws.owner.settings.trading.taxTitle')} />
      </AsyncStateWrapper>
    </Panel>
  );
}
