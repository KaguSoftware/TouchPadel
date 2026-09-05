/**
 * `/admin/audit` — the audit-log viewer (spec 06.38). Read-only in every
 * case: the log cannot be edited or deleted from this screen or any other.
 *
 * Source of rows: `app.audit_log_page` (0068 family) when the server has it,
 * feature-detected by catching the RPC's "function not found" error once and
 * falling back to the direct `audit_log` select (RLS already restricts the
 * table to manager + owner and it is INSERT-only for everyone). The screen
 * says which path served the page.
 *
 * Filters: person, action family, free text, period. Export is a client-side
 * CSV of the filtered rows. Arriving with `?q=<action>` (the overview's
 * exception tiles) pre-fills the search.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { formatDate, formatTime } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc, AppRpcError } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { Button, ErrorText, Field, Select } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DateRangeControl,
  EmptyState,
  ExportButton,
  FilterChips,
  PageHeader,
  ResultCount,
  SearchField,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  presetPeriod,
  type Column,
  type FilterChip,
  type Period,
} from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { downloadCsv, toCsv } from '../../analytics/csv';
import {
  EMPTY_FILTER,
  actionFamilies,
  actorLabel,
  auditCsv,
  diffFields,
  inPeriod,
  matchesAudit,
  missingReason,
  periodBounds,
  type AuditFilter,
  type AuditRow,
} from './auditLogic';

/** One page. Deep history is a report, not a screen — this is for "what just happened". */
const PAGE_SIZE = 200;
const AUDIT_COLUMNS = 'id, at, actor_id, actor_role, authorizer_id, action, entity, entity_id, before, after, reason_code, device_id';
const NO_ROWS: AuditRow[] = [];

type Source = 'server' | 'fallback';

// Feature detection is remembered for the session: once the RPC is known to
// be missing there is no point asking on every filter change.
let auditPageUnavailable = false;

function isFunctionMissing(e: unknown): boolean {
  if (!(e instanceof AppRpcError)) return false;
  if (e.code !== 'UNKNOWN') return false;
  const text = `${e.message} ${e.hint ?? ''} ${e.details ?? ''}`.toLowerCase();
  return text.includes('could not find') || text.includes('does not exist') || text.includes('schema cache') || text.includes('404');
}

/**
 * 0068's `audit_log_page` returns camelCase keys (`actorId`, `reasonCode`, …)
 * while the direct table select returns the column names. Both are folded to
 * the column shape here — reading only snake_case silently rendered every
 * actor as "system", because `actor_id` was undefined on an RPC row.
 */
function normalizeRow(raw: Record<string, unknown>): AuditRow {
  const pick = <T,>(snake: string, camel: string): T =>
    (raw[snake] !== undefined ? raw[snake] : raw[camel]) as T;
  return {
    id: pick<number>('id', 'id'),
    at: pick<string>('at', 'at'),
    actor_id: pick<string | null>('actor_id', 'actorId') ?? null,
    actor_role: pick<string | null>('actor_role', 'actorRole') ?? null,
    authorizer_id: pick<string | null>('authorizer_id', 'authorizerId') ?? null,
    action: pick<string>('action', 'action'),
    entity: pick<string>('entity', 'entity'),
    entity_id: pick<string | null>('entity_id', 'entityId') ?? null,
    before: pick<unknown>('before', 'before') ?? null,
    after: pick<unknown>('after', 'after') ?? null,
    reason_code: pick<string | null>('reason_code', 'reasonCode') ?? null,
    device_id: pick<string | null>('device_id', 'deviceId') ?? null,
  } as AuditRow;
}

function unwrapRows(payload: unknown): AuditRow[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as { rows?: unknown; entries?: unknown }).rows ??
        (payload as { entries?: unknown }).entries)
      : null;
  if (!Array.isArray(list)) return [];
  return list.map((r) => normalizeRow(r as Record<string, unknown>));
}

