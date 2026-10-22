/**
 * Settings › Branches (multi-venue slice 4, plan MV1; merged with Club details
 * 2026-10-18; redesigned with Sait 2026-10-22): every Touch location as a card
 * in its own colour, the owner's "Open a new branch", and, on the branch's
 * Branch details page, the checklist a new branch works through before "Open
 * to guests".
 *
 * - Create copies the setup of a branch the owner picks (app.create_branch,
 *   0223) and lands the branch in Preparing: guests cannot see it.
 * - The checklist is app.branch_readiness. Each row links to the screen that
 *   fixes it; those screens work on the branch in the rail switcher, so the
 *   link switches to this branch first.
 * - Open to guests (app.open_branch) is refused with BRANCH_NOT_READY until
 *   every required row is done; Close (app.close_branch) never deletes.
 * - A card counts the branch's courts and café tables (app.branch_counts,
 *   0361), whatever branch the rail is on.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { countPhrase, formatNumber, type MessageKey } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { can, canAccess, useAuth } from '../../../lib/auth';
import { useLocale, pickName } from '../../../lib/i18n';
import { useVenue, type VenueStatus } from '../../../lib/venue';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Skeleton, inputStyle } from '../../../components/ui';
import { EmptyState, PageHeader, Panel, SegmentedControl, StatusBadge, type Tone } from '../../../components/kit';
import { ReviewList, StepWizard, WizardChoice, WizardChoices, WizardNote } from '../../../components/StepWizard';
import { BilingualFields } from '../../../components/inputs';
import { ChevronBack, ChevronForward, Icon } from '../../../components/icons';
import { coachingErrorText } from '../../coaching/lessonLogic';
import {
  branchTone,
  checklistOrder,
  createBranchArgs,
  draftProblems,
  readyToOpen,
  requiredLeft,
  suggestSlug,
  type BranchFilter,
  type NewBranchDraft,
  type ReadinessKey,
  type ReadinessRow,
} from './branchesLogic';
import { TimezonePicker, useTimezoneSummary } from './TimezonePicker';

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

// Closed is red (Sait, 2026-10-22).
const STATUS_TONE: Record<VenueStatus, Tone> = { preparing: 'warn', open: 'success', closed: 'danger' };

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

/** Branch details' "More for this branch": the pages that work on the branch in scope. */
const MORE_LINKS = [
  { to: '/admin/settings/day', labelKey: 'businessDay' },
  { to: '/admin/settings/booking', labelKey: 'bookingRules' },
  { to: '/admin/hours', labelKey: 'openingHours' },
  { to: '/admin/rates', labelKey: 'rates' },
  { to: '/admin/settings/stations', labelKey: 'stations' },
  { to: '/admin/settings/analytics', labelKey: 'analyticsSettings' },
] as const;

export const BRANCHES_KEY = ['branches', 'all'] as const;

/** Every branch, closed ones too (Settings › Branches, and the branch panel on Branch details). */
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

/** Each branch's active courts and café tables (app.branch_counts, 0361). */
function useBranchCounts() {
  return useQuery({
    queryKey: ['branches', 'counts'],
    queryFn: async () => {
      const rows = await appRpc<{ venue_id: string; courts: number; tables: number }[]>('branch_counts', {});
      return new Map(rows.map((r) => [r.venue_id, r]));
    },
  });
}

function addressOf(locale: string, b: BranchRow): string | null {
  return locale === 'ar' ? b.address_ar ?? b.address_en : b.address_en ?? b.address_ar;
}

/**
 * Settings › Branches: one card per open or preparing branch, in its colour.
 * Opening one switches the operator to it and lands on its Branch details
 * (`/admin/settings`), where its checklist, Open and Close sit beside the
 * details. A closed branch has nothing left to change and is a plain row
 * under the cards; a station only opens its own branch. A manager sees the
 * branches they work at, and opens or creates none.
 */
