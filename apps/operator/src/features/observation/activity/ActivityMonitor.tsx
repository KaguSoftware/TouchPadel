/**
 * Activity monitor (/observation/activity, 0341) — the owner's reading of who
 * is using the operator and the mobile app right now.
 *
 * One row per person, in name order (the server's), with the two apps side by
 * side and never merged: a waiter can be online on the phone and signed out
 * of the till at the same moment, and both are true. Each app says its status
 * (the server decides online / away / offline), when the person was last seen,
 * the last thing they did there in the Audit log's words, and, when the app
 * reported one, the screen they are on.
 *
 * View-only. The board refreshes every 30 s and when the window comes back to
 * the front; relative times count on the server's clock (activityLogic). The
 * Audit log, filtered to the person, is one click away on each row. Nothing
 * here ranks anyone (PRODUCT.md).
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { countPhrase, formatDateTime, formatNumber, formatTime, isolate, isolateLtr, VENUE_TZ, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { STAFF_ROLES } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { QK, fetchVenueSettings } from '../../../lib/queries';
import { Button } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  SegmentedControl,
  StatusBadge,
  ViewMore,
  useListCap,
  type Column,
  type Tone,
} from '../../../components/kit';
import { actionFamily, knownActionKey, knownFamilyKey } from '../../admin/audit/auditLogic';
import {
  agoOf,
  filterRows,
  onlineCounts,
  operatorScreenLabelKey,
  partWord,
  serverNow,
  type ActivityBoard,
  type ActivityFilter,
  type ActivityPart,
  type ActivityRow,
  type PartWord,
} from './activityLogic';

type Tr = ReturnType<typeof useLocale>['tr'];
type Locale = ReturnType<typeof useLocale>['locale'];

const BOARD_KEY = ['staffActivityBoard'] as const;

const WORD_TONE: Record<PartWord, Tone> = {
  online: 'success',
  away: 'warn',
  offline: 'neutral',
  signedOut: 'neutral',
  never: 'neutral',
};

const muted: CSSProperties = { fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' };

/** The Audit log's words for an action code, with its fallback (AuditLog.tsx). */
function actionWords(action: string, tr: Tr): string {
  const key = knownActionKey(action);
  if (key) return tr(`ws.manager.audit.actions.${key}` as MessageKey);
  const family = actionFamily(action);
  const familyKey = knownFamilyKey(family);
  return `${familyKey ? tr(`ws.manager.audit.families.${familyKey}` as MessageKey) : family} · ${action}`;
}

function agoWords(at: string, now: number, tr: Tr, locale: Locale): string {
  const ago = agoOf(at, now);
  if (ago.unit === 'justNow') return tr('ws.activity.ago.justNow');
  return countPhrase(`ws.activity.ago.${ago.unit}`, ago.count, locale);
}

function roleWords(role: string, tr: Tr): string {
  return (STAFF_ROLES as readonly string[]).includes(role) ? tr(`op.roles.${role}` as MessageKey) : role;
}

