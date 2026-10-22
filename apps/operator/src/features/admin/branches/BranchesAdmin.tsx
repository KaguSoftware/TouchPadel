/**
 * Settings › Branches (multi-venue slice 4, plan MV1; merged with Club details
 * 2026-10-18): every Touch location, the owner's "Open a new branch", and,
 * on the branch's Club details page, the checklist a new branch works through
 * before "Open to guests".
 *
 * - Create copies the setup of a branch the owner picks (app.create_branch,
 *   0223) and lands the branch in Preparing: guests cannot see it.
 * - The checklist is app.branch_readiness. Each row links to the screen that
 *   fixes it; those screens work on the branch in the rail switcher, so the
 *   link switches to this branch first.
 * - Open to guests (app.open_branch) is refused with BRANCH_NOT_READY until
 *   every required row is done; Close (app.close_branch) never deletes.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { MessageKey } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { can, useAuth } from '../../../lib/auth';
import { useLocale, pickName } from '../../../lib/i18n';
import { useVenue, type VenueStatus } from '../../../lib/venue';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Skeleton, inputStyle } from '../../../components/ui';
import { EmptyState, PageHeader, Panel, StatusBadge, type Tone } from '../../../components/kit';
import { ReviewList, StepWizard, WizardChoice, WizardChoices, WizardNote } from '../../../components/StepWizard';
import { BilingualFields } from '../../../components/inputs';
import { ChevronBack, ChevronForward } from '../../../components/icons';
import { coachingErrorText } from '../../coaching/lessonLogic';
import {
  createBranchArgs,
  draftProblems,
  readyToOpen,
  sortReadiness,
  suggestSlug,
  type NewBranchDraft,
  type ReadinessKey,
  type ReadinessRow,
} from './branchesLogic';

interface BranchRow {
  id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  status: VenueStatus;
  timezone: string;
  phone: string | null;
  address_en: string | null;
  address_ar: string | null;
  created_at: string;
}

const STATUS_TONE: Record<VenueStatus, Tone> = { preparing: 'warn', open: 'success', closed: 'neutral' };

/** Where each checklist row is fixed. */
const FIX_ROUTE: Record<ReadinessKey, string> = {
  courts_and_rates: '/admin/rates',
  opening_hours: '/admin/hours',
  manager: '/admin/staff',
  till: '/admin/settings',
  menu: '/admin/menu',
  telegram: '/admin/telegram',
  opening_stock: '/stock',
};

export const BRANCHES_KEY = ['branches', 'all'] as const;

/** Every branch, closed ones too (Settings › Branches, and the branch panel on Club details). */
export function useBranches() {
  return useQuery({
    queryKey: BRANCHES_KEY,
    queryFn: async (): Promise<BranchRow[]> => {
      const { data, error } = await supabase
        .from('venues')
        .select('id, slug, name_en, name_ar, status, timezone, phone, address_en, address_ar, created_at')
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as unknown as BranchRow[];
    },
  });
}

/**
 * Settings › Branches: one card per branch. Opening one switches the operator
 * to it and lands on its Club details (`/admin/settings`), where its checklist,
 * Open and Close sit beside the details. A closed branch has nothing left to
 * change and stays a plain row; a station only opens its own branch. A
 * manager sees the branches they work at, and opens or creates none.
 */
