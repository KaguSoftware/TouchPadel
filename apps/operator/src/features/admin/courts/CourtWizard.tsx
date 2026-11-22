/**
 * One court in the stepped dialog every "add new" form uses (StepWizard, Sait
 * 2026-10-22): Name, Details (type, lengths, photo, opening), then Review.
 * Adding and editing are the same wizard; an edit starts from the saved court.
 * Nothing is written until Review's Add court / Save (`app.upsert_court`).
 * Switching an open court off is confirmed and refused while bookings are
 * ahead; Delete sits on Review for a court that exists, and a court with
 * history (COURT_IN_USE) is offered "switch off instead".
 */
import { useState } from 'react';
import { bookableDurations } from '@touch/core';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatNumber } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Skeleton } from '../../../components/ui';
import { MessagePresenter, SegmentedControl } from '../../../components/kit';
import { BilingualFields } from '../../../components/inputs';
import { ImageField } from '../../../components/ImageField';
import { ReviewList, StepWizard, WizardToggle } from '../../../components/StepWizard';
import { DURATION_CHOICES, courtUsageFromError, durationsValid, toggleDuration, type CourtUsage } from './courtsLogic';
import { fetchUpcomingBookings, type CourtAdminRow } from './CourtsAdmin';

export function CourtWizard({ court, onDone, onClose }: { court: CourtAdminRow | null; onDone: () => void; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [nameEn, setNameEn] = useState(court?.name_en ?? '');
  const [nameAr, setNameAr] = useState(court?.name_ar ?? '');
  const [descEn, setDescEn] = useState(court?.description_en ?? '');
  const [descAr, setDescAr] = useState(court?.description_ar ?? '');
  const [indoor, setIndoor] = useState(court?.indoor ?? true);
  // A length off the hour (an old 90) is dropped here, so the next save clears it.
  const [durations, setDurations] = useState<number[]>(() => bookableDurations(court?.duration_options ?? [60, 120]));
  const [photo, setPhoto] = useState<string | null>(court?.photo_path ?? null);
  const [active, setActive] = useState(court?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** COURT_IN_USE: a refusal, so the control stays and the counts are shown. */
  const [inUse, setInUse] = useState<CourtUsage | null>(null);
  const courtName = court ? pickName(locale, court) : '';

  // Only asked when an open court is being switched off: the one change the
  // server refuses while bookings are ahead.
  const switchingOff = court !== null && court.is_active && !active;
  const upcomingQ = useQuery({
    queryKey: ['courts', 'upcoming', court?.id],
    queryFn: () => fetchUpcomingBookings(court!.id),
    enabled: switchingOff,
    staleTime: 0,
  });
  const upcoming = switchingOff ? (upcomingQ.data ?? null) : null;
  const blockedByBookings = upcoming !== null && upcoming > 0;

  async function write(isActive: boolean) {
    await appRpc('upsert_court', {
      p_id: court?.id ?? null,
      p_name_en: nameEn,
      p_name_ar: nameAr,
      p_indoor: indoor,
      p_description_en: descEn || null,
      p_description_ar: descAr || null,
      p_photo_path: photo,
      p_duration_options: durations,
      p_is_active: isActive,
      // 0097: the window is passed back unchanged; the server stamps active_to
      // on deactivation and clears it when the court comes back.
      p_active_from: court?.active_from ?? null,
      p_active_to: court?.active_to ?? null,
    });
  }

  async function submit() {
    if (switchingOff) {
      const ok = await confirm({
        title: tr('ws.owner.courts.offConfirm', { court: courtName }),
        body: tr('ws.owner.courts.offConfirmBody'),
        kind: 'danger',
        confirmLabel: tr('ws.owner.courts.offConfirmAction'),
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      await write(active);
      toast.ok(tr('op.toast.saved'));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!court) return;
    const ok = await confirm({
      title: tr('ws.owner.courts.deleteConfirm', { court: courtName }),
      body: tr('ws.owner.courts.deleteConfirmBody'),
      kind: 'danger',
      confirmLabel: tr('ws.owner.courts.delete'),
    });
    if (!ok) return;
    setDeleting(true);
    setError(null);
    setInUse(null);
    try {
      await appRpc('delete_court', { p_id: court.id });
      toast.ok(tr('ws.owner.courts.deleted'));
      onDone();
    } catch (e) {
      // A refusal is not a failure: the court has history and must be
      // switched off instead, which the notice offers directly.
      const usage = courtUsageFromError(e);
      if (usage) setInUse(usage);
      else setError(e);
    } finally {
      setDeleting(false);
    }
  }

  /** The way out of COURT_IN_USE, without making the operator hunt for it. */
  async function switchOffInstead() {
    if (!court) return;
    setDeleting(true);
    setError(null);
    try {
      await write(false);
      toast.ok(tr('op.toast.saved'));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setDeleting(false);
    }
  }

  const namesMissing = !nameEn.trim() || !nameAr.trim();
  const lengths = [...durations]
    .sort((a, b) => a - b)
    .map((d) => tr('op.common.minutesShort', { minutes: formatNumber(d, locale) }))
    .join(' · ');
  const working = busy || deleting;

  return (
    <StepWizard
      title={court ? courtName : tr('op.courts.newTitle')}
      lead={tr('ws.owner.courts.wizardLead')}
      testId="court-wizard"
      onClose={onClose}
      busy={working}
      submitLabel={court ? tr('common.save') : tr('ws.owner.courts.create')}
      onSubmit={() => void submit()}
      submitBlocked={switchingOff && upcomingQ.isPending ? tr('ws.owner.courts.saveBlockedBookings') : null}
      notice={
        error || inUse ? (
          <>
            <ErrorText error={error} />
            {inUse && (
              <MessagePresenter
                tone="refused"
                rise
                message={
                  <span style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
                    <span>
                      {tr('ws.owner.courts.deleteInUse', {
                        court: courtName,
                        bookings: formatNumber(inUse.reservations, locale),
                        series: formatNumber(inUse.series, locale),
                        rules: formatNumber(inUse.rate_rules, locale),
                      })}
                    </span>
                    <span>{tr('ws.owner.courts.deleteInUseFix')}</span>
                    {court?.is_active && (
                      <Button size="sm" icon="ban" busy={deleting} disabled={busy} onClick={() => void switchOffInstead()}>
                        {tr('ws.owner.courts.deactivate')}
                      </Button>
                    )}
                  </span>
                }
              />
            )}
          </>
        ) : undefined
      }
      steps={[
        {
          key: 'names',
          label: tr('ws.owner.courts.stepNames'),
          note: nameEn.trim() || null,
          problems: namesMissing ? [tr('ws.manager.disabled.namesRequired')] : [],
          content: (
            <>
              {/* Labels stay "Name (English)" / "Name (Arabic)": the e2e suite and the desk staff know them by those names. */}
              <BilingualFields labelEn={tr('op.courts.nameEn')} labelAr={tr('op.courts.nameAr')} en={nameEn} ar={nameAr} onEn={setNameEn} onAr={setNameAr} disabled={working} maxLength={60} />
              <BilingualFields labelEn={tr('op.courts.descEn')} labelAr={tr('op.courts.descAr')} en={descEn} ar={descAr} onEn={setDescEn} onAr={setDescAr} disabled={working} multiline maxLength={300} />
              <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.courts.descriptionHint')}</p>
            </>
          ),
        },
        {
          key: 'details',
          label: tr('ws.owner.courts.stepDetails'),
          note: lengths || null,
          problems: [
            ...(durationsValid(durations) ? [] : [tr('ws.owner.courts.lengthsRequired')]),
            ...(blockedByBookings ? [tr('ws.owner.courts.saveBlockedBookings')] : []),
          ],
          content: (
            <>
              <Field label={tr('ws.owner.courts.typeLabel')} group>
                <SegmentedControl<'indoor' | 'outdoor'>
                  value={indoor ? 'indoor' : 'outdoor'}
                  onChange={(v) => setIndoor(v === 'indoor')}
                  aria-label={tr('ws.owner.courts.typeLabel')}
                  options={[
                    { value: 'indoor', label: tr('op.courts.indoor'), disabled: working },
                    { value: 'outdoor', label: tr('op.courts.outdoor'), disabled: working },
                  ]}
                />
              </Field>
              <Field label={tr('ws.owner.courts.lengthsLabel')} group hint={tr('ws.owner.courts.lengthsHint')} error={durationsValid(durations) ? undefined : tr('ws.owner.courts.lengthsRequired')}>
                <div role="group" aria-label={tr('ws.owner.courts.lengthsLabel')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)' }}>
                  {DURATION_CHOICES.map((d) => (
                    <Button key={d} size="sm" kind={durations.includes(d) ? 'primary' : 'default'} aria-pressed={durations.includes(d)} disabled={working} onClick={() => setDurations((prev) => toggleDuration(prev, d))}>
                      {tr('op.common.minutesShort', { minutes: d })}
                    </Button>
                  ))}
                </div>
              </Field>
              <ImageField label={tr('op.courts.photo')} value={photo} onChange={setPhoto} folder="courts" ownerId={court?.id ?? 'new'} aspect="16:9" disabled={working} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />
              <WizardToggle checked={active} onChange={setActive} label={tr('ws.owner.courts.openLabel')} hint={active ? tr('ws.owner.courts.openOnHint') : tr('ws.owner.courts.openOffHint')} disabled={working} />
              {switchingOff && upcomingQ.isPending && <Skeleton lines={1} blockSize="1.6rem" />}
              {switchingOff && upcomingQ.isError && <ErrorText error={upcomingQ.error} />}
              {blockedByBookings && (
                <MessagePresenter
                  tone="refused"
                  style={{ flexWrap: 'wrap' }}
                  message={
                    <span style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
                      <span>{tr('ws.owner.courts.hasBookings', { count: formatNumber(upcoming, locale) })}</span>
                      <Button size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/desk' })}>
                        {tr('ws.owner.courts.openDesk')}
                      </Button>
                    </span>
                  }
                />
              )}
            </>
          ),
        },
      ]}
      review={(goTo) => (
        <>
          <ReviewList
            goTo={goTo}
            busy={working}
            rows={[
              { label: tr('op.courts.nameEn'), value: <bdi>{nameEn}</bdi>, step: 'names' },
              { label: tr('op.courts.nameAr'), value: <bdi>{nameAr}</bdi>, step: 'names' },
              { label: tr('ws.owner.courts.typeLabel'), value: indoor ? tr('op.courts.indoor') : tr('op.courts.outdoor'), step: 'details' },
              { label: tr('ws.owner.courts.lengthsLabel'), value: lengths, step: 'details' },
              { label: tr('op.courts.photo'), value: photo ? tr('common.yes') : '—', step: 'details' },
              { label: tr('ws.owner.courts.openLabel'), value: active ? tr('common.yes') : tr('common.no'), step: 'details' },
            ]}
          />
          {/* Destructive, so it sits apart from the submit, and only on a court that exists. */}
          {court && (
            <Button kind="ghost" icon="trash" busy={deleting} disabled={busy} style={{ color: 'var(--tp-danger-fg)', marginBlockStart: 'var(--tp-sp-3)' }} onClick={() => void remove()}>
              {tr('ws.owner.courts.delete')}
            </Button>
          )}
        </>
      )}
    />
  );
}
