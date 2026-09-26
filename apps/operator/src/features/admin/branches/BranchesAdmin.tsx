/**
 * Setup › Branches (multi-venue slice 4, plan MV1): every Touch location, the
 * owner's "Open a new branch", and the checklist a new branch works through
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
import { useLocale, pickName } from '../../../lib/i18n';
import { useVenue, type VenueStatus } from '../../../lib/venue';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Modal, Select, Skeleton, inputStyle } from '../../../components/ui';
import { EmptyState, PageHeader, Panel, StatusBadge, type Tone } from '../../../components/kit';
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

export function BranchesAdmin() {
  const { tr, locale } = useLocale();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const branchesQ = useQuery({
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

  const branches = branchesQ.data ?? [];
  const current = branches.find((b) => b.id === selected) ?? branches.find((b) => b.status === 'preparing') ?? null;

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <PageHeader
        title={tr('ws.branches.list.title')}
        subtitle={tr('ws.branches.list.intro')}
        actions={
          <Button kind="primary" icon="plus" onClick={() => setCreating(true)} data-testid="branches-open-new">
            {tr('ws.branches.list.openNew')}
          </Button>
        }
      />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'minmax(16rem, 1fr) minmax(20rem, 1.4fr)', alignItems: 'start' }}>
        <Panel title={tr('ws.branches.list.title')}>
          {branchesQ.isPending ? (
            <Skeleton lines={4} />
          ) : branchesQ.error ? (
            <ErrorText error={branchesQ.error} />
          ) : branches.length === 0 ? (
            <EmptyState title={tr('ws.branches.list.empty')} compact />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
              {branches.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(b.id)}
                    aria-pressed={current?.id === b.id}
                    style={{
                      inlineSize: '100%',
                      textAlign: 'start',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 'var(--tp-sp-2)',
                      padding: 'var(--tp-sp-2)',
                      borderRadius: 'var(--tp-radius-ctl)',
                      border: '1px solid var(--tp-border)',
                      background: current?.id === b.id ? 'var(--tp-surface-2)' : 'var(--tp-surface)',
                      color: 'var(--tp-fg)',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ display: 'grid' }}>
                      <strong>{pickName(locale, b)}</strong>
                      <span dir="ltr" style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{b.slug}</span>
                    </span>
                    <StatusBadge size="sm" tone={STATUS_TONE[b.status]} label={tr(`ws.branches.status.${b.status}` as MessageKey)} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {current && <BranchPanel branch={current} />}
      </div>
      {creating && (
        <CreateBranchDialog
          branches={branches.filter((b) => b.status !== 'closed')}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelected(id);
          }}
        />
      )}
    </div>
  );
}

function BranchPanel({ branch }: { branch: BranchRow }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { setBranch, canSwitch } = useVenue();
  const name = pickName(locale, branch);

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
    },
    onError: (e) => toast.err(e),
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
                      <Button size="sm" kind="ghost" onClick={() => goFix(r.key)}>
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
          {branch.status !== 'open' && (
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
      </div>
    </Panel>
  );
}

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

  return (
    <Modal
      title={tr('ws.branches.create.title')}
      subtitle={tr('ws.branches.create.intro')}
      onClose={onClose}
      dismissible={!createM.isPending}
      wide
      footer={(close) => (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end' }}>
          <Button onClick={close} disabled={createM.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            busy={createM.isPending}
            disabled={problems.length > 0}
            onClick={() => createM.mutate()}
            data-testid="branch-create-submit"
          >
            {createM.isPending ? tr('ws.branches.create.creating') : tr('ws.branches.create.submit')}
          </Button>
        </div>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
        <Field label={tr('ws.branches.create.nameEn')} required>
          {input(draft.nameEn, (v) => set({ nameEn: v, ...(slugTouched ? {} : { slug: suggestSlug(v) }) }), {
            invalid: problems.includes('nameEn') && draft.nameEn !== '',
            testId: 'branch-name-en',
          })}
        </Field>
        <Field label={tr('ws.branches.create.nameAr')} required>
          {input(draft.nameAr, (v) => set({ nameAr: v }), { dir: 'rtl', lang: 'ar', testId: 'branch-name-ar' })}
        </Field>
        <Field label={tr('ws.branches.create.slug')} hint={tr('ws.branches.create.slugHint')} required>
          {input(
            draft.slug,
            (v) => {
              setSlugTouched(true);
              set({ slug: v.toLowerCase() });
            },
            { invalid: problems.includes('slug') && draft.slug !== '', testId: 'branch-slug' },
          )}
        </Field>
        <Field label={tr('ws.branches.create.copyFrom')} required>
          <Select<string>
            value={draft.sourceVenueId}
            onChange={(v) => set({ sourceVenueId: v })}
            options={branches.map((b) => ({ value: b.id, label: pickName(locale, b) }))}
            aria-label={tr('ws.branches.create.copyFrom')}
          />
        </Field>
        <Field label={tr('ws.branches.create.phone')} optional>
          {input(draft.phone, (v) => set({ phone: v }), { invalid: problems.includes('phone') })}
        </Field>
        <Field label={tr('ws.branches.create.timezone')} optional>
          {input(draft.timezone, (v) => set({ timezone: v }))}
        </Field>
        <Field label={tr('ws.branches.create.addressEn')} optional>
          {input(draft.addressEn, (v) => set({ addressEn: v }))}
        </Field>
        <Field label={tr('ws.branches.create.addressAr')} optional>
          {input(draft.addressAr, (v) => set({ addressAr: v }), { dir: 'rtl', lang: 'ar' })}
        </Field>
      </div>
    </Modal>
  );
}