export function BranchesAdmin() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const { staff } = useAuth();
  const manage = can(staff, 'manageBranches');
  const { setBranch, canSwitch, branchId, venues } = useVenue();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<BranchFilter>('all');
  const branchesQ = useBranches();
  const countsQ = useBranchCounts();
  const all = branchesQ.data ?? [];
  const branches = manage ? all : all.filter((b) => venues.some((v) => v.id === b.id));
  const live = branches.filter((b) => b.status !== 'closed');
  const closed = branches.filter((b) => b.status === 'closed');
  const shown = live.filter((b) => filter === 'all' || b.status === filter);
  const showClosed = (filter === 'all' || filter === 'closed') && closed.length > 0;
  const current = all.find((b) => b.id === branchId);
  const count: Record<BranchFilter, number> = {
    all: branches.length,
    open: branches.filter((b) => b.status === 'open').length,
    preparing: branches.filter((b) => b.status === 'preparing').length,
    closed: closed.length,
  };
  const L = 'ws.branches.list';

  const openBranch = (id: string) => {
    if (canSwitch && id !== branchId) setBranch(id);
    void navigate({ to: '/admin/settings' });
  };

  const figure = (n: number | undefined) => (n === undefined ? '–' : formatNumber(n, locale));

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-5)', maxInlineSize: 'var(--tp-measure-wide)' }}>
      <PageHeader
        title={tr(`${L}.title`)}
        subtitle={tr(`${L}.intro`)}
        style={{ marginBlockEnd: 0 }}
        actions={
          manage ? (
            <Button kind="primary" icon="plus" onClick={() => setCreating(true)} data-testid="branches-open-new">
              {tr(`${L}.openNew`)}
            </Button>
          ) : undefined
        }
      />
      {branchesQ.isPending ? (
        <Skeleton lines={4} />
      ) : branchesQ.error ? (
        <ErrorText error={branchesQ.error} />
      ) : branches.length === 0 ? (
        <EmptyState title={tr(`${L}.empty`)} compact />
      ) : (
        <>
          <div className="tp-branch-filter" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-3)' }}>
            <SegmentedControl
              aria-label={tr(`${L}.show`)}
              value={filter}
              onChange={setFilter}
              options={(['all', 'open', 'preparing', 'closed'] as const).map((f) => ({
                value: f,
                testId: `branches-filter-${f}`,
                label: (
                  <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)' }}>
                    {tr(`${L}.filter.${f}`)}
                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(count[f], locale)}</span>
                  </span>
                ),
              }))}
            />
            {current && (
              <span style={{ fontSize: 'var(--tp-fs-md)' }}>
                {tr(`${L}.workingIn`)} <strong><bdi>{pickName(locale, current)}</bdi></strong>
              </span>
            )}
          </div>

          {shown.length > 0 && (
            <ul className="tp-branch-grid">
              {shown.map((b) => {
                const reachable = canSwitch || branchId === b.id;
                const here = branchId === b.id;
                const address = addressOf(locale, b);
                const n = countsQ.data?.get(b.id);
                return (
                  <li key={b.id} style={{ display: 'flex' }}>
                    <button
                      type="button"
                      className="tp-branch-card tp-tone"
                      data-tone={branchTone(all.findIndex((x) => x.id === b.id))}
                      onClick={() => openBranch(b.id)}
                      disabled={!reachable}
                      title={reachable ? undefined : tr('ws.branches.readiness.otherBranchHint')}
                      aria-current={here ? 'true' : undefined}
                      data-testid={`branch-card-${b.slug}`}
                    >
                      <span className="tp-branch-band">
                        <strong><bdi>{pickName(locale, b)}</bdi></strong>
                        <StatusBadge size="sm" tone={STATUS_TONE[b.status]} label={tr(`ws.branches.status.${b.status}` as MessageKey)} />
                      </span>
                      <span className="tp-branch-body">
                        <span className="tp-strip-tiles">
                          <span className="tp-strip-tile">
                            <span className="tp-strip-tile-band">{tr(`${L}.courtsLabel`)}</span>
                            <span className="tp-strip-tile-value">{figure(n?.courts)}</span>
                          </span>
                          <span className="tp-strip-tile">
                            <span className="tp-strip-tile-band">{tr(`${L}.tablesLabel`)}</span>
                            <span className="tp-strip-tile-value">{figure(n?.tables)}</span>
                          </span>
                        </span>
                        {(address || b.phone) && (
                          <span className="tp-branch-lines">
                            {address && (
                              <span>
                                <Icon name="pin" size={16} />
                                <bdi>{address}</bdi>
                              </span>
                            )}
                            {b.phone && (
                              <span>
                                <Icon name="phone" size={16} />
                                <span dir="ltr">{b.phone}</span>
                              </span>
                            )}
                          </span>
                        )}
                        <span className="tp-branch-foot">
                          <span>{tr(`${L}.details`)}</span>
                          {here ? <span className="tp-branch-now">{tr(`${L}.current`)}</span> : reachable ? <ChevronForward size={18} /> : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {shown.length === 0 && !showClosed && <EmptyState title={tr('ws.kit.empty.filtered')} compact />}

          {showClosed && (
            <section style={{ display: 'grid', gap: 'var(--tp-sp-2-5)' }} data-testid="branches-closed">
              <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
                <h2 style={{ margin: 0, fontSize: 'var(--tp-fs-lg)', fontWeight: 700 }}>{tr(`${L}.closedTitle`)}</h2>
                <p style={{ margin: 0, fontSize: 'var(--tp-fs-md)' }}>{tr(`${L}.closedIntro`)}</p>
              </div>
              <ul className="tp-branch-closed">
                {closed.map((b) => {
                  const address = addressOf(locale, b);
                  return (
                    <li key={b.id} data-testid={`branch-card-${b.slug}`}>
                      <strong><bdi>{pickName(locale, b)}</bdi></strong>
                      <StatusBadge size="sm" dot={false} tone="danger" label={tr('ws.branches.status.closed')} />
                      {(address || b.phone) && (
                        <span style={{ marginInlineStart: 'auto', fontSize: 'var(--tp-fs-md)' }}>
                          {address && <bdi>{address}</bdi>}
                          {b.phone ? <span dir="ltr">{address ? ' · ' : ''}{b.phone}</span> : null}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
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
 * A branch's Branch details page (`/admin/settings`), reached from its card:
 * the way back, the branch in its colour with where it stands, and for the
 * owner the checklist, Open to guests and Close beside the details passed in
 * (the venue form, what was fixed at setup, the tax groups).
 */
export function BranchDetails({ children }: { children: ReactNode }) {
  const { tr } = useLocale();
  const navigate = useNavigate();
  const { branchId } = useVenue();
  const branchesQ = useBranches();
  const all = branchesQ.data ?? [];
  const place = all.findIndex((b) => b.id === branchId);
  const branch = place >= 0 ? all[place] : undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxInlineSize: 'var(--tp-measure-wide)' }}>
      {/* Branch details is reached from a branch card only, so it leads back to the cards. */}
      <div>
        <Button kind="ghost" size="sm" onClick={() => void navigate({ to: '/admin/branches' })} data-testid="branch-details-back">
          <ChevronBack size={16} /> {tr('ws.branches.list.title')}
        </Button>
      </div>
      {branch ? (
        <BranchDetailsBody branch={branch} tone={branchTone(place)}>
          {children}
        </BranchDetailsBody>
      ) : (
        // The details still show while the branch row is loading or could not be read.
        <>
          {branchesQ.error ? <ErrorText error={branchesQ.error} /> : branchesQ.isPending ? <Skeleton lines={3} /> : null}
          {children}
        </>
      )}
    </div>
  );
}

function BranchDetailsBody({ branch, tone, children }: { branch: BranchRow; tone: string; children: ReactNode }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { staff } = useAuth();
  const manage = can(staff, 'manageBranches');
  const { setBranch, canSwitch, branchId } = useVenue();
  const name = pickName(locale, branch);
  const preparing = branch.status === 'preparing';
  const R = 'ws.branches.readiness';
  // "Fix" and "Print table QR codes" open screens that work on the branch in
  // scope. A registered station cannot switch, so from one they only reach
  // the station's own branch; elsewhere they would edit the wrong branch.
  const canReach = canSwitch || branchId === branch.id;
  const reachHint = canReach ? undefined : tr(`${R}.otherBranchHint`);

  const readinessQ = useQuery({
    queryKey: ['branches', 'readiness', branch.id],
    enabled: manage && preparing,
    queryFn: async () => checklistOrder(await appRpc<ReadinessRow[]>('branch_readiness', { p_venue: branch.id })),
  });
  const rows = readinessQ.data ?? [];
  const done = rows.filter((r) => r.ok).length;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['branches'] });
    await queryClient.invalidateQueries({ queryKey: ['venues'] });
  };

  const openM = useMutation({
    mutationFn: () => appRpc('open_branch', { p_venue: branch.id }),
    onSuccess: async () => {
      toast.ok(tr(`${R}.opened`, { name }));
      await refresh();
    },
    onError: (e) => toast.err(e),
  });
  const closeM = useMutation({
    mutationFn: () => appRpc('close_branch', { p_venue: branch.id }),
    onSuccess: async () => {
      toast.ok(tr(`${R}.closed`, { name }));
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

  const address = addressOf(locale, branch);
  const contact: ReactNode[] = [];
  if (address) contact.push(<bdi key="a">{address}</bdi>);
  if (branch.phone) contact.push(<span key="p" dir="ltr">{branch.phone}</span>);
  contact.push(<span key="t" dir="ltr">{branch.timezone}</span>);

  const links = MORE_LINKS.filter((l) => canAccess(staff, l.to));
  const checklist = manage && preparing;

  return (
    <>
      <section className="tp-branch-hero tp-tone" data-tone={tone} data-testid="branch-hero">
        <div className="tp-branch-hero-band">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-1-5)', minInlineSize: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.625rem' }}>
              <h1>
                <bdi>{name}</bdi>
              </h1>
              <StatusBadge tone={STATUS_TONE[branch.status]} label={tr(`ws.branches.status.${branch.status}` as MessageKey)} />
            </div>
            <div style={{ fontSize: 'var(--tp-fs-md)' }}>
              {contact.flatMap((c, i) => (i === 0 ? [c] : [' · ', c]))}
            </div>
          </div>
          {checklist && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)' }}>
              <Button
                disabled={!canReach}
                title={reachHint}
                onClick={() => {
                  if (canSwitch) setBranch(branch.id);
                  void navigate({ to: '/admin/qr' });
                }}
              >
                {tr(`${R}.printQr`)}
              </Button>
              <Button
                className="tp-open-guests"
                icon="check"
                busy={openM.isPending}
                disabled={!readyToOpen(rows)}
                onClick={() => openM.mutate()}
                data-testid="branch-open-to-guests"
              >
                {tr(`${R}.openToGuests`)}
              </Button>
            </div>
          )}
        </div>
        {checklist && (
          <div className="tp-branch-hero-note">
            {tr(`${R}.intro`)} {readinessQ.data && <strong>{countPhrase(`${R}.requiredLeft`, requiredLeft(rows), locale)}</strong>}
          </div>
        )}
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 32.5rem', minInlineSize: 0, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {checklist && (
            <Panel
              title={tr(`${R}.title`)}
              actions={
                readinessQ.data ? (
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--tp-panel-head-fg)' }}>
                    {tr(`${R}.progress`, { done: formatNumber(done, locale), total: formatNumber(rows.length, locale) })}
                  </span>
                ) : undefined
              }
            >
              {readinessQ.isPending ? (
                <Skeleton lines={6} />
              ) : readinessQ.error ? (
                <ErrorText error={readinessQ.error} />
              ) : (
                <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
                  <div className="tp-ready-bar" aria-hidden="true">
                    <i style={{ inlineSize: `${rows.length ? Math.round((done / rows.length) * 100) : 0}%` }} />
                  </div>
                  <ul className="tp-ready-list" data-testid="branch-readiness">
                    {rows.map((r) => {
                      const state = r.ok ? 'ok' : r.required ? 'required' : 'recommended';
                      return (
                        <li key={r.key}>
                          <span className="tp-ready-mark" data-state={state} aria-hidden="true">
                            {r.ok && <Icon name="check" size={14} />}
                          </span>
                          <span style={{ fontWeight: r.ok ? 400 : 600 }}>{tr(`${R}.${r.key}` as MessageKey)}</span>
                          <span className="tp-ready-tag" data-state={state}>
                            {r.required ? tr(`${R}.required`) : tr(`${R}.warning`)}
                          </span>
                          <span style={{ marginInlineStart: 'auto' }} />
                          {r.ok ? (
                            <span className="tp-ready-done">{tr(`${R}.done`)}</span>
                          ) : (
                            <button type="button" className="tp-ready-fix" disabled={!canReach} title={reachHint} onClick={() => goFix(r.key)}>
                              {tr(`${R}.fix`)}
                              <ChevronForward size={14} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </Panel>
          )}
          {children}
        </div>

        <aside style={{ flex: '1 1 17.5rem', minInlineSize: 0, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {links.length > 0 && (
            <Panel title={tr(`${R}.more`)} padded={false}>
              <ul style={{ listStyle: 'none', margin: 0, padding: 'var(--tp-sp-2)', display: 'flex', flexDirection: 'column' }}>
                {links.map((l) => (
                  <li key={l.to}>
                    <Link to={l.to} className="tp-branch-link">
                      <span>{tr(`ws.shell.nav.${l.labelKey}`)}</span>
                      <ChevronForward size={16} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {manage && branch.status !== 'closed' && (
            <section className="tp-close-box" data-testid="branch-close-box">
              <h2>{tr(`${R}.close`)}</h2>
              <p>{tr(`${R}.closeBody`)}</p>
              <Button
                kind="danger"
                busy={closeM.isPending}
                onClick={async () => {
                  const yes = await confirm({
                    title: tr(`${R}.close`),
                    body: tr(`${R}.closeConfirm`, { name }),
                    kind: 'danger',
                  });
                  if (yes) closeM.mutate();
                }}
              >
                {tr(`${R}.close`)}
              </Button>
              {/* A refusal to close stays beside the button: the coaching one names two screens to visit. */}
              <ErrorText error={closeM.error} message={closeM.error ? coachingErrorText(closeM.error, tr) : null} />
            </section>
          )}
        </aside>
      </div>
    </>
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
  // The timezone follows the branch being copied until the owner picks one.
  const [tzTouched, setTzTouched] = useState(false);
  const tzSummary = useTimezoneSummary(draft.timezone);
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
                    onPick={() => set({ sourceVenueId: b.id, ...(tzTouched ? {} : { timezone: b.timezone }) })}
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
          note: draft.timezone ? tzSummary : draft.phone.trim() || tr('ws.kit.common.optional'),
          problems: problems.includes('phone') ? [tr(`${C}.phoneInvalid`)] : [],
          content: (
            <>
              <div style={pair}>
                <Field label={tr(`${C}.phone`)} optional>
                  {input(draft.phone, (v) => set({ phone: v }), { invalid: problems.includes('phone') })}
                </Field>
                <Field label={tr(`${C}.timezone`)} hint={tr(`${C}.timezoneHint`)} group>
                  <TimezonePicker
                    value={draft.timezone}
                    onChange={(v) => {
                      setTzTouched(true);
                      set({ timezone: v });
                    }}
                  />
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
