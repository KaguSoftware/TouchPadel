/**
 * `/admin/audit` — the audit-log viewer (spec 06.38). Read-only in every
 * case: the log cannot be edited or deleted from this screen or any other.
 *
 * Source of rows: `app.audit_log_page` (0068 family) when the server has it,
 * feature-detected by catching the RPC's "function not found" error once and
 * falling back to the direct `audit_log` select (RLS already restricts the
 * table to manager + owner and it is INSERT-only for everyone).
 *
 * Filters: person, action family, free text, period. Export is a client-side
 * CSV of the filtered rows. Arriving with `?q=<action>` (the overview's
 * exception rows) pre-fills the search; `?actor=<staff id>` (staff activity)
 * the person; `?period=<preset>` the period.
 *
 * WHAT CHANGED, AND WHY
 *
 * The table printed the log's storage format: `tab.settle` in monospace, the
 * table name and a uuid as the "record", station ids, and a before/after list
 * of column names in which `idempotency_key` and five foreign keys buried the
 * one field that changed. It now reads the way a manager asks the question:
 * when, who, what happened (in words, with the thing's own name), why. Codes
 * stay searchable and stay in the CSV, which is where an investigation that
 * needs them goes.
 *
 * It also claimed "200 of 200" when the period held far more: the page is
 * capped at 200 and the count was of the page. The RPC returns the real total,
 * and person / area filters now go to the server, so filtering reaches the
 * whole period instead of only the newest 200 rows.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { formatDate, formatDateTime, formatNumber, formatTime, type MessageKey } from '@touch/i18n';
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
  MessagePresenter,
  PageHeader,
  SearchField,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  presetPeriod,
  type Column,
  type FilterChip,
  type Period,
  type PeriodPreset,
} from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { downloadCsv, toCsv } from '../../analytics/csv';
import { knownReason } from '../dayCloseLogic';
import {
  EMPTY_FILTER,
  actionFamily,
  auditCsv,
  diffFields,
  familyOptions,
  inPeriod,
  isActionCode,
  isTechnicalField,
  humanizeField,
  knownActionKey,
  knownFamilyKey,
  matchesAudit,
  missingReason,
  periodBounds,
  recordName,
  type AuditFilter,
  type AuditRow,
  type FieldChange,
} from './auditLogic';

/** One page. Deep history is a report, not a screen — this is for "what just happened". */
const PAGE_SIZE = 200;
const AUDIT_COLUMNS = 'id, at, actor_id, actor_role, authorizer_id, action, entity, entity_id, before, after, reason_code, device_id';
const NO_ROWS: AuditRow[] = [];
const PRESETS = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'last30'] as const;
const ROLE_KEYS = ['cashier', 'prep', 'court_desk', 'manager', 'owner'] as const;

type Tr = ReturnType<typeof useLocale>['tr'];

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
    actor_name: pick<string | null>('actor_name', 'actorName') ?? null,
    authorizer_name: pick<string | null>('authorizer_name', 'authorizerName') ?? null,
  } as AuditRow;
}

function unwrap(payload: unknown): { rows: AuditRow[]; total: number | null } {
  const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as { rows?: unknown; entries?: unknown; total?: unknown }) : null;
  const list = Array.isArray(payload) ? payload : obj ? (obj.rows ?? obj.entries) : null;
  const total = obj && typeof obj.total === 'number' ? obj.total : null;
  if (!Array.isArray(list)) return { rows: [], total };
  return { rows: list.map((r) => normalizeRow(r as Record<string, unknown>)), total };
}

interface ServerFilter {
  actorId: string;
  /** `menu.` for an area, or an exact action code. */
  prefix: string | null;
}

async function fetchAuditPage(period: Period, server: ServerFilter): Promise<{ rows: AuditRow[]; total: number | null }> {
  const bounds = periodBounds(period);
  if (!auditPageUnavailable) {
    try {
      const payload = await appRpc<unknown>('audit_log_page', {
        p_from: bounds.fromIso,
        p_to: bounds.toExclusiveIso,
        p_actor_id: server.actorId || null,
        p_action_prefix: server.prefix,
        p_limit: PAGE_SIZE,
      });
      return unwrap(payload);
    } catch (e) {
      if (!isFunctionMissing(e)) throw e;
      auditPageUnavailable = true;
    }
  }
  let q = supabase
    .from('audit_log')
    .select(AUDIT_COLUMNS)
    .gte('at', bounds.fromIso)
    .lt('at', bounds.toExclusiveIso);
  if (server.actorId) q = q.or(`actor_id.eq.${server.actorId},authorizer_id.eq.${server.actorId}`);
  if (server.prefix) q = q.like('action', `${server.prefix}%`);
  const { data, error } = await q.order('at', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE);
  if (error) throw error;
  // No total on this path: the note says "the latest 200" without an "of".
  return { rows: ((data ?? []) as unknown as AuditRow[]).filter((r) => inPeriod(r, bounds)), total: null };
}

