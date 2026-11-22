/**
 * Staff clock-in setup (0442), on Settings › Stations: where the club is (owner; a manager reads
 * it) and each desk's QR key. "Set up this desk's QR" asks the server for a new secret for THIS
 * station (app.issue_station_clock_key, through useSetUpDesk, which registers a computer that is
 * not yet a station first) and keeps it on the machine (stationKey.ts); from then on
 * the QR draws itself on the sign-in screen and under Staff QR. Setting a desk up again replaces
 * its key: the QR it showed stops working at once, so the press asks first.
 *
 * Nothing here ever reads a secret back: app.clock_setup says only whether a desk has a key, when
 * it was issued and by whom. When the stamp the machine kept differs from the server's, the key
 * here is no longer the live one and the page says so.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber, isolate } from '@touch/i18n';
import { isRpcMissing } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useVenue } from '../../lib/venue';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Skeleton, inputStyle } from '../../components/ui';
import { CountInput } from '../../components/inputs';
import { MessagePresenter, StatusBadge } from '../../components/kit';
import { SettingsGroup, SettingsRow, settingField } from '../admin/settings/SettingsList';
import { refusalCode, refusalHint } from '../protocols/errors';
import { CK, fetchClockSetup, saveClockPlace, type ClockPlace, type ClockSetup } from './api';
import { useStationKey } from './ClockQr';
import { isKeyNotKept, useSetUpDesk } from './useSetUpDesk';
import {
  ACCURACY_DEFAULT,
  ACCURACY_MAX,
  ACCURACY_MIN,
  RADIUS_DEFAULT,
  RADIUS_MAX,
  RADIUS_MIN,
  formatLatLng,
  inRange,
  mapsLink,
  parsePlace,
} from './placeParse';
import { deskKeyStatus } from './stationKey';
import { StaffQrView } from './StaffQr';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

export function ClockSetupPanel() {
  const { tr } = useLocale();
  const { branchId } = useVenue();
  const q = useQuery({ queryKey: CK.setup(branchId), enabled: Boolean(branchId), queryFn: fetchClockSetup });

  // A station on a build ahead of its server: say so, never an empty page under a setup link.
  if (q.error && isRpcMissing(q.error)) {
    return (
      <SettingsGroup title={tr('ws.clock.setup.title')}>
        <SettingsRow>
          <MessagePresenter tone="info" message={tr('ws.clock.qr.unavailable')} />
        </SettingsRow>
      </SettingsGroup>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }} data-testid="clock-setup">
      {q.error ? (
        <SettingsGroup title={tr('ws.clock.setup.title')}>
          <SettingsRow>
            <ErrorText error={q.error} />
            <div>
              <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
                {tr('common.retry')}
              </Button>
            </div>
          </SettingsRow>
        </SettingsGroup>
      ) : !q.data ? (
        <SettingsGroup title={tr('ws.clock.setup.title')}>
          <SettingsRow>
            <Skeleton lines={4} />
          </SettingsRow>
        </SettingsGroup>
      ) : (
        <>
          <ReadyLine setup={q.data} />
          <PlaceGroup setup={q.data} />
          <DesksGroup setup={q.data} />
        </>
      )}
    </div>
  );
}

function ReadyLine({ setup }: { setup: ClockSetup }) {
  const { tr } = useLocale();
  const hasDesk = setup.stations.some((s) => s.hasKey);
  if (setup.place && hasDesk) return <MessagePresenter tone="success" message={tr('ws.clock.setup.ready')} />;
  const missing = !setup.place && !hasDesk ? 'both' : !setup.place ? 'place' : 'desk';
  return <MessagePresenter tone="info" message={tr(`ws.clock.setup.notReady.${missing}`)} />;
}

// ---------------------------------------------------------------------------
// Where the club is
// ---------------------------------------------------------------------------

function PlaceFacts({ place }: { place: ClockPlace }) {
  const { tr, locale } = useLocale();
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }} data-testid="clock-place-facts">
      <p style={{ margin: 0, fontWeight: 600 }}>
        <span dir="ltr">{formatLatLng(place)}</span>{' '}
        <a href={mapsLink(place)} target="_blank" rel="noreferrer" style={{ fontWeight: 400, fontSize: 'var(--tp-fs-sm)' }}>
          {tr('ws.clock.setup.place.checkMap')}
        </a>
      </p>
      <p style={muted}>
        {tr('ws.clock.setup.place.summary', { radius: formatNumber(place.radiusM, locale), accuracy: formatNumber(place.maxAccuracyM, locale) })}
      </p>
      {place.updatedAt && (
        <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>
          {place.updatedByName
            ? tr('ws.clock.setup.place.setBy', { name: isolate(place.updatedByName), when: formatDateTime(new Date(place.updatedAt), locale) })
            : tr('ws.clock.setup.place.setAt', { when: formatDateTime(new Date(place.updatedAt), locale) })}
        </p>
      )}
    </div>
  );
}

function PlaceGroup({ setup }: { setup: ClockSetup }) {
  const { tr } = useLocale();
  const place = setup.place;
  return (
    <SettingsGroup title={tr('ws.clock.setup.place.title')} description={tr('ws.clock.setup.place.lead')}>
      {place ? (
        <SettingsRow>
          <PlaceFacts place={place} />
        </SettingsRow>
      ) : (
        <SettingsRow>
          <p style={muted}>{tr('ws.clock.setup.place.none')}</p>
        </SettingsRow>
      )}
      {setup.canEditPlace ? (
        <PlaceForm place={place} />
      ) : (
        <SettingsRow>
          <MessagePresenter tone="info" icon="lock" message={tr('ws.clock.setup.place.ownerOnly')} />
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}

function PlaceForm({ place }: { place: ClockPlace | null }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [radius, setRadius] = useState(place?.radiusM ?? RADIUS_DEFAULT);
  const [accuracy, setAccuracy] = useState(place?.maxAccuracyM ?? ACCURACY_DEFAULT);
  const [tried, setTried] = useState(false);

  const parsed = parsePlace(text);
  const point = parsed.ok ? parsed.point : text.trim() === '' && place ? { lat: place.lat, lng: place.lng } : null;
  const dirty = parsed.ok || radius !== (place?.radiusM ?? RADIUS_DEFAULT) || accuracy !== (place?.maxAccuracyM ?? ACCURACY_DEFAULT) || !place;
  const radiusOk = inRange(radius, RADIUS_MIN, RADIUS_MAX);
  const accuracyOk = inRange(accuracy, ACCURACY_MIN, ACCURACY_MAX);

  const save = useMutation({
    mutationFn: () => saveClockPlace({ lat: point!.lat, lng: point!.lng, radiusM: radius, maxAccuracyM: accuracy }),
    onSuccess: () => {
      toast.ok(tr('ws.clock.setup.place.saved'));
      setText('');
      setTried(false);
      void qc.invalidateQueries({ queryKey: CK.all });
    },
  });
  const serverHint = refusalCode(save.error) === 'INVALID_ARGUMENT' ? refusalHint(save.error) : null;

  const placeError = (() => {
    if (serverHint === 'location') return tr('ws.clock.setup.place.issue.out_of_range');
    if (text.trim() === '') return tried && !point ? tr('ws.clock.setup.place.issue.empty') : undefined;
    return parsed.ok ? undefined : tr(`ws.clock.setup.place.issue.${parsed.reason}`);
  })();
  const n = (v: number) => formatNumber(v, locale);

  return (
    <SettingsRow>
      <form
        noValidate
        style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (point && radiusOk && accuracyOk && !save.isPending) save.mutate();
        }}
        data-testid="clock-place-form"
      >
        <Field
          label={tr(place ? 'ws.clock.setup.place.moveLabel' : 'ws.clock.setup.place.label')}
          hint={parsed.ok ? <span dir="auto">{tr('ws.clock.setup.place.readsAs', { point: isolate(formatLatLng(parsed.point)) })}</span> : tr('ws.clock.setup.place.hint')}
          error={placeError}
          style={settingField}
        >
          <input
            style={inputStyle}
            dir="ltr"
            value={text}
            placeholder={tr('ws.clock.setup.place.placeholder')}
            disabled={save.isPending}
            onChange={(e) => {
              setText(e.target.value);
              if (save.isError) save.reset();
            }}
            data-testid="clock-place-input"
          />
        </Field>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Field
            label={tr('ws.clock.setup.place.radius')}
            hint={tr('ws.clock.setup.place.radiusHint', { def: n(RADIUS_DEFAULT), min: n(RADIUS_MIN), max: n(RADIUS_MAX) })}
            error={serverHint === 'radius_m' || (tried && !radiusOk) ? tr('ws.clock.setup.place.range', { min: n(RADIUS_MIN), max: n(RADIUS_MAX) }) : undefined}
            style={{ ...settingField, flex: '1 1 16rem' }}
          >
            <CountInput id="clock-radius" value={radius} min={RADIUS_MIN} max={RADIUS_MAX} disabled={save.isPending} onChange={setRadius} />
          </Field>
          <Field
            label={tr('ws.clock.setup.place.accuracy')}
            hint={tr('ws.clock.setup.place.accuracyHint', { def: n(ACCURACY_DEFAULT), min: n(ACCURACY_MIN), max: n(ACCURACY_MAX) })}
            error={serverHint === 'max_accuracy_m' || (tried && !accuracyOk) ? tr('ws.clock.setup.place.range', { min: n(ACCURACY_MIN), max: n(ACCURACY_MAX) }) : undefined}
            style={{ ...settingField, flex: '1 1 16rem' }}
          >
            <CountInput id="clock-accuracy" value={accuracy} min={ACCURACY_MIN} max={ACCURACY_MAX} disabled={save.isPending} onChange={setAccuracy} />
          </Field>
        </div>
        {save.isError && serverHint === null && <ErrorText error={save.error} />}
        {dirty && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button kind="primary" type="submit" icon="check" busy={save.isPending} data-testid="clock-place-save">
              {tr('ws.clock.setup.place.save')}
            </Button>
          </div>
        )}
      </form>
    </SettingsRow>
  );
}

// ---------------------------------------------------------------------------
// Desk QR keys
// ---------------------------------------------------------------------------

function DesksGroup({ setup }: { setup: ClockSetup }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const { stationId, key } = useStationKey();
  const [showQr, setShowQr] = useState(false);
  const here = setup.stations.find((s) => s.stationId === stationId) ?? null;
  const status = deskKeyStatus(key, here ? { has_key: here.hasKey, issued_at: here.issuedAt } : null);

  const issue = useSetUpDesk();

  async function setUp() {
    const replacing = here?.hasKey || key !== null;
    if (replacing) {
      const yes = await confirm({
        kind: 'danger',
        title: tr('ws.clock.setup.desk.replaceTitle'),
        body: tr('ws.clock.setup.desk.replaceBody'),
        confirmLabel: tr('ws.clock.setup.desk.replaceConfirm'),
        cancelLabel: tr('ws.clock.setup.desk.keep'),
      });
      if (!yes) return;
    }
    issue.mutate(undefined, { onSuccess: () => toast.ok(tr('ws.clock.setup.desk.done')) });
  }

  const keyLine = (s: ClockSetup['stations'][number]): ReactNode =>
    s.hasKey && s.issuedAt
      ? s.issuedByName
        ? tr('ws.clock.setup.desk.issuedBy', { when: formatDateTime(new Date(s.issuedAt), locale), name: isolate(s.issuedByName) })
        : tr('ws.clock.setup.desk.issuedAt', { when: formatDateTime(new Date(s.issuedAt), locale) })
      : tr('ws.clock.setup.desk.noKey');

  const notKept = isKeyNotKept(issue.error);

  return (
    <>
    <SettingsGroup title={tr('ws.clock.setup.desk.title')} description={tr('ws.clock.setup.desk.lead')}>
      {/* This computer first: it is the only desk that can be set up from here. */}
      <SettingsRow
        end={
          !here ? (
            // Not a station of the branch yet: the same press registers it, then makes its QR.
            <Button size="sm" kind="primary" icon="qr" busy={issue.isPending} onClick={() => void setUp()} data-testid="clock-desk-setup">
              {tr('ws.clock.setup.desk.setUp')}
            </Button>
          ) : (
            <>
              {status === 'current' && (
                <Button size="sm" icon="qr" onClick={() => setShowQr(true)} data-testid="clock-desk-show">
                  {tr('ws.clock.setup.desk.show')}
                </Button>
              )}
              <Button
                size="sm"
                kind={status === 'current' ? 'default' : 'primary'}
                icon={status === 'current' ? 'refresh' : 'qr'}
                busy={issue.isPending}
                onClick={() => void setUp()}
                data-testid="clock-desk-setup"
              >
                {tr(status === 'none' ? 'ws.clock.setup.desk.setUp' : 'ws.clock.setup.desk.setUpAgain')}
              </Button>
            </>
          )
        }
      >
        <p style={{ margin: 0, display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong dir="ltr">{stationId}</strong>
          <StatusBadge size="sm" dot={false} tone="accent" label={tr('ws.clock.setup.desk.thisComputer')} />
          {here && status === 'current' && <StatusBadge size="sm" tone="success" label={tr('ws.clock.setup.desk.status.current')} />}
          {here && status === 'stale' && <StatusBadge size="sm" tone="warn" label={tr('ws.clock.setup.desk.status.stale')} />}
          {here && status === 'lost' && <StatusBadge size="sm" tone="warn" label={tr('ws.clock.setup.desk.status.lost')} />}
        </p>
        {here ? <p style={muted}>{keyLine(here)}</p> : <p style={muted}>{tr('ws.clock.setup.desk.notRegistered')}</p>}
        {here && status === 'stale' && <MessagePresenter tone="refused" message={tr('ws.clock.setup.desk.staleBody')} />}
        {here && status === 'lost' && <MessagePresenter tone="refused" message={tr('ws.clock.setup.desk.lostBody')} />}
        {notKept ? <MessagePresenter tone="error" message={tr('ws.clock.setup.desk.notKept')} /> : issue.isError && <ErrorText error={issue.error} />}
      </SettingsRow>

      {setup.stations
        .filter((s) => s.stationId !== stationId)
        .map((s) => (
          <SettingsRow key={s.stationId} end={s.hasKey ? <StatusBadge size="sm" tone="success" label={tr('ws.clock.setup.desk.hasQr')} /> : <StatusBadge size="sm" tone="neutral" label={tr('ws.clock.setup.desk.noQr')} />}>
            <strong dir="ltr">{s.stationId}</strong>
            <p style={muted}>
              {keyLine(s)}
              {!s.hasKey && ` ${tr('ws.clock.setup.desk.fromThere')}`}
            </p>
          </SettingsRow>
        ))}
    </SettingsGroup>
    {showQr && <StaffQrView onClose={() => setShowQr(false)} />}
    </>
  );
}
