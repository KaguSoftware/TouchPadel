/**
 * `/admin/audit` — the audit-log viewer.
 *
 * SOW L241-243 promises "an append-only audit log recording actor, action,
 * before and after values, and a reason code on discounts, voids, price
 * overrides, stock adjustments and reservation overrides", and L434-439 makes
 * "every discount, void and refund traceable to a named actor" an acceptance
 * test for the whole cashier module. The log itself has been correct since day
 * 1 — `audit_log` grants `select` to management (0005:63-65) — and until now
 * nothing in any of the three apps read it, so the promise was demonstrable
 * only by typing SQL.
 *
 * No new RPC: RLS already restricts the table to manager and owner, and it is
 * INSERT-only for everyone, so a plain select is both sufficient and safe.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatTime } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { useLocale } from '../../../lib/i18n';
import { Button, ErrorText, Field, Select, Skeleton, card, inputStyle } from '../../../components/ui';
import {
  EMPTY_FILTER,
  actionFamilies,
  actorLabel,
  diffFields,
  matchesAudit,
  missingReason,
  type AuditFilter,
  type AuditRow,
} from './auditLogic';

/** One page. Deep history is a report, not a screen — this is for "what just happened". */
const PAGE_SIZE = 200;

const cell: React.CSSProperties = {
  paddingBlock: '0.4rem',
  paddingInline: '0.5rem',
  borderBlockEnd: '1px solid var(--tp-border)',
  textAlign: 'start',
  verticalAlign: 'top',
};

const NO_ROWS: AuditRow[] = [];

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.78rem',
};