function initialPeriod(raw: unknown): Period {
  const preset = typeof raw === 'string' && (PRESETS as readonly string[]).includes(raw) ? (raw as Exclude<PeriodPreset, 'custom'>) : 'last30';
  return presetPeriod(preset);
}

export function AuditLog() {
  const { tr, locale } = useLocale();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const initialQuery = typeof search.q === 'string' ? search.q : '';
  // `?actor=<staff id>` — the staff-activity report's "audit view filtered to one person".
  const initialActor = typeof search.actor === 'string' ? search.actor : '';
  const [filter, setFilter] = useState<AuditFilter>({ ...EMPTY_FILTER, query: initialQuery, actorId: initialActor });
  const [period, setPeriod] = useState<Period>(() => initialPeriod(search.period));
  const [expanded, setExpanded] = useState<number | null>(null);

  // Person and area go to the server so they reach the whole period, not just
  // the newest page. An exact action code in the search (the overview's links)
  // does too; free text stays a client filter over the page.
  const server: ServerFilter = {
    actorId: filter.actorId,
    prefix: filter.family ? `${filter.family}.` : isActionCode(filter.query) ? filter.query.trim() : null,
  };

  const logQ = useQuery({
    queryKey: ['auditLog', period.from, period.to, server.actorId, server.prefix],
    queryFn: () => fetchAuditPage(period, server),
    // A manager reading this is investigating something that already happened;
    // silently swapping rows under them mid-read would be worse than stale.
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  // Actor names come from `staff`, which RLS already opens to manager+owner.
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
  const total = logQ.data?.total ?? null;

  const whoOf = useMemo(() => (r: AuditRow) => personName(r.actor_id, r.actor_role, r.actor_name ?? null, names, tr), [names, tr]);
  const visible = useMemo(
    () => rows.filter((r) => matchesAudit(r, filter, [actionWords(r.action, tr), whoOf(r), recordName(r.before, r.after, locale) ?? ''])),
    [rows, filter, tr, whoOf, locale],
  );
  const missingCount = useMemo(() => rows.filter(missingReason).length, [rows]);

  const families = useMemo(() => familyOptions(rows), [rows]);
  const actorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of staffQ.data ?? []) seen.set(s.id, s.display_name);
    for (const r of rows) if (r.actor_id && !seen.has(r.actor_id)) seen.set(r.actor_id, whoOf(r));
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, staffQ.data, whoOf]);

  const familyLabel = filter.family ? familyWords(filter.family, tr) : '';
  const actorName = actorOptions.find((o) => o.value === filter.actorId)?.label ?? filter.actorId;
  const queryText = isActionCode(filter.query) ? actionWords(filter.query, tr) : filter.query;
  // Rulebook 6.6: every active filter is visible and removable where the results are.
  const chips: FilterChip[] = ([
    filter.query
      ? { id: 'query', label: <bdi>{tr('ws.manager.filters.search', { value: queryText })}</bdi>, text: tr('ws.manager.filters.search', { value: queryText }), onRemove: () => setFilter((f) => ({ ...f, query: '' })) }
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
  // per record), so the skeleton is built from the same header labels.
  const skeletonColumns: Column<AuditRow>[] = [
    { key: 'when', header: tr('op.audit.when') },
    { key: 'actor', header: tr('op.audit.actor') },
    { key: 'what', header: tr('ws.manager.audit.what') },
    { key: 'reason', header: tr('op.audit.reason') },
  ];

  function exportCsv() {
    const csvKey = (k: string) => tr(`ws.manager.audit.csv.${k}` as MessageKey);
    const { headers, rows: out } = auditCsv(
      {
        date: csvKey('date'),
        time: csvKey('time'),
        who: csvKey('actor'),
        role: csvKey('role'),
        authoriser: csvKey('authoriser'),
        what: csvKey('what'),
        record: csvKey('record'),
        field: csvKey('field'),
        was: csvKey('was'),
        became: csvKey('became'),
        reason: csvKey('reason'),
        station: csvKey('device'),
        actionCode: csvKey('actionCode'),
        recordType: csvKey('recordType'),
        recordId: csvKey('entityId'),
      },
      visible,
      {
        actor: (r) => personName(r.actor_id, r.actor_role, r.actor_name ?? null, names, tr),
        // Only when someone else authorised it — repeating the actor's own name says nothing.
        authoriser: (r) => (r.authorizer_id && r.authorizer_id !== r.actor_id ? (r.authorizer_name ?? personName(r.authorizer_id, null, null, names, tr)) : null),
        role: (role) => (role && (ROLE_KEYS as readonly string[]).includes(role) ? tr(`op.roles.${role}` as MessageKey) : role),
        action: (action) => actionWords(action, tr),
        record: (r) => recordName(r.before, r.after, locale),
        reason: (code) => reasonWords(code, tr),
        yes: tr('ws.manager.audit.yes'),
        no: tr('ws.manager.audit.no'),
      },
    );
    downloadCsv(`audit-log-${period.from}-${period.to}.csv`, toCsv(headers, out));
  }

  const status = asyncStatus(logQ, (d) => d.rows.length === 0 && !filter.family && !filter.actorId && !isActionCode(filter.query));
  const capped = rows.length >= PAGE_SIZE || (total !== null && total > rows.length);

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
      />

      <Toolbar>
        <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr('ws.manager.audit.period')}</span>
        <DateRangeControl period={period} onChange={setPeriod} presets={PRESETS} />
      </Toolbar>
      <Toolbar style={{ alignItems: 'flex-end' }}>
        <Field label={tr('op.common.search')} style={{ marginBlockEnd: 0, inlineSize: '17rem', maxInlineSize: '100%' }}>
          <SearchField
            value={filter.query}
            onChange={(query) => setFilter((f) => ({ ...f, query }))}
            placeholder={tr('op.audit.searchHint')}
            aria-label={tr('op.common.search')}
          />
        </Field>
        <Field label={tr('op.audit.family')} style={{ marginBlockEnd: 0 }}>
          <Select
            value={filter.family}
            onChange={(v) => setFilter((f) => ({ ...f, family: v }))}
            options={[{ value: '', label: tr('op.audit.allFamilies') }, ...families.map((v) => ({ value: v, label: familyWords(v, tr) }))]}
            style={{ minInlineSize: '11rem' }}
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
          {tr('op.audit.missingReason', { count: formatNumber(missingCount, locale) })}
        </Button>
      </Toolbar>

      <FilterChips chips={chips} onClearAll={() => setFilter(EMPTY_FILTER)} style={{ marginBlockEnd: 'var(--tp-sp-2-5)' }} />

      {initialQuery && filter.query === initialQuery && (
        <p style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2-5)' }}>
          <Icon name="info" size={14} />
          <bdi>{tr('ws.manager.audit.filteredFrom', { what: queryText })}</bdi>
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
        {capped && (
          <MessagePresenter
            tone="info"
            style={{ marginBlockEnd: 'var(--tp-sp-2)' }}
            message={
              total !== null && total > rows.length
                ? tr('ws.manager.audit.latestOf', { shown: formatNumber(rows.length, locale), total: formatNumber(total, locale) })
                : tr('ws.manager.audit.latest', { shown: formatNumber(rows.length, locale) })
            }
          />
        )}
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
                  <th>{tr('ws.manager.audit.what')}</th>
                  <th>{tr('op.audit.reason')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const open = expanded === r.id;
                  return (
                    <RowPair
                      key={r.id}
                      row={r}
                      open={open}
                      who={whoOf(r)}
                      authorizer={r.authorizer_id && r.authorizer_id !== r.actor_id ? (r.authorizer_name ?? personName(r.authorizer_id, null, null, names, tr)) : null}
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

/** A stored action in words; an action this build does not know keeps its area's name and its code. */
function actionWords(action: string, tr: Tr): string {
  const key = knownActionKey(action);
  if (key) return tr(`ws.manager.audit.actions.${key}` as MessageKey);
  return `${familyWords(actionFamily(action), tr)} · ${action}`;
}

function familyWords(family: string, tr: Tr): string {
  const key = knownFamilyKey(family);
  return key ? tr(`ws.manager.audit.families.${key}` as MessageKey) : family;
}

/**
 * Who did it, as staff would say it. The server's joined name first (it also
 * names guests), then the staff list, then what the row can still tell us —
 * never a truncated uuid on screen (the CSV keeps the id for correlation).
 */
function personName(id: string | null, role: string | null, serverName: string | null, names: ReadonlyMap<string, string>, tr: Tr): string {
  if (serverName) return serverName;
  if (id && names.has(id)) return names.get(id)!;
  if (!id) return tr('ws.manager.audit.system');
  if (role && (ROLE_KEYS as readonly string[]).includes(role)) return tr('ws.manager.audit.formerStaff');
  if (role === 'guest' || role === 'authenticated') return tr('ws.manager.audit.guest');
  return tr('ws.manager.audit.system');
}

function reasonWords(code: string, tr: Tr): string {
  const known = knownReason(code);
  return known ? tr(`op.reasons.${known}`) : code;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** A before/after leaf the way a manager reads it: Yes/No, a local date and time. */
function ValueText({ value }: { value: string }) {
  const { tr, locale } = useLocale();
  if (value === 'true') return <>{tr('ws.manager.audit.yes')}</>;
  if (value === 'false') return <>{tr('ws.manager.audit.no')}</>;
  if (ISO_INSTANT.test(value) && !Number.isNaN(new Date(value).getTime())) return <bdi>{formatDateTime(new Date(value), locale)}</bdi>;
  return <bdi style={{ overflowWrap: 'anywhere' }}>{value}</bdi>;
}

function RowPair({
  row,
  open,
  who,
  authorizer,
  onToggle,
}: {
  row: AuditRow;
  open: boolean;
  who: string;
  authorizer: string | null;
  onToggle: () => void;
}) {
  const { tr, locale } = useLocale();
  const flagged = missingReason(row);
  const allChanges = diffFields(row.before, row.after);
  // An insert lists every column; one that is empty on both sides says nothing.
  const changes: FieldChange[] = allChanges.filter((c) => !isTechnicalField(c.field) && c.before !== c.after);
  const hidden = allChanges.length - changes.length;
  const record = recordName(row.before, row.after, locale);
  const at = new Date(row.at);
  return (
    <>
      <tr data-selected={open ? 'true' : undefined}>
        <td style={{ whiteSpace: 'nowrap' }}>
          <div>{formatTime(at, locale)}</div>
          <div style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{formatDate(at, locale)}</div>
          {row.device_id && (
            <div style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              <bdi>{tr('ws.manager.audit.station', { name: row.device_id })}</bdi>
            </div>
          )}
        </td>
        <td>
          <div>
            <bdi>{who}</bdi>
          </div>
          {/* Who entered the PIN, when the action was escalated — L468-469 asks
              for the authoriser by name, not just the actor. */}
          {authorizer && (
            <div style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              <bdi>{tr('op.audit.authorisedBy', { name: authorizer })}</bdi>
            </div>
          )}
        </td>
        {/* data-audit-action keeps the stored code on the OUTER row: tests and
            the e2e need a handle that the nested before/after table cannot
            also match. */}
        <td data-audit-action={row.action}>
          <div style={{ fontWeight: 600 }}>{actionWords(row.action, tr)}</div>
          {record && (
            <div style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
              <bdi>{record}</bdi>
            </div>
          )}
        </td>
        <td>
          {row.reason_code ? (
            reasonWords(row.reason_code, tr)
          ) : flagged ? (
            <StatusBadge size="sm" tone="danger" label={tr('op.audit.reasonMissing')} />
          ) : (
            <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>
          )}
        </td>
        <td data-align="end">
          {allChanges.length > 0 && (
            <Button kind="ghost" size="sm" onClick={onToggle} aria-expanded={open} iconEnd={open ? undefined : 'chevronDown'}>
              {open ? tr('op.audit.hideChanges') : tr('op.audit.showChanges', { count: formatNumber(changes.length, locale) })}
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ background: 'var(--tp-surface-2)' }}>
            {changes.length === 0 ? (
              <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.audit.noVisibleChanges')}</p>
            ) : (
              <table className="tp-table" data-dense="true">
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
                      <td>
                        <bdi>{humanizeField(c.field)}</bdi>
                      </td>
                      <td style={{ color: 'var(--tp-muted-fg)' }}>
                        <ValueText value={c.before} />
                      </td>
                      <td>
                        <ValueText value={c.after} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {hidden > 0 && changes.length > 0 && (
              <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: 'var(--tp-sp-1-5)' }}>{tr('ws.manager.audit.hiddenFields')}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