export function ActivityMonitorScreen() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ActivityFilter>('all');

  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;

  const boardQ = useQuery({
    queryKey: BOARD_KEY,
    queryFn: () => appRpc<ActivityBoard>('staff_activity_board', {}),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Relative times move between refreshes too.
  const [pcNow, setPcNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setPcNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const board = boardQ.data;
  const now = board ? serverNow(board.serverTime, boardQ.dataUpdatedAt, Math.max(pcNow, boardQ.dataUpdatedAt)) : pcNow;
  const allRows = useMemo(() => board?.rows ?? [], [board]);
  const rows = useMemo(() => filterRows(allRows, filter, now, tz), [allRows, filter, now, tz]);
  const counts = useMemo(() => onlineCounts(allRows), [allRows]);
  const cap = useListCap(rows);
  const updatedAt = boardQ.dataUpdatedAt ? new Date(boardQ.dataUpdatedAt) : null;

  const status = boardQ.isError && !board ? 'error' : !board ? 'loading' : allRows.length === 0 ? 'empty' : 'ready';

  const openAudit = (actor: string) => void navigate({ to: '/admin/audit', search: { actor } as never });

  const columns: Column<ActivityRow>[] = [
    {
      key: 'person',
      header: tr('ws.activity.columns.person'),
      width: '22%',
      render: (r) => (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start' }} data-testid={`activity.row.${r.staffId}`}>
          <strong style={{ overflowWrap: 'anywhere' }}>
            <bdi>{r.name}</bdi>
          </strong>
          <span style={muted}>{roleWords(r.role, tr)}</span>
          {r.onBreak && <StatusBadge size="sm" tone="warn" icon="hourglass" label={tr('ws.activity.onBreak')} />}
        </div>
      ),
    },
    {
      key: 'operator',
      header: tr('ws.activity.columns.operator'),
      render: (r) => <PartCell part={r.operator} surface="operator" staffId={r.staffId} now={now} />,
    },
    {
      key: 'mobile',
      header: tr('ws.activity.columns.mobile'),
      render: (r) => <PartCell part={r.mobile} surface="mobile" staffId={r.staffId} now={now} />,
    },
    {
      key: 'audit',
      header: <span className="tp-sr-only">{tr('ws.activity.audit')}</span>,
      align: 'end',
      width: '9rem',
      render: (r) => (
        <Button
          size="sm"
          kind="ghost"
          icon="shield"
          onClick={() => openAudit(r.staffId)}
          aria-label={tr('ws.activity.auditFor', { name: isolate(r.name) })}
          data-testid={`activity.audit.${r.staffId}`}
        >
          {tr('ws.activity.audit')}
        </Button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minBlockSize: '100%' }} data-testid="activity.screen">
      <PageHeader
        style={{ flexShrink: 0 }}
        title={tr('ws.activity.title')}
        subtitle={tr('ws.activity.lead')}
        actions={
          <>
            {updatedAt && <span style={muted}>{tr('ws.manager.ops.updated', { time: formatTime(updatedAt, locale) })}</span>}
            <Button
              kind="ghost"
              icon="refresh"
              busy={boardQ.isFetching && board !== undefined}
              onClick={() => void queryClient.invalidateQueries({ queryKey: BOARD_KEY })}
              data-testid="activity.refresh"
            >
              {tr('ws.kit.actions.refresh')}
            </Button>
          </>
        }
      />

      <AsyncStateWrapper
        status={status}
        error={boardQ.error}
        onRetry={() => void boardQ.refetch()}
        emptyContent={<EmptyState icon="users" title={tr('ws.activity.empty.title')} body={tr('ws.activity.empty.body')} />}
      >
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', paddingBlockEnd: 'var(--tp-sp-4)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-3)' }}>
            <p style={{ fontSize: 'var(--tp-fs-sm)', margin: 0 }} data-testid="activity.summary">
              {tr('ws.activity.summary', { operator: formatNumber(counts.operator, locale), mobile: formatNumber(counts.mobile, locale) })}
            </p>
            <SegmentedControl<ActivityFilter>
              size="sm"
              value={filter}
              onChange={setFilter}
              aria-label={tr('ws.activity.filters.label')}
              options={[
                { value: 'all', label: tr('ws.activity.filters.all'), testId: 'activity.filter.all' },
                { value: 'online', label: tr('ws.activity.filters.online'), testId: 'activity.filter.online' },
                { value: 'notToday', label: tr('ws.activity.filters.notToday'), testId: 'activity.filter.notToday' },
              ]}
            />
          </div>
          <Panel padded={false}>
            {rows.length === 0 ? (
              <EmptyState kind="filtered" compact onClearFilters={() => setFilter('all')} />
            ) : (
              <>
                <DataTable columns={columns} rows={cap.shown} rowKey={(r) => r.staffId} aria-label={tr('ws.activity.title')} />
                <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} style={{ margin: 'var(--tp-sp-2)' }} />
              </>
            )}
          </Panel>
        </div>
      </AsyncStateWrapper>
    </div>
  );
}

/** One app's half of a person's row. */
function PartCell({ part, surface, staffId, now }: { part: ActivityPart | null; surface: 'operator' | 'mobile'; staffId: string; now: number }) {
  const { tr, locale } = useLocale();
  const word = partWord(part);
  const badge = (
    <StatusBadge
      size="sm"
      tone={WORD_TONE[word]}
      dot={word !== 'never'}
      label={tr(`ws.activity.status.${word}`)}
      title={part ? [part.deviceId && tr('ws.activity.device', { device: part.deviceId }), part.appVersion && `v${part.appVersion}`].filter(Boolean).join(' · ') || undefined : undefined}
    />
  );
  if (!part) {
    return (
      <div data-testid={`activity.${surface}.${staffId}`} data-status="never">
        {badge}
      </div>
    );
  }

  const screenLabel = (() => {
    if (!part.screen) return null;
    if (surface === 'operator') {
      const key = operatorScreenLabelKey(part.screen);
      if (key) return tr(`ws.shell.nav.${key}` as MessageKey);
    }
    return part.screen;
  })();

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start', minInlineSize: 0 }} data-testid={`activity.${surface}.${staffId}`} data-status={word}>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
        {badge}
        <span style={muted} title={formatDateTime(new Date(part.lastSeenAt), locale)}>
          {tr('ws.activity.lastSeen', { time: agoWords(part.lastSeenAt, now, tr, locale) })}
        </span>
      </span>
      {part.lastAction ? (
        <span
          style={{ fontSize: 'var(--tp-fs-sm)', overflowWrap: 'anywhere' }}
          title={part.lastActionAt ? formatDateTime(new Date(part.lastActionAt), locale) : undefined}
          data-testid={`activity.${surface}.${staffId}.action`}
        >
          {part.lastActionAt
            ? tr('ws.activity.lastAction', { action: actionWords(part.lastAction, tr), time: agoWords(part.lastActionAt, now, tr, locale) })
            : actionWords(part.lastAction, tr)}
        </span>
      ) : (
        <span style={muted}>{tr('ws.activity.noAction')}</span>
      )}
      {screenLabel && word !== 'offline' && word !== 'signedOut' && (
        <span style={muted} title={part.screen ?? undefined}>
          {tr('ws.activity.screen', { screen: screenLabel === part.screen ? isolateLtr(screenLabel) : screenLabel })}
        </span>
      )}
    </div>
  );
}