export function AuditLog() {
  const { tr, locale } = useLocale();
  const [filter, setFilter] = useState<AuditFilter>(EMPTY_FILTER);
  const [expanded, setExpanded] = useState<number | null>(null);

  const logQ = useQuery({
    queryKey: ['auditLog'],
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await supabase
        .from('audit_log')
        .select(
          'id, at, actor_id, actor_role, authorizer_id, action, entity, entity_id, before, after, reason_code, device_id',
        )
        .order('at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
    // A manager reading this is investigating something that already happened;
    // silently swapping rows under them mid-read would be worse than stale.
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  // Actor names come from `staff`, which RLS already opens to manager+owner.
  // Guests and removed staff simply keep their short id (see actorLabel).
  const staffQ = useQuery({
    queryKey: ['auditStaffNames'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff').select('id, display_name');
      if (error) throw error;
      return (data ?? []) as { id: string; display_name: string }[];
    },
    staleTime: 5 * 60_000,
  });

  const names = useMemo(
    () => new Map((staffQ.data ?? []).map((s) => [s.id, s.display_name])),
    [staffQ.data],
  );

  // Stable identity: `logQ.data ?? []` builds a fresh array every render, which
  // silently defeats all four memos below.
  const rows = logQ.data ?? NO_ROWS;
  const families = useMemo(() => actionFamilies(rows), [rows]);
  const visible = useMemo(() => rows.filter((r) => matchesAudit(r, filter)), [rows, filter]);
  const missingCount = useMemo(() => rows.filter(missingReason).length, [rows]);

  const actorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.actor_id && !seen.has(r.actor_id)) {
        seen.set(r.actor_id, actorLabel(r.actor_id, r.actor_role, names));
      }
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, names]);

  return (
    <div>
      <h2 style={{ marginBlockStart: 0 }}>{tr('op.audit.title')}</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--tp-muted-fg)', marginBlockStart: 0 }}>
        {tr('op.audit.hint', { count: PAGE_SIZE })}
      </p>

      <ErrorText error={logQ.error} />

      <div
        style={{
          ...card,
          display: 'flex',
          gap: '0.6rem',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <Field label={tr('op.common.search')}>
          <input
            style={{ ...inputStyle, minInlineSize: '14rem' }}
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
            placeholder={tr('op.audit.searchHint')}
          />
        </Field>
        <Field label={tr('op.audit.family')}>
          <Select
            value={filter.family}
            onChange={(v) => setFilter((f) => ({ ...f, family: v }))}
            placeholder={tr('op.audit.allFamilies')}
            options={[
              { value: '', label: tr('op.audit.allFamilies') },
              ...families.map((v) => ({ value: v, label: v })),
            ]}
            style={{ minInlineSize: '10rem' }}
          />
        </Field>
        <Field label={tr('op.audit.actor')}>
          <Select
            value={filter.actorId}
            onChange={(v) => setFilter((f) => ({ ...f, actorId: v }))}
            options={[{ value: '', label: tr('op.audit.allActors') }, ...actorOptions]}
            style={{ minInlineSize: '12rem' }}
          />
        </Field>
        <Button
          kind={filter.onlyMissingReason ? 'primary' : undefined}
          aria-pressed={filter.onlyMissingReason}
          onClick={() => setFilter((f) => ({ ...f, onlyMissingReason: !f.onlyMissingReason }))}
        >
          {tr('op.audit.missingReason', { count: missingCount })}
        </Button>
        <Button kind="ghost" onClick={() => setFilter(EMPTY_FILTER)}>
          {tr('op.audit.clear')}
        </Button>
        <span style={{ flex: 1 }} />
        <Button kind="ghost" onClick={() => void logQ.refetch()} disabled={logQ.isFetching}>
          {tr('op.common.refresh')}
        </Button>
      </div>

      {logQ.isPending && <Skeleton lines={8} />}

      {logQ.isSuccess && (
        <>
          <p style={{ fontSize: '0.8rem', color: 'var(--tp-muted-fg)' }}>
            {tr('op.audit.showing', { shown: visible.length, total: rows.length })}
          </p>
          {visible.length === 0 ? (
            <p style={card}>{tr('op.audit.empty')}</p>
          ) : (
            <div style={{ ...card, paddingBlock: 0, paddingInline: 0, overflowX: 'auto' }}>
              <table style={{ inlineSize: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: '0.72rem', color: 'var(--tp-muted-fg)' }}>
                    <th style={cell}>{tr('op.audit.when')}</th>
                    <th style={cell}>{tr('op.audit.actor')}</th>
                    <th style={cell}>{tr('op.audit.action')}</th>
                    <th style={cell}>{tr('op.audit.entity')}</th>
                    <th style={cell}>{tr('op.audit.reason')}</th>
                    <th style={cell}>{tr('op.audit.device')}</th>
                    <th style={cell} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const changes = diffFields(r.before, r.after);
                    const open = expanded === r.id;
                    return (
                      <RowPair
                        key={r.id}
                        row={r}
                        open={open}
                        changes={changes}
                        label={actorLabel(r.actor_id, r.actor_role, names)}
                        authorizer={
                          r.authorizer_id ? actorLabel(r.authorizer_id, null, names) : null
                        }
                        when={formatTime(new Date(r.at), locale)}
                        date={new Date(r.at).toLocaleDateString(locale === 'ar' ? 'ar-IQ' : 'en-GB')}
                        onToggle={() => setExpanded(open ? null : r.id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RowPair({
  row,
  open,
  changes,
  label,
  authorizer,
  when,
  date,
  onToggle,
}: {
  row: AuditRow;
  open: boolean;
  changes: ReturnType<typeof diffFields>;
  label: string;
  authorizer: string | null;
  when: string;
  date: string;
  onToggle: () => void;
}) {
  const { tr } = useLocale();
  const flagged = missingReason(row);
  return (
    <>
      <tr>
        <td style={{ ...cell, whiteSpace: 'nowrap' }}>
          <div>{when}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--tp-muted-fg)' }}>{date}</div>
        </td>
        <td style={cell}>
          <div>{label}</div>
          {/* Who entered the PIN, when the action was escalated — L468-469 asks
              for the authoriser by name, not just the actor. */}
          {authorizer && (
            <div style={{ fontSize: '0.7rem', color: 'var(--tp-muted-fg)' }}>
              {tr('op.audit.authorisedBy', { name: authorizer })}
            </div>
          )}
        </td>
        {/* data-audit-action: the nested before/after table repeats the column
            positions, so tests need a handle on the OUTER row, not nth-child. */}
        <td style={{ ...cell, ...mono }} data-audit-action={row.action}>
          {row.action}
        </td>
        <td style={{ ...cell, ...mono }}>
          <div>{row.entity}</div>
          <div style={{ color: 'var(--tp-muted-fg)' }}>{row.entity_id}</div>
        </td>
        <td style={cell}>
          {row.reason_code ?? (
            <span style={{ color: flagged ? 'var(--tp-danger)' : 'var(--tp-muted-fg)' }}>
              {flagged ? tr('op.audit.reasonMissing') : '—'}
            </span>
          )}
        </td>
        <td style={{ ...cell, ...mono }}>{row.device_id ?? '—'}</td>
        <td style={cell}>
          {changes.length > 0 && (
            <Button kind="ghost" onClick={onToggle} aria-expanded={open}>
              {open
                ? tr('op.audit.hideChanges')
                : tr('op.audit.showChanges', { count: changes.length })}
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td style={{ ...cell, background: 'var(--tp-muted)' }} colSpan={7}>
            <table style={{ inlineSize: '100%', borderCollapse: 'collapse', ...mono }}>
              <thead>
                <tr style={{ fontSize: '0.7rem', color: 'var(--tp-muted-fg)' }}>
                  <th style={cell}>{tr('op.audit.field')}</th>
                  <th style={cell}>{tr('op.audit.before')}</th>
                  <th style={cell}>{tr('op.audit.after')}</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.field}>
                    <td style={cell}>{c.field}</td>
                    <td style={{ ...cell, color: 'var(--tp-muted-fg)' }}>{c.before}</td>
                    <td style={cell}>{c.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
