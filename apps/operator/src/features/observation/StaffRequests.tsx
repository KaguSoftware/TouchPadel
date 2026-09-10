/**
 * Staff requests (/observation/requests) — the owner's confirmation queue.
 *
 * The screen exists because leave, a shift swap, a wage advance and a record
 * correction are the only things in this system that ORIGINATE WITH A PERSON
 * and stop until the owner answers. Everything else Management shows is a
 * reading of something that already happened.
 *
 * Three rules the UI holds to, all of them enforced again on the server
 * (migration 0072) — this screen is the courtesy, not the wall:
 *
 *   * A decision is final. There is no un-approve control, because there is no
 *     un-approve: the person has already been told. A wrong approval is
 *     answered with a new request so the trail keeps both.
 *   * A refusal must say why. Approve takes an optional note; decline will not
 *     submit without a reason, because the requester reads it and "no" with no
 *     reason is the one answer nobody can act on.
 *   * Nobody decides their own request. An owner's own row renders with no
 *     buttons rather than with disabled ones — the row already says who asked,
 *     so a greyed control would carry no information the row lacks.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatIQD } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  PageHeader,
  ResultCount,
  SegmentedControl,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  type Column,
} from '../../components/kit';
import {
  REQUESTS_QUERY_KEY,
  canDecide,
  statusTone,
  type StaffRequestKind,
  type StaffRequestRow,
  type StaffRequestStatus,
  type StaffRequestsPage,
} from './requestTypes';

type Filter = 'pending' | 'decided' | 'all';

/** The server takes one status; 'decided' is "answered", which is not one. */
const STATUS_ARG: Record<Filter, string | null> = { pending: 'pending', decided: null, all: null };

export function StaffRequestsScreen() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('pending');
  const [deciding, setDeciding] = useState<{ row: StaffRequestRow; approve: boolean } | null>(null);

  const q = useQuery({
    queryKey: [...REQUESTS_QUERY_KEY, filter],
    queryFn: () =>
      appRpc<StaffRequestsPage>('staff_requests_page', {
        p_status: STATUS_ARG[filter],
        p_limit: 200,
        p_offset: 0,
      }),
    refetchInterval: 60_000,
  });

  // 'decided' has no server status of its own: it is every row that is not
  // pending, filtered here rather than by four separate round trips.
  const rows = useMemo(() => {
    const all = q.data?.requests ?? [];
    return filter === 'decided' ? all.filter((r) => r.status !== 'pending') : all;
  }, [q.data, filter]);

  const decide = useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note: string }) =>
      appRpc('decide_staff_request', { p_id: id, p_approve: approve, p_note: note || null }),
    onSuccess: (_d, vars) => {
      toast.ok(tr(vars.approve ? 'ws.owner.requests.approve' : 'ws.owner.requests.decline'));
      setDeciding(null);
      void qc.invalidateQueries({ queryKey: REQUESTS_QUERY_KEY });
    },
  });

  const detail = (r: StaffRequestRow) => {
    if (r.kind === 'advance') return r.amount_iqd == null ? '—' : formatIQD(r.amount_iqd, locale);
    if (!r.from_date) return '—';
    return r.to_date && r.to_date !== r.from_date
      ? tr('ws.owner.requests.dates', {
          from: formatDate(new Date(r.from_date), locale),
          to: formatDate(new Date(r.to_date), locale),
        })
      : tr('ws.owner.requests.oneDay', { from: formatDate(new Date(r.from_date), locale) });
  };

  const columns: Column<StaffRequestRow>[] = [
    {
      key: 'staff',
      header: tr('ws.owner.requests.cols.staff'),
      render: (r) => r.staff_name,
      truncateTitle: (r) => r.staff_name,
    },
    {
      key: 'kind',
      header: tr('ws.owner.requests.cols.kind'),
      render: (r) => tr(`ws.owner.requests.kinds.${r.kind as StaffRequestKind}`),
      truncateTitle: (r) => tr(`ws.owner.requests.kinds.${r.kind as StaffRequestKind}`),
    },
    {
      key: 'detail',
      header: tr('ws.owner.requests.cols.detail'),
      render: (r) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <span dir={r.kind === 'advance' ? 'ltr' : undefined}>{detail(r)}</span>
          {r.note && (
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
              {r.note}
            </span>
          )}
        </span>
      ),
      truncateTitle: (r) => `${detail(r)}${r.note ? ` — ${r.note}` : ''}`,
    },
    {
      key: 'submitted',
      header: tr('ws.owner.requests.cols.submitted'),
      render: (r) => formatDate(new Date(r.created_at), locale),
      truncateTitle: (r) => formatDate(new Date(r.created_at), locale),
    },
    {
      key: 'status',
      header: tr('ws.owner.requests.cols.status'),
      render: (r) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <StatusBadge
            tone={statusTone(r.status)}
            label={tr(`ws.owner.requests.statuses.${r.status as StaffRequestStatus}`)}
          />
          {r.decided_by_name && (
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
              {tr('ws.owner.requests.decidedBy', { name: r.decided_by_name })}
            </span>
          )}
          {r.decision_note && (
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
              {r.decision_note}
            </span>
          )}
        </span>
      ),
      truncateTitle: (r) => tr(`ws.owner.requests.statuses.${r.status as StaffRequestStatus}`),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (r) =>
        // A settled row, or the viewer's own, gets no controls at all rather
        // than disabled ones that cannot say why they are dead (4.3).
        canDecide(r, staff?.id) ? (
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)' }}>
            <Button size="sm" onClick={() => setDeciding({ row: r, approve: true })}>
              {tr('ws.owner.requests.approve')}
            </Button>
            <Button size="sm" kind="ghost" onClick={() => setDeciding({ row: r, approve: false })}>
              {tr('ws.owner.requests.decline')}
            </Button>
          </span>
        ) : null,
      truncateTitle: () => '',
    },
  ];

  const status = asyncStatus(q, () => rows.length === 0);

  return (
    <div>
      <PageHeader title={tr('ws.owner.requests.title')} subtitle={tr('ws.owner.requests.lead')} />
      <Toolbar end={<ResultCount shown={rows.length} total={q.data?.total ?? rows.length} />}>
        <SegmentedControl<Filter>
          value={filter}
          onChange={setFilter}
          aria-label={tr('ws.owner.requests.title')}
          options={[
            { value: 'pending', label: tr('ws.owner.requests.filter.pending') },
            { value: 'decided', label: tr('ws.owner.requests.filter.decided') },
            { value: 'all', label: tr('ws.owner.requests.filter.all') },
          ]}
        />
      </Toolbar>

      <AsyncStateWrapper
        status={status}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={6} />}
        emptyContent={
          <EmptyState
            icon="check"
            title={tr(
              filter === 'pending'
                ? 'ws.owner.requests.emptyPendingTitle'
                : 'ws.owner.requests.emptyTitle',
            )}
            body={tr(
              filter === 'pending'
                ? 'ws.owner.requests.emptyPendingBody'
                : 'ws.owner.requests.emptyBody',
            )}
          />
        }
      >
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
      </AsyncStateWrapper>

      {deciding && (
        <DecisionDialog
          row={deciding.row}
          approve={deciding.approve}
          busy={decide.isPending}
          error={decide.error}
          onCancel={() => {
            decide.reset();
            setDeciding(null);
          }}
          onSubmit={(note) =>
            decide.mutate({ id: deciding.row.id, approve: deciding.approve, note })
          }
        />
      )}
    </div>
  );
}

