/**
 * StaffAccountEditor (spec 06.46) — one account, managed in a stepped wizard
 * modal (Sait, 2026-11-22; the same frame as Add staff member).
 *
 * Steps: Name & role · Access · PIN & password · Hours · Branches · Review.
 *
 * What is DRAFTED (name `rename_staff`, role `set_staff_role`, second jobs and
 * blocked pages `set_staff_access`, branches `set_staff_venues`) is held across
 * the steps and written once, from the Review page, behind ONE confirm that
 * names every change: the new role and what it opens, every job added or taken
 * away, every page closed or opened again, the branches. Nothing is written
 * until that yes. There are no per-step Save buttons.
 *
 * The sign-in step (a new PIN or removing the PIN, a new password) and Set
 * hours are drafts too and are written at the same press. Only removing or
 * restoring access stays an act of its own, because it signs the person out
 * (0081: on every device within the hour, PIN cleared, the records keep the
 * name): it is the red button in the footer and asks first.
 *
 * The role the Access step works from is the DRAFT role, so the pages it lists
 * are the ones the new role opens; `set_staff_role` is written before
 * `set_staff_access`. Hints are the kit's InfoTip, not lines of grey text.
 *
 * The old "Email" field is gone: the address lives in the auth system and
 * list_staff does not return it. Its one useful sentence — create a new
 * account to change the email — is the name field's info tip.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { callEdge } from '../../../lib/edge';
import { supabase } from '../../../lib/supabase';
import { canAccess, type StaffRole } from '../../../lib/auth';
import {
  ACCESS_AREAS,
  ACCESS_AREA_KEYS,
  SECOND_JOB_ROLES,
  parseStaffAccess,
  teamOf,
  type AccessArea,
  type SecondJobRole,
} from '@touch/core';
import { useLocale, pickName } from '../../../lib/i18n';
import { useVenue } from '../../../lib/venue';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, Field, inputStyle } from '../../../components/ui';
import { InfoTip } from '../../../components/InfoTip';
import { MessagePresenter, StatusBadge } from '../../../components/kit';
import { ReviewList, StepWizard, type WizardStep } from '../../../components/StepWizard';
import { RoleField, StaffErrorText } from './staffParts';
import { MIN_PASSWORD, PIN_MAX, PIN_MIN, STAFF_QUERY_KEY, approvesWithPin, pinFormatOk, type StaffRow } from './staffModel';
import { HoursEditor, useHoursDraft } from '../../clock/HoursEditor';
import { CK } from '../../clock/api';

interface AccessDraft {
  extraRoles: SecondJobRole[];
  blockedAreas: AccessArea[];
}

const EMPTY_ACCESS: AccessDraft = { extraRoles: [], blockedAreas: [] };
const sameSet = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * 0345: what the Access step shows for a role and a draft. Second jobs add a
 * front-line role the server counts in every guard (app.is_staff); the pages
 * list is every page the role and the ticked jobs open, ticked unless blocked,
 * and it follows the jobs as they are ticked. A block on a page nothing opens
 * any more is dropped on save rather than kept invisibly.
 */
function accessModel(role: StaffRole, saved: AccessDraft, draft: AccessDraft | null) {
  const current = draft ?? saved;
  // A manager's role already holds every job a tick could add.
  const offerJobs = role !== 'manager';
  const jobs = SECOND_JOB_ROLES.filter((r) => r !== role);
  // 0446: every barista is also a cashier. The server keeps the job on the
  // bar team and on a barista second job, so the box is shown ticked and locked.
  const cashierWithBar = role !== 'cashier' && (teamOf(role) === 'bar' || current.extraRoles.includes('barista'));
  const extraRoles: SecondJobRole[] =
    cashierWithBar && !current.extraRoles.includes('cashier') ? [...current.extraRoles, 'cashier'] : current.extraRoles;
  const reach = { role, extraRoles };
  const pages = ACCESS_AREA_KEYS.filter((area) => canAccess(reach, ACCESS_AREAS[area][0]));
  const blocked = current.blockedAreas.filter((a) => pages.includes(a));
  const next: AccessDraft = { extraRoles, blockedAreas: blocked };
  const dirty = !sameSet(next.extraRoles, saved.extraRoles) || !sameSet(next.blockedAreas, saved.blockedAreas);
  return { current, offerJobs, jobs, cashierWithBar, extraRoles, pages, blocked, next, dirty };
}