async function fetchAuditPage(period: Period): Promise<{ rows: AuditRow[]; source: Source }> {
  const bounds = periodBounds(period);
  if (!auditPageUnavailable) {
    try {
      const payload = await appRpc<unknown>('audit_log_page', {
        p_from: bounds.fromIso,
        p_to: bounds.toExclusiveIso,
        p_limit: PAGE_SIZE,
      });
      return { rows: unwrapRows(payload), source: 'server' };
    } catch (e) {
      if (!isFunctionMissing(e)) throw e;
      auditPageUnavailable = true;
    }
  }
  const { data, error } = await supabase
    .from('audit_log')
    .select(AUDIT_COLUMNS)
    .gte('at', bounds.fromIso)
    .lt('at', bounds.toExclusiveIso)
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw error;
  return { rows: ((data ?? []) as unknown as AuditRow[]).filter((r) => inPeriod(r, bounds)), source: 'fallback' };
}

export function AuditLog() {
  const { tr, locale } = useLocale();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const initialQuery = typeof search.q === 'string' ? search.q : '';
  // `?actor=<staff id>` — the staff-activity report's "audit view filtered to one person".
  const initialActor = typeof search.actor === 'string' ? search.actor : '';
  const [filter, setFilter] = useState<AuditFilter>({ ...EMPTY_FILTER, query: initialQuery, actorId: initialActor });
  const [period, setPeriod] = useState<Period>(() => presetPeriod('last30'));
  const [expanded, setExpanded] = useState<number | null>(null);

  const logQ = useQuery({
    queryKey: ['auditLog', period.from, period.to],
    queryFn: () => fetchAuditPage(period),
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

  const names = useMemo(() => new Map((staffQ.data ?? []).map((s) => [s.id, s.display_name])), [staffQ.data]);

  // Stable identity: `logQ.data?.rows ?? []` builds a fresh array every render,
  // which silently defeats all the memos below.
  const rows = logQ.data?.rows ?? NO_ROWS;
  const families = useMemo(() => actionFamilies(rows), [rows]);
  const visible = useMemo(() => rows.filter((r) => matchesAudit(r, filter)), [rows, filter]);
  const missingCount = useMemo(() => rows.filter(missingReason).length, [rows]);

  const actorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.actor_id && !seen.has(r.actor_id)) seen.set(r.actor_id, actorLabel(r.actor_id, r.actor_role, names));
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, names]);

  const familyLabel = filter.family;
  const actorName = actorOptions.find((o) => o.value === filter.actorId)?.label ?? filter.actorId;
  // Rulebook 6.6: the four filters used to be legible only inside the controls
  // that set them, and "Clear" was a lone ghost button with no statement of
  // what it would clear.
  const chips: FilterChip[] = ([
    filter.query
      ? { id: 'query', label: tr('ws.manager.filters.search', { value: filter.query }), text: tr('ws.manager.filters.search', { value: filter.query }), onRemove: () => setFilter((f) => ({ ...f, query: '' })) }
      : null,
    filter.family
      ? { id: 'family', label: tr('ws.manager.filters.area', { value: familyLabel }), text: tr('ws.manager.filters.area', { value: familyLabel }), onRemove: () => setFilter((f) => ({ ...f, family: '' })) }
      : null,
    filter.actorId
      ? { id: 'actor', label: <bdi>{tr('ws.manager.filters.person', { value: actorName })}</bdi>, text: tr('ws.manager.filters.person', { value: actorName }), onRemove: () => setFilter((f) => ({ ...f, actorId: '' })) }
      : null,
    filter.onlyMissingReason
      ? { id: 'missing', label: tr('ws.manager.filters.missingReason'), text: tr('ws.manager.filters.missingReason'), onRemove: () => setFilter((f) => ({ ...f, onlyMissingReason: false })) }
      : null,
  ] as (FilterChip | null)[]).filter((c): c is FilterChip => c !== null);

  // The table is hand-rolled (the expandable before/after row is a second <tr>
  // per record), so the skeleton is built from the same header labels rather
  // than from a Column[] DataTable would own.
  const skeletonColumns: Column<AuditRow>[] = [
    { key: 'when', header: tr('op.audit.when') },
    { key: 'actor', header: tr('op.audit.actor') },
    { key: 'action', header: tr('op.audit.action') },
    { key: 'entity', header: tr('op.audit.entity') },
    { key: 'reason', header: tr('op.audit.reason') },
    { key: 'device', header: tr('op.audit.device') },
  ];

  function exportCsv() {
    const { headers, rows: out } = auditCsv(
      {
        when: tr('ws.manager.audit.csv.when'),
        actor: tr('ws.manager.audit.csv.actor'),
        role: tr('ws.manager.audit.csv.role'),
        authoriser: tr('ws.manager.audit.csv.authoriser'),
        action: tr('ws.manager.audit.csv.action'),
        entity: tr('ws.manager.audit.csv.entity'),
        entityId: tr('ws.manager.audit.csv.entityId'),
        reason: tr('ws.manager.audit.csv.reason'),
        device: tr('ws.manager.audit.csv.device'),
        changes: tr('ws.manager.audit.csv.changes'),
      },
      visible,
      names,
    );
    downloadCsv(`audit-log-${period.from}-${period.to}.csv`, toCsv(headers, out));
  }

  const status = asyncStatus(logQ, (d) => d.rows.length === 0);

  return (
    <div>
      <PageHeader
        title={tr('op.audit.title')}
        subtitle={tr('ws.manager.audit.lead')}
        actions={
          <>
            <StatusBadge tone="neutral" icon="lock" label={tr('ws.manager.audit.readOnly')} />
            <ExportButton onExport={exportCsv} disabled={visible.length === 0} />
            <Button kind="ghost" icon="refresh" busy={logQ.isFetching && logQ.data !== undefined} onClick={() => void logQ.refetch()}>
              {tr('op.common.refresh')}
            </Button>
          </>
        }
      >
        <ResultCount shown={visible.length} total={rows.length} />
      </PageHeader>

      <Toolbar>
        <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr('ws.manager.audit.period')}</span>
        <DateRangeControl period={period} onChange={setPeriod} presets={['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'last30']} />
      </Toolbar>
      <Toolbar>
        <span style={{ inlineSize: '16rem' }}>
          <SearchField
            value={filter.query}
            onChange={(query) => setFilter((f) => ({ ...f, query }))}
            placeholder={tr('op.audit.searchHint')}
            aria-label={tr('op.common.search')}
          />
        </span>
        <Field label={tr('op.audit.family')} style={{ marginBlockEnd: 0 }}>
          <Select
            value={filter.family}
            onChange={(v) => setFilter((f) => ({ ...f, family: v }))}
            options={[{ value: '', label: tr('op.audit.allFamilies') }, ...families.map((v) => ({ value: v, label: v }))]}
            style={{ minInlineSize: '10rem' }}
          />
        </Field>
        <Field label={tr('op.audit.actor')} style={{ marginBlockEnd: 0 }}>
          <Select
            value={filter.actorId}
            onChange={(v) => setFilter((f) => ({ ...f, actorId: v }))}
            options={[{ value: '', label: tr('op.audit.allActors') }, ...actorOptions]}
            style={{ minInlineSize: '12rem' }}
          />
        </Field>
        <Button
          kind={filter.onlyMissingReason ? 'primary' : 'default'}
          aria-pressed={filter.onlyMissingReason}
          icon="alert"
          onClick={() => setFilter((f) => ({ ...f, onlyMissingReason: !f.onlyMissingReason }))}
        >
          {tr('op.audit.missingReason', { count: missingCount })}
        </Button>
      </Toolbar>

      <FilterChips chips={chips} onClearAll={() => setFilter(EMPTY_FILTER)} style={{ marginBlockEnd: 'var(--tp-sp-2-5)' }} />

      {initialQuery && filter.query === initialQuery && (
        <p style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2-5)' }}>
          <Icon name="info" size={14} />
          <bdi>{tr('ws.manager.audit.filteredFrom', { query: initialQuery })}</bdi>
          <Button size="sm" kind="ghost" onClick={() => setFilter((f) => ({ ...f, query: '' }))}>
            {tr('ws.manager.audit.clearFilter')}
          </Button>
        </p>
      )}

      <ErrorText error={staffQ.error} />

      <AsyncStateWrapper
        status={status}
        error={logQ.error}
        onRetry={() => void logQ.refetch()}
        skeleton={<TableSkeleton columns={skeletonColumns} rows={8} />}
        emptyContent={<EmptyState kind="initial" icon="fileText" title={tr('op.audit.empty')} />}
      >
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>
          {logQ.data?.source === 'server' ? tr('ws.manager.audit.source.server') : tr('ws.manager.audit.source.fallback', { count: PAGE_SIZE })}
        </p>
        {visible.length === 0 ? (
          // Not "no entries" — the log HAS entries, the filters matched none of
          // them, and the way out is the filters (rulebook 9.2).
          <EmptyState compact kind="filtered" onClearFilters={() => setFilter(EMPTY_FILTER)} />
        ) : (
          <div style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', overflow: 'auto', background: 'var(--tp-surface)' }}>
            <table className="tp-table" aria-label={tr('op.audit.title')}>
              <thead>
                <tr>
                  <th>{tr('op.audit.when')}</th>
                  <th>{tr('op.audit.actor')}</th>
                  <th>{tr('op.audit.action')}</th>
                  <th>{tr('op.audit.entity')}</th>
                  <th>{tr('op.audit.reason')}</th>
                  <th>{tr('op.audit.device')}</th>
                  <th />
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
                      authorizer={r.authorizer_id ? actorLabel(r.authorizer_id, null, names) : null}
                      when={formatTime(new Date(r.at), locale)}
                      date={formatDate(new Date(r.at), locale)}
                      onToggle={() => setExpanded(open ? null : r.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AsyncStateWrapper>
    </div>
  );
}

/** Route alias for the spec name. */
export const AuditLogScreen = AuditLog;

const mono: React.CSSProperties = {
  // The stack was hand-typed here while --tp-font-mono sat in the token file
  // with no consumer, so the audit log was the one screen with its own idea of
  // what a machine identifier looks like.
  fontFamily: 'var(--tp-font-mono)',
  fontSize: 'var(--tp-fs-xs)',
};

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
      <tr data-selected={open ? 'true' : undefined}>
        <td style={{ whiteSpace: 'nowrap' }}>
          <div>{when}</div>
          <div style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{date}</div>
        </td>
        <td>
          <div>
            <bdi>{label}</bdi>
          </div>
          {/* Who entered the PIN, when the action was escalated — L468-469 asks
              for the authoriser by name, not just the actor. */}
          {authorizer && (
            <div style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              <bdi>{tr('op.audit.authorisedBy', { name: authorizer })}</bdi>
            </div>
          )}
        </td>
        {/* data-audit-action: the nested before/after table repeats the column
            positions, so tests need a handle on the OUTER row, not nth-child. */}
        <td style={mono} data-audit-action={row.action}>
          {row.action}
        </td>
        <td style={mono}>
          <div>{row.entity}</div>
          <div style={{ color: 'var(--tp-muted-fg)' }}>{row.entity_id}</div>
        </td>
        <td>
          {row.reason_code ?? (
            flagged ? <StatusBadge size="sm" tone="danger" label={tr('op.audit.reasonMissing')} /> : <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>
          )}
        </td>
        <td style={mono}>{row.device_id ?? '—'}</td>
        <td data-align="end">
          {changes.length > 0 && (
            <Button kind="ghost" size="sm" onClick={onToggle} aria-expanded={open} iconEnd={open ? 'chevronDown' : undefined}>
              {open ? tr('op.audit.hideChanges') : tr('op.audit.showChanges', { count: changes.length })}
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--tp-surface-2)' }}>
            <table className="tp-table" data-dense="true" style={{ ...mono }}>
              <thead>
                <tr>
                  <th>{tr('op.audit.field')}</th>
                  <th>{tr('op.audit.before')}</th>
                  <th>{tr('op.audit.after')}</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.field}>
                    <td>{c.field}</td>
                    <td style={{ color: 'var(--tp-muted-fg)' }}>{c.before}</td>
                    <td>{c.after}</td>
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