/**
 * Approve or decline, with the note the decision carries. Declining requires
 * a reason — enforced here so the person never meets a server error for a rule
 * the form could have stated, and again on the server so it is actually true.
 */
function DecisionDialog({
  row,
  approve,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  row: StaffRequestRow;
  approve: boolean;
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}) {
  const { tr } = useLocale();
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const missingReason = !approve && note.trim().length === 0;

  return (
    <Modal
      title={tr(approve ? 'ws.owner.requests.approveTitle' : 'ws.owner.requests.declineTitle')}
      onClose={onCancel}
      footer={
        <>
          <Button kind="ghost" onClick={onCancel} disabled={busy}>
            {tr('ws.kit.reason.cancel')}
          </Button>
          <Button
            kind={approve ? 'primary' : 'danger'}
            busy={busy}
            onClick={() => {
              setTouched(true);
              if (!missingReason) onSubmit(note.trim());
            }}
          >
            {tr(approve ? 'ws.owner.requests.approve' : 'ws.owner.requests.decline')}
          </Button>
        </>
      }
    >
      <p style={{ marginBlockStart: 0 }}>
        {tr(approve ? 'ws.owner.requests.approveBody' : 'ws.owner.requests.declineBody', {
          name: row.staff_name,
          kind: tr(`ws.owner.requests.kinds.${row.kind as StaffRequestKind}`),
        })}
      </p>
      <Field
        label={tr(approve ? 'ws.owner.requests.noteOptional' : 'ws.owner.requests.reasonLabel')}
        required={!approve}
        error={touched && missingReason ? tr('op.errors.REASON_REQUIRED') : undefined}
      >
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => setTouched(true)}
          rows={3}
          style={{
            inlineSize: '100%',
            font: 'inherit',
            padding: 'var(--tp-sp-2)',
            borderRadius: 'var(--tp-radius-ctl)',
            border: '1px solid var(--tp-border)',
            background: 'var(--tp-surface)',
            color: 'var(--tp-fg)',
          }}
        />
      </Field>
      {error != null && <ErrorText error={error} />}
    </Modal>
  );
}