export function BranchesAdmin() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const { staff } = useAuth();
  const manage = can(staff, 'manageBranches');
  const { setBranch, canSwitch, branchId, venues } = useVenue();
  const [creating, setCreating] = useState(false);
  const branchesQ = useBranches();
  const all = branchesQ.data ?? [];
  const branches = manage ? all : all.filter((b) => venues.some((v) => v.id === b.id));

  const openBranch = (id: string) => {
    if (canSwitch && id !== branchId) setBranch(id);
    void navigate({ to: '/admin/settings' });
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <PageHeader
        title={tr('ws.branches.list.title')}
        subtitle={tr('ws.branches.list.intro')}
        actions={
          manage ? (
            <Button kind="primary" icon="plus" onClick={() => setCreating(true)} data-testid="branches-open-new">
              {tr('ws.branches.list.openNew')}
            </Button>
          ) : undefined
        }
      />
      {branchesQ.isPending ? (
        <Skeleton lines={4} />
      ) : branchesQ.error ? (
        <ErrorText error={branchesQ.error} />
      ) : branches.length === 0 ? (
        <EmptyState title={tr('ws.branches.list.empty')} compact />
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 'var(--tp-sp-2)',
            gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))',
            maxInlineSize: 'var(--tp-measure-wide)',
          }}
        >
          {branches.map((b) => {
            const closed = b.status === 'closed';
            const reachable = !closed && (canSwitch || branchId === b.id);
            const address = locale === 'ar' ? b.address_ar ?? b.address_en : b.address_en ?? b.address_ar;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => openBranch(b.id)}
                  disabled={!reachable}
                  title={closed || reachable ? undefined : tr('ws.branches.readiness.otherBranchHint')}
                  aria-current={branchId === b.id ? 'true' : undefined}
                  data-testid={`branch-card-${b.slug}`}
                  style={{
                    inlineSize: '100%',
                    blockSize: '100%',
                    textAlign: 'start',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--tp-sp-2)',
                    padding: 'var(--tp-sp-3)',
                    borderRadius: 'var(--tp-radius-ctl)',
                    border: `1px solid ${branchId === b.id ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
                    background: 'var(--tp-surface)',
                    color: 'var(--tp-fg)',
                    cursor: reachable ? 'pointer' : 'default',
                    opacity: closed ? 0.6 : 1,
                  }}
                >
                  <span style={{ display: 'grid', gap: 'var(--tp-sp-1)', flex: 1, minInlineSize: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                      <strong>{pickName(locale, b)}</strong>
                      <StatusBadge size="sm" tone={STATUS_TONE[b.status]} label={tr(`ws.branches.status.${b.status}` as MessageKey)} />
                      {branchId === b.id && <StatusBadge size="sm" tone="info" label={tr('ws.branches.list.current')} />}
                    </span>
                    {(address || b.phone) && (
                      <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                        {address}
                        {b.phone ? <span dir="ltr">{address ? ' · ' : ''}{b.phone}</span> : null}
                      </span>
                    )}
                  </span>
                  {reachable && <ChevronForward size={18} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {creating && (
        <CreateBranchDialog
          branches={branches.filter((b) => b.status !== 'closed')}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            openBranch(id);
          }}
        />
      )}
    </div>
  );
}

/**
 * The top of a branch's Club details page: the way back to the cards and,
 * for the owner, where the branch stands, its checklist, Open and Close.
 */
export function CurrentBranchPanel() {
  const { tr } = useLocale();
  const navigate = useNavigate();
  const { staff } = useAuth();
  const manage = can(staff, 'manageBranches');
  const { branchId } = useVenue();
  const branchesQ = useBranches();
  const branch = branchesQ.data?.find((b) => b.id === branchId);
  return (
    <>
      {/* Club details is reached from a branch card only, so it leads back to the cards. */}
      <div>
        <Button kind="ghost" size="sm" onClick={() => void navigate({ to: '/admin/branches' })} data-testid="branch-details-back">
          <ChevronBack size={16} /> {tr('ws.branches.list.title')}
        </Button>
      </div>
      {!manage ? null : branchesQ.error ? <ErrorText error={branchesQ.error} /> : branch ? <BranchPanel branch={branch} /> : null}
    </>
  );
}

function BranchPanel({ branch }: { branch: BranchRow }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { setBranch, canSwitch, branchId } = useVenue();
  const name = pickName(locale, branch);
  // "Fix" and "Print table QR codes" open screens that work on the branch in
  // scope. A registered station cannot switch, so from one they only reach
  // the station's own branch; elsewhere they would edit the wrong branch.
  const canReach = canSwitch || branchId === branch.id;
  const reachHint = canReach ? undefined : tr('ws.branches.readiness.otherBranchHint');

  const readinessQ = useQuery({
    queryKey: ['branches', 'readiness', branch.id],
    enabled: branch.status !== 'closed',
    queryFn: async () => sortReadiness(await appRpc<ReadinessRow[]>('branch_readiness', { p_venue: branch.id })),
  });
  const rows = readinessQ.data ?? [];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['branches'] });
    await queryClient.invalidateQueries({ queryKey: ['venues'] });
  };

  const openM = useMutation({
    mutationFn: () => appRpc('open_branch', { p_venue: branch.id }),
    onSuccess: async () => {
      toast.ok(tr('ws.branches.readiness.opened', { name }));
      await refresh();
    },
    onError: (e) => toast.err(e),
  });
  const closeM = useMutation({
    mutationFn: () => appRpc('close_branch', { p_venue: branch.id }),
    onSuccess: async () => {
      toast.ok(tr('ws.branches.readiness.closed', { name }));
      await refresh();
      // A closed branch leaves the switcher; its details page would show another branch.
      void navigate({ to: '/admin/branches' });
    },
    // Coaching R37: BRANCH_HAS_BOOKINGS `coaching_money` (statements to approve
    // or pay, a month not drafted, lesson money to refund) has its own line;
    // any other refusal reads its shared line, as before.
    onError: (e) => toast.err(coachingErrorText(e, tr)),
  });

  const goFix = (key: ReadinessKey) => {
    if (canSwitch) setBranch(branch.id);
    void navigate({ to: FIX_ROUTE[key] });
  };

  return (
    <Panel
      title={name}
      actions={<StatusBadge tone={STATUS_TONE[branch.status]} label={tr(`ws.branches.status.${branch.status}` as MessageKey)} />}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {(branch.address_en || branch.phone) && (
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>
            {locale === 'ar' ? branch.address_ar ?? branch.address_en : branch.address_en ?? branch.address_ar}
            {branch.phone ? <span dir="ltr"> · {branch.phone}</span> : null}
          </p>
        )}
        {branch.status !== 'closed' && (
          <section style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
            <div>
              <h3 style={{ margin: 0 }}>{tr('ws.branches.readiness.title')}</h3>
              <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.branches.readiness.intro')}</p>
            </div>
            {readinessQ.isPending ? (
              <Skeleton lines={6} />
            ) : readinessQ.error ? (
              <ErrorText error={readinessQ.error} />
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }} data-testid="branch-readiness">
                {rows.map((r) => (
                  <li key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
                      <StatusBadge
                        size="sm"
                        dot
                        tone={r.ok ? 'success' : r.required ? 'danger' : 'warn'}
                        label={r.required ? tr('ws.branches.readiness.required') : tr('ws.branches.readiness.warning')}
                      />
                      <span>{tr(`ws.branches.readiness.${r.key}` as MessageKey)}</span>
                    </span>
                    {!r.ok && (
                      <Button size="sm" kind="ghost" disabled={!canReach} title={reachHint} onClick={() => goFix(r.key)}>
                        {tr('ws.branches.readiness.fix')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          {branch.status === 'preparing' && (
            <Button
              kind="primary"
              icon="check"
              busy={openM.isPending}
              disabled={!readyToOpen(rows)}
              onClick={() => openM.mutate()}
              data-testid="branch-open-to-guests"
            >
              {tr('ws.branches.readiness.openToGuests')}
            </Button>
          )}
          {branch.status === 'preparing' && (
            <Button
              kind="default"
              disabled={!canReach}
              title={reachHint}
              onClick={() => {
                if (canSwitch) setBranch(branch.id);
                void navigate({ to: '/admin/qr' });
              }}
            >
              {tr('ws.branches.readiness.printQr')}
            </Button>
          )}
          {branch.status !== 'closed' && (
            <Button
              kind="danger"
              busy={closeM.isPending}
              onClick={async () => {
                const yes = await confirm({
                  title: tr('ws.branches.readiness.close'),
                  body: tr('ws.branches.readiness.closeConfirm', { name }),
                  kind: 'danger',
                });
                if (yes) closeM.mutate();
              }}
            >
              {tr('ws.branches.readiness.close')}
            </Button>
          )}
        </div>
        {/* A refusal to close stays beside the button: the coaching one names two screens to visit. */}
        <ErrorText error={closeM.error} message={closeM.error ? coachingErrorText(closeM.error, tr) : null} />
      </div>
    </Panel>
  );
}

/**
 * Open a new branch, as a stepped wizard (Sait, 2026-10-22): its names and
 * short name, the branch whose setup it copies, its contact details, then
 * Review, where app.create_branch runs.
 */
function CreateBranchDialog({
  branches,
  onClose,
  onCreated,
}: {
  branches: BranchRow[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const firstOpen = branches.find((b) => b.status === 'open') ?? branches[0];
  const [draft, setDraft] = useState<NewBranchDraft>({
    sourceVenueId: firstOpen?.id ?? '',
    nameEn: '',
    nameAr: '',
    slug: '',
    phone: '',
    addressEn: '',
    addressAr: '',
    timezone: firstOpen?.timezone ?? '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const problems = draftProblems(draft);
  const set = (patch: Partial<NewBranchDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const createM = useMutation({
    mutationFn: () =>
      appRpc<{ venue_id: string; counts: Record<string, number> }>('create_branch', createBranchArgs(draft)),
    onSuccess: async (res) => {
      toast.ok(tr('ws.branches.create.created', { name: locale === 'ar' ? draft.nameAr : draft.nameEn }));
      toast.info(
        tr('ws.branches.create.copied', {
          courts: String(res.counts.courts ?? 0),
          items: String(res.counts.menu_items ?? 0),
          tables: String(res.counts.cafe_tables ?? 0),
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      await queryClient.invalidateQueries({ queryKey: ['venues'] });
      onCreated(res.venue_id);
    },
    onError: (e) => toast.err(e),
  });

  const input = (
    value: string,
    onChange: (v: string) => void,
    opts: { dir?: 'ltr' | 'rtl'; lang?: string; invalid?: boolean; testId?: string } = {},
  ) => (
    <input
      style={inputStyle}
      dir={opts.dir ?? 'ltr'}
      lang={opts.lang}
      value={value}
      aria-invalid={opts.invalid || undefined}
      data-testid={opts.testId}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  const C = 'ws.branches.create';
  const source = branches.find((b) => b.id === draft.sourceVenueId);
  const shownName = (locale === 'ar' ? draft.nameAr : draft.nameEn).trim() || (draft.nameEn || draft.nameAr).trim();
  const both = [draft.nameEn.trim(), draft.nameAr.trim()].filter(Boolean).join(' · ');
  const pair = { display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' } as const;

  return (
    <StepWizard
      title={tr(`${C}.title`)}
      lead={tr(`${C}.lead`)}
      testId="branch-create"
      onClose={onClose}
      busy={createM.isPending}
      submitLabel={createM.isPending ? tr(`${C}.creating`) : tr(`${C}.submit`)}
      onSubmit={() => createM.mutate()}
      steps={[
        {
          key: 'name',
          label: tr(`${C}.steps.name`),
          note: shownName || null,
          problems: [
            ...(problems.includes('nameEn') || problems.includes('nameAr') ? [tr(`${C}.namesNeeded`)] : []),
            ...(problems.includes('slug') ? [tr(`${C}.slugInvalid`)] : []),
          ],
          content: (
            <>
              <BilingualFields
                labelEn={tr(`${C}.nameEn`)}
                labelAr={tr(`${C}.nameAr`)}
                en={draft.nameEn}
                ar={draft.nameAr}
                onEn={(v) => set({ nameEn: v, ...(slugTouched ? {} : { slug: suggestSlug(v) }) })}
                onAr={(v) => set({ nameAr: v })}
                maxLength={80}
              />
              <Field label={tr(`${C}.slug`)} hint={tr(`${C}.slugHint`)} required>
                {input(
                  draft.slug,
                  (v) => {
                    setSlugTouched(true);
                    set({ slug: v.toLowerCase() });
                  },
                  { invalid: problems.includes('slug') && draft.slug !== '', testId: 'branch-slug' },
                )}
              </Field>
            </>
          ),
        },
        {
          key: 'copy',
          label: tr(`${C}.steps.copy`),
          note: source ? pickName(locale, source) : null,
          problems: problems.includes('source') ? [tr(`${C}.pickSource`)] : [],
          content: (
            <>
              <Field label={tr(`${C}.copyFrom`)} group required>
                <WizardChoices label={tr(`${C}.copyFrom`)}>
                {branches.map((b) => (
                  <WizardChoice
                    key={b.id}
                    on={b.id === draft.sourceVenueId}
                    title={<bdi>{pickName(locale, b)}</bdi>}
                    body={tr(`ws.branches.status.${b.status}` as MessageKey)}
                    onPick={() => set({ sourceVenueId: b.id })}
                    testId={`branch-create.source.${b.slug}`}
                  />
                ))}
                </WizardChoices>
              </Field>
              <WizardNote>{tr(`${C}.copiedNote`)}</WizardNote>
            </>
          ),
        },
        {
          key: 'contact',
          label: tr(`${C}.steps.contact`),
          note: draft.phone.trim() || tr('ws.kit.common.optional'),
          problems: problems.includes('phone') ? [tr(`${C}.phoneInvalid`)] : [],
          content: (
            <>
              <div style={pair}>
                <Field label={tr(`${C}.phone`)} optional>
                  {input(draft.phone, (v) => set({ phone: v }), { invalid: problems.includes('phone') })}
                </Field>
                <Field label={tr(`${C}.timezone`)} optional>
                  {input(draft.timezone, (v) => set({ timezone: v }))}
                </Field>
              </div>
              <BilingualFields
                labelEn={tr(`${C}.addressEn`)}
                labelAr={tr(`${C}.addressAr`)}
                en={draft.addressEn}
                ar={draft.addressAr}
                onEn={(v) => set({ addressEn: v })}
                onAr={(v) => set({ addressAr: v })}
              />
            </>
          ),
        },
      ]}
      review={(goTo) => (
        <ReviewList
          goTo={goTo}
          busy={createM.isPending}
          rows={[
            { label: tr(`${C}.steps.name`), value: <bdi>{both}</bdi>, step: 'name' },
            { label: tr(`${C}.linkName`), value: <bdi dir="ltr">{draft.slug.trim()}</bdi>, step: 'name' },
            { label: tr(`${C}.copiedFrom`), value: source ? <bdi>{pickName(locale, source)}</bdi> : '—', step: 'copy' },
            { label: tr(`${C}.phone`), value: draft.phone.trim() ? <bdi dir="ltr">{draft.phone.trim()}</bdi> : '—', step: 'contact' },
            { label: tr(`${C}.timezone`), value: draft.timezone.trim() ? <bdi dir="ltr">{draft.timezone.trim()}</bdi> : '—', step: 'contact' },
          ]}
        />
      )}
    />
  );
}