export function StaffAccountEditor({
  staff,
  isSelf,
  canManage,
  onClose,
}: {
  staff: StaffRow;
  isSelf: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { venues } = useVenue();
  const [name, setName] = useState(staff.display_name);
  const [role, setRole] = useState<StaffRole>(staff.role);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  // Sign-in drafts: a new PIN (digits typed) or removing it, and a new password. Empty means unchanged.
  const [pin, setPin] = useState('');
  const [pinRemove, setPinRemove] = useState(false);
  const [password, setPassword] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: STAFF_QUERY_KEY });
  const immediate = <V,>(fn: (v: V) => Promise<unknown>, done: string) =>
    ({
      mutationFn: fn,
      onSuccess: () => {
        toast.ok(done);
        setError(null);
        void refresh();
      },
      onError: (e: unknown) => setError(e),
    }) as const;

  const setActive = useMutation(
    immediate(
      (v: boolean) => appRpc('set_staff_active', { p_staff_id: staff.id, p_active: v }),
      staff.is_active ? tr('ws.owner.staff.editor.accessRemoved') : tr('ws.owner.staff.editor.accessRestored'),
    ),
  );

  const busy = setActive.isPending || saving;
  // The server refuses every self-edit but a rename (CANNOT_EDIT_SELF), so one
  // owner can never lock the venue out; say so rather than let them find out.
  const locked = !canManage || isSelf;
  const n = (v: number) => formatNumber(v, locale);
  const trimmed = name.trim();
  const nameDirty = trimmed !== '' && trimmed !== staff.display_name;
  const roleDirty = role !== staff.role;
  const roleName = (r: StaffRole) => tr(`op.roles.${r}`);
  const jobName = (r: StaffRole) => tr(`op.roles.${r}`);
  const pageName = (a: AccessArea) => tr(`ws.owner.staff.access.areas.${a}`);
  const listOf = (items: string[]) => new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);

  // ---- Access (second jobs, blocked pages) -------------------------------------
  const targetIsOwner = staff.role === 'owner';
  const accessKey = ['staffAccess', staff.id] as const;
  const accessQ = useQuery({
    queryKey: accessKey,
    enabled: !targetIsOwner,
    queryFn: async (): Promise<AccessDraft> => {
      const { data, error: e } = await supabase.from('staff').select('extra_roles, blocked_areas').eq('id', staff.id).maybeSingle();
      if (e) throw new Error(e.message);
      return parseStaffAccess(data ?? {});
    },
  });
  const [accessDraft, setAccessDraft] = useState<AccessDraft | null>(null);
  // A fresh answer from the server replaces an untouched draft.
  useEffect(() => setAccessDraft(null), [accessQ.data]);
  const savedAccess = accessQ.data ?? EMPTY_ACCESS;
  const access = accessModel(role, savedAccess, accessDraft);
  const accessLocked = locked || !staff.is_active;
  // An owner (before or after this save) holds everything: nothing to write.
  const accessDirty = !targetIsOwner && role !== 'owner' && !accessLocked && accessQ.isSuccess && access.dirty;

  // ---- Branches (multi-venue slice 4, 0218/0227) --------------------------------
  const showBranches = canManage && staff.is_active && venues.length > 1;
  const branchesKey = ['staffMemberships', staff.id] as const;
  const membershipsQ = useQuery({
    queryKey: branchesKey,
    enabled: showBranches && !targetIsOwner,
    queryFn: () => appRpc<string[]>('staff_memberships', { p_staff_id: staff.id }),
  });
  const [branchDraft, setBranchDraft] = useState<Set<string> | null>(null);
  useEffect(() => setBranchDraft(null), [membershipsQ.data]);
  const currentBranches = useMemo(() => new Set(membershipsQ.data ?? []), [membershipsQ.data]);
  const chosenBranches = branchDraft ?? currentBranches;
  const branchDirty =
    showBranches &&
    !targetIsOwner &&
    branchDraft !== null &&
    branchDraft.size > 0 &&
    (branchDraft.size !== currentBranches.size || [...branchDraft].some((v) => !currentBranches.has(v)));
  const branchNames = (ids: Set<string>) => venues.filter((v) => ids.has(v.id)).map((v) => pickName(locale, v));

  // ---- Hours (0442) ---------------------------------------------------------------
  const showHours = staff.role !== 'owner' && staff.is_active;
  const hours = useHoursDraft(staff.id, showHours);
  const hoursDirty = showHours && hours.dirty && hours.issue === null;

  // ---- Sign-in -----------------------------------------------------------------------
  const signInOpen = canManage && staff.is_active;
  // 4-12 digits, as app.set_staff_pin checks since 0078 (SEC-13). The server also refuses a repeated
  // digit or a run (PIN_WEAK); that is not mirrored here, the refusal says it in words.
  const pinTyped = pin !== '';
  const pinDirty = signInOpen && (pinRemove ? staff.has_pin : pinTyped && pinFormatOk(pin));
  const passwordDirty = signInOpen && password.length >= MIN_PASSWORD;

  const anyDirty = nameDirty || roleDirty || accessDirty || branchDirty || hoursDirty || pinDirty || passwordDirty;

  async function saveAll() {
    if (!anyDirty) {
      onClose();
      return;
    }
    const added = access.next.extraRoles.filter((r) => !savedAccess.extraRoles.includes(r));
    const removed = savedAccess.extraRoles.filter((r) => !access.next.extraRoles.includes(r));
    const closed = access.next.blockedAreas.filter((a) => !savedAccess.blockedAreas.includes(a));
    const reopened = savedAccess.blockedAreas.filter((a) => !access.next.blockedAreas.includes(a) && access.pages.includes(a));
    const lines = [
      nameDirty && tr('ws.owner.staff.editor.lineName', { name: trimmed }),
      roleDirty && tr('ws.owner.staff.editor.lineRole', { role: roleName(role) }),
      roleDirty && tr(`ws.owner.staff.roleAccess.${role}`),
      accessDirty && added.length > 0 && tr('ws.owner.staff.access.confirmAddJobs', { list: listOf(added.map(jobName)) }),
      accessDirty && removed.length > 0 && tr('ws.owner.staff.access.confirmRemoveJobs', { list: listOf(removed.map(jobName)) }),
      accessDirty && closed.length > 0 && tr('ws.owner.staff.access.confirmBlock', { list: listOf(closed.map(pageName)) }),
      accessDirty && reopened.length > 0 && tr('ws.owner.staff.access.confirmUnblock', { list: listOf(reopened.map(pageName)) }),
      branchDirty && tr('ws.owner.staff.editor.lineBranches', { list: listOf(branchNames(chosenBranches)) }),
      hoursDirty && tr('ws.owner.staff.editor.lineHours'),
      pinDirty && (pinRemove ? tr('ws.owner.staff.pin.removeBody') : tr('ws.owner.staff.editor.linePin')),
      passwordDirty && tr('ws.owner.staff.editor.linePassword'),
    ].filter((l): l is string => Boolean(l));
    const ok = await confirm({
      title: tr('ws.owner.staff.editor.saveConfirmTitle', { name: staff.display_name }),
      body: (
        <>
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p style={{ marginBlockStart: 'var(--tp-sp-2)', color: 'var(--tp-muted-fg)' }}>
            {roleDirty ? tr('ws.owner.staff.editor.roleWhen') : tr('ws.owner.staff.access.confirmWhen')}
          </p>
        </>
      ),
      kind: roleDirty && role === 'owner' ? 'danger' : 'primary',
      confirmLabel: tr('ws.owner.staff.editor.saveAction'),
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      // Role first: the access write is judged against the new role.
      if (nameDirty) await appRpc('rename_staff', { p_staff_id: staff.id, p_display_name: trimmed });
      // Hours go in before the role: the week was written against the jobs the person holds now.
      if (hoursDirty) await hours.save();
      if (roleDirty) await appRpc('set_staff_role', { p_staff_id: staff.id, p_role: role });
      if (accessDirty) {
        await appRpc('set_staff_access', {
          p_staff_id: staff.id,
          p_extra_roles: access.next.extraRoles,
          p_blocked_areas: access.next.blockedAreas,
        });
      }
      if (branchDirty) await appRpc('set_staff_venues', { p_staff_id: staff.id, p_venue_ids: [...chosenBranches] });
      if (pinDirty) {
        if (pinRemove) await appRpc('clear_staff_pin', { p_staff_id: staff.id });
        else await appRpc('set_staff_pin', { p_staff_id: staff.id, p_pin: pin });
      }
      if (passwordDirty) {
        await callEdge<unknown, { result: string }>('staff-admin', { action: 'reset_password', staff_id: staff.id, password }, { ttlMs: 0 });
      }
      toast.ok(tr('op.toast.saved'));
      void refresh();
      void queryClient.invalidateQueries({ queryKey: accessKey });
      void queryClient.invalidateQueries({ queryKey: branchesKey });
      void queryClient.invalidateQueries({ queryKey: CK.all });
      onClose();
    } catch (e) {
      // What was written before the refusal stays written; the lists reload so
      // the wizard shows what is left to save.
      setError(e);
      void refresh();
      void queryClient.invalidateQueries({ queryKey: accessKey });
      void queryClient.invalidateQueries({ queryKey: branchesKey });
      void queryClient.invalidateQueries({ queryKey: CK.all });
    } finally {
      setSaving(false);
    }
  }

  async function toggleAccess() {
    const removing = staff.is_active;
    const ok = await confirm({
      title: removing
        ? tr('ws.owner.staff.editor.removeConfirm', { name: staff.display_name })
        : tr('ws.owner.staff.editor.restoreConfirm', { name: staff.display_name }),
      body: removing ? tr('op.staff.confirmDeactivateBody', { name: staff.display_name }) : tr('ws.owner.staff.editor.restoreBody'),
      kind: removing ? 'danger' : 'primary',
      confirmLabel: removing ? tr('op.staff.deactivate') : tr('op.staff.activate'),
    });
    if (ok) setActive.mutate(!removing);
  }

  const pinNote = approvesWithPin(staff.role)
    ? staff.has_pin
      ? tr('ws.owner.staff.pin.hasPin')
      : tr('ws.owner.staff.pin.noPin')
    : staff.has_pin
      ? tr('ws.owner.staff.pin.hasPinUnlockOnly')
      : tr('ws.owner.staff.pin.noPinUnlockOnly');
  const statusLabel = staff.is_active ? tr('ws.owner.staff.status.active') : tr('ws.owner.staff.status.inactive');

  const accessStep = (): ReactNode => {
    if (role === 'owner' || targetIsOwner) return <MessagePresenter tone="info" message={tr('ws.owner.staff.access.owner')} />;
    if (accessQ.isLoading) return <Note>…</Note>;
    if (accessQ.isError) return <StaffErrorText error={accessQ.error} />;
    const disabled = accessLocked || busy;
    const edit = (patch: Partial<AccessDraft>) => setAccessDraft({ ...access.current, ...patch });
    const toggle = <T,>(list: readonly T[], item: T, on: boolean): T[] => (on ? [...list, item] : list.filter((x) => x !== item));
    return (
      <div data-testid="staff-access" style={{ display: 'grid', gap: 'var(--tp-sp-5)' }}>
        <fieldset style={groupStyle}>
          <legend className="tp-sr-only">{tr('ws.owner.staff.access.jobsTitle')}</legend>
          <Head
            title={tr('ws.owner.staff.access.jobsTitle')}
            info={
              <>
                <span style={{ display: 'block' }}>{tr('ws.owner.staff.access.lead')}</span>
                {access.offerJobs && (
                  <span style={{ display: 'block', marginBlockStart: 'var(--tp-sp-1)' }}>{tr('ws.owner.staff.access.jobsHint')}</span>
                )}
              </>
            }
          />
          {access.offerJobs ? (
            <>
              <CheckGrid>
                {access.jobs.map((r) => (
                  <Check
                    key={r}
                    testId={`access-job-${r}`}
                    label={jobName(r)}
                    checked={access.extraRoles.includes(r)}
                    disabled={disabled || (r === 'cashier' && access.cashierWithBar)}
                    onChange={(on) => edit({ extraRoles: toggle(access.current.extraRoles, r, on) })}
                  />
                ))}
              </CheckGrid>
              {access.cashierWithBar && <MessagePresenter tone="info" message={tr('ws.owner.staff.access.cashierWithBar')} />}
            </>
          ) : (
            <MessagePresenter tone="info" message={tr('ws.owner.staff.access.management')} />
          )}
        </fieldset>

        <fieldset style={groupStyle}>
          <legend className="tp-sr-only">{tr('ws.owner.staff.access.pagesTitle')}</legend>
          <Head title={tr('ws.owner.staff.access.pagesTitle')} info={tr('ws.owner.staff.access.pagesHint')} />
          <CheckGrid>
            {access.pages.map((a) => (
              <Check
                key={a}
                testId={`access-page-${a}`}
                label={pageName(a)}
                checked={!access.blocked.includes(a)}
                disabled={disabled}
                onChange={(on) => edit({ blockedAreas: toggle(access.current.blockedAreas, a, !on) })}
              />
            ))}
          </CheckGrid>
        </fieldset>
      </div>
    );
  };

  const steps: WizardStep[] = [
    {
      key: 'profile',
      label: tr('ws.owner.staff.editor.steps.profile'),
      note: `${trimmed || staff.display_name} · ${roleName(role)}`,
      problems: trimmed === '' ? [tr('ws.owner.staff.add.nameNeeded')] : [],
      content: (
        <>
          {isSelf && <MessagePresenter tone="info" message={tr('ws.owner.staff.editor.selfNote')} />}
          <Field label={tr('ws.owner.staff.editor.name')} info={tr('ws.owner.staff.editor.nameHint')} style={{ marginBlockEnd: 0 }}>
            <input style={inputStyle} value={name} disabled={!canManage || busy} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <RoleField value={role} current={staff.role} onChange={setRole} disabled={locked || busy || !staff.is_active} flush asInfo />
          {!staff.is_active && <MessagePresenter tone="info" message={tr('ws.owner.staff.editor.roleInactive')} />}
        </>
      ),
    },
    { key: 'access', label: tr('ws.owner.staff.access.title'), content: accessStep() },
    {
      key: 'signin',
      label: tr('ws.owner.staff.editor.steps.signIn'),
      note: staff.has_pin ? tr('op.staff.pinSet') : tr('op.staff.pinNone'),
      problems: [
        ...(pinTyped && !pinFormatOk(pin) ? [tr('ws.owner.staff.pin.length', { min: n(PIN_MIN), max: n(PIN_MAX) })] : []),
        ...(password !== '' && password.length < MIN_PASSWORD ? [tr('ws.owner.staff.password.tooShort', { min: n(MIN_PASSWORD) })] : []),
      ],
      content: (
        <>
          {!staff.is_active && <MessagePresenter tone="info" message={tr('ws.owner.staff.editor.roleInactive')} />}
          {/* Every role holds a PIN since 0105; the tip says what THIS one does. */}
          <Card>
            <Head
              title={tr('ws.owner.staff.pin.title')}
              info={pinNote}
              aside={
                staff.has_pin ? (
                  <StatusBadge tone="success" size="sm" label={tr('op.staff.pinSet')} />
                ) : (
                  <StatusBadge tone={approvesWithPin(staff.role) ? 'warn' : 'neutral'} size="sm" label={tr('op.staff.pinNone')} />
                )
              }
            />
            {pinRemove ? (
              <>
                <MessagePresenter tone="info" message={tr('ws.owner.staff.editor.pinWillRemove')} />
                <div>
                  <Button size="sm" icon="undo" disabled={busy} onClick={() => setPinRemove(false)}>
                    {tr('ws.owner.staff.editor.keepPin')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Field
                  label={tr('ws.owner.staff.pin.label')}
                  hint={tr('ws.owner.staff.pin.hint', { min: n(PIN_MIN), max: n(PIN_MAX) })}
                  error={pinTyped && !pinFormatOk(pin) ? tr('ws.owner.staff.pin.length', { min: n(PIN_MIN), max: n(PIN_MAX) }) : undefined}
                  style={{ marginBlockEnd: 0 }}
                >
                  <input
                    style={{ ...inputStyle, fontSize: 'var(--tp-fs-xl)', letterSpacing: '0.3em' }}
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={!signInOpen || busy}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX))}
                  />
                </Field>
                {staff.has_pin && (
                  <div>
                    <Button
                      size="sm"
                      kind="ghost"
                      icon="ban"
                      disabled={!signInOpen || busy}
                      onClick={() => {
                        setPin('');
                        setPinRemove(true);
                      }}
                    >
                      {tr('op.staff.pinClear')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
          <Card>
            <Head title={tr('ws.owner.staff.password.title')} info={tr('ws.owner.staff.password.panelNote')} />
            {/* Shown, not masked: the owner reads it out during training and the person changes it afterwards. */}
            <Field
              label={tr('ws.owner.staff.password.label')}
              hint={tr('op.staff.passwordHint', { min: n(MIN_PASSWORD) })}
              error={password !== '' && password.length < MIN_PASSWORD ? tr('ws.owner.staff.password.tooShort', { min: n(MIN_PASSWORD) }) : undefined}
              style={{ marginBlockEnd: 0 }}
            >
              <input
                style={inputStyle}
                dir="ltr"
                type="text"
                autoComplete="off"
                disabled={!signInOpen || busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </Card>
        </>
      ),
    },
    // Set hours (0442): the person's week of shifts, which log-ins are measured against.
    // The owner has no hours; an inactive account keeps none it could use.
    ...(showHours
      ? [
          {
            key: 'hours',
            label: tr('ws.clock.hours.title'),
            problems: hours.dirty && hours.issue !== null ? [tr('ws.clock.hours.fixFirst')] : [],
            content: <HoursEditor staffId={staff.id} compact model={hours} />,
          },
        ]
      : []),
    ...(showBranches
      ? [
          {
            key: 'branches',
            label: tr('ws.branches.staff.branches'),
            problems: !targetIsOwner && chosenBranches.size === 0 ? [tr('ws.owner.staff.editor.branchNeeded')] : [],
            content: targetIsOwner ? (
              <MessagePresenter tone="info" message={tr('ws.branches.staff.owner')} />
            ) : (
              <>
                <Head title={tr('ws.branches.staff.branches')} info={tr('ws.branches.staff.branchesHint')} />
                <CheckGrid>
                  {venues.map((v) => (
                    <Check
                      key={v.id}
                      testId={`branch-${v.id}`}
                      label={pickName(locale, v)}
                      checked={chosenBranches.has(v.id)}
                      disabled={!canManage || busy}
                      onChange={(on) => {
                        const next = new Set(chosenBranches);
                        if (on) next.add(v.id);
                        else next.delete(v.id);
                        setBranchDraft(next);
                      }}
                    />
                  ))}
                </CheckGrid>
              </>
            ),
          },
        ]
      : []),
  ];

  const pending = (changed: boolean, value: ReactNode): ReactNode =>
    changed ? (
      <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
        {value}
        <StatusBadge tone="info" size="sm" dot={false} label={tr('ws.owner.staff.editor.pending')} />
      </span>
    ) : (
      value
    );
  const reviewAccess = !targetIsOwner && role !== 'owner' && staff.is_active && accessQ.isSuccess;

  return (
    <StepWizard
      title={staff.display_name}
      eyebrow={statusLabel}
      testId="staff-editor"
      steps={steps}
      onClose={onClose}
      busy={busy}
      notice={error ? <StaffErrorText error={error} /> : undefined}
      reviewLead={tr('ws.owner.staff.editor.reviewLead')}
      submitLabel={anyDirty ? tr('ws.owner.staff.editor.saveAction') : tr('ws.owner.staff.editor.done')}
      onSubmit={() => void saveAll()}
      // Removing or restoring access is the account's own act, not a draft: the red
      // button stands where Previous would, on every page.
      footerStart={
        <Button
          size="lg"
          kind={staff.is_active ? 'danger' : 'default'}
          icon={staff.is_active ? 'ban' : 'undo'}
          busy={setActive.isPending}
          disabled={locked || busy}
          disabledReason={isSelf ? tr('ws.manager.disabled.self') : undefined}
          onClick={() => void toggleAccess()}
        >
          {staff.is_active ? tr('op.staff.deactivate') : tr('op.staff.activate')}
        </Button>
      }
      review={(goTo) => (
        <ReviewList
          goTo={goTo}
          busy={busy}
          rows={[
            { label: tr('ws.owner.staff.editor.name'), value: pending(nameDirty, <bdi>{nameDirty ? trimmed : staff.display_name}</bdi>), step: 'profile' },
            { label: tr('op.staff.role'), value: pending(roleDirty, roleName(role)), step: 'profile' },
            ...(reviewAccess
              ? [
                  {
                    label: tr('ws.owner.staff.access.jobsTitle'),
                    value: pending(accessDirty, access.extraRoles.length > 0 ? listOf(access.extraRoles.map(jobName)) : '—'),
                    step: 'access',
                  },
                  {
                    label: tr('ws.owner.staff.access.pagesTitle'),
                    value: pending(
                      accessDirty,
                      access.blocked.length > 0
                        ? tr('ws.owner.staff.editor.closedPages', { list: listOf(access.blocked.map(pageName)) })
                        : tr('ws.owner.staff.editor.allOpen'),
                    ),
                    step: 'access',
                  },
                ]
              : []),
            ...(showBranches && !targetIsOwner
              ? [{ label: tr('ws.branches.staff.branches'), value: pending(branchDirty, listOf(branchNames(chosenBranches)) || '—'), step: 'branches' }]
              : []),
            ...(showHours
              ? [{ label: tr('ws.clock.hours.title'), value: pending(hoursDirty, hoursDirty ? tr('ws.owner.staff.editor.updated') : tr('ws.owner.staff.editor.unchanged')), step: 'hours' }]
              : []),
            {
              label: tr('ws.owner.staff.pin.title'),
              value: pending(pinDirty, (pinDirty ? !pinRemove : staff.has_pin) ? tr('op.staff.pinSet') : tr('op.staff.pinNone')),
              step: 'signin',
            },
            {
              label: tr('ws.owner.staff.password.title'),
              value: pending(passwordDirty, passwordDirty ? tr('ws.owner.staff.add.passwordSet') : tr('ws.owner.staff.editor.unchanged')),
              step: 'signin',
            },
          ]}
        />
      )}
    />
  );
}

const groupStyle = { border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--tp-sp-2)' } as const;

/** A group's heading with the kit's info tip beside it, in place of a line of grey hint text. */
function Head({ title, info, aside }: { title: string; info: ReactNode; aside?: ReactNode }) {
  return (
    <h3 style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-xl)', fontWeight: 700, margin: 0 }}>
      {title}
      <InfoTip content={info} />
      {aside && <span style={{ marginInlineStart: 'auto' }}>{aside}</span>}
    </h3>
  );
}

/** One thing to change, in its own box. */
function Card({ children }: { children: ReactNode }) {
  return (
    <section
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-3)',
        padding: 'var(--tp-sp-4)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-panel)',
        background: 'var(--tp-surface)',
      }}
    >
      {children}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{children}</p>;
}

/** Tiles in an even grid: every one the same height, so a long name wraps inside its own tile. */
function CheckGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))', gap: 'var(--tp-sp-2)' }}>{children}</div>;
}

function Check({
  label,
  checked,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
  testId: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-2)',
        minBlockSize: '3.25rem',
        paddingInline: 'var(--tp-sp-3)',
        border: `1px solid ${checked ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
        borderRadius: 'var(--tp-radius-ctl)',
        background: checked ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
        fontWeight: checked ? 600 : 500,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && !checked ? 0.6 : 1,
      }}
    >
      <input type="checkbox" data-testid={testId} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ minInlineSize: 0, textWrap: 'balance' }}>{label}</span>
    </label>
  );
}
