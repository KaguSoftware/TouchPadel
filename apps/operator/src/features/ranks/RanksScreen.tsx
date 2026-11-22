/**
 * Customers › Player ranks (0364, Majed 2026-10-22; Touch Level and Season Race 0443/0444,
 * 2026-11-16). The views of one page:
 *
 *   Board and results  the results list (app.ranks_desk_results) with Void (manager, owner), the
 *                      public board exactly as players see it (app.ranks_board), and points
 *                      adjusted by hand (owner, app.ranks_adjust).
 *   Levels to check    the players whose confirmed games disagree with the level on record
 *                      (0368, app.customer_level_reviews): confirm the measured level or write
 *                      the player's own claim down as right, either of which clears the row.
 *   Checks             the Level checks list and the results to check (RanksChecks.tsx).
 *   Rules and tiers    the board's switch and size, which results count and how long a report
 *                      may wait (app.set_ranks_settings), the tiers by Touch Level
 *                      (app.set_ranks_levels replaces the list), and every ranking rule
 *                      (RulesEditor.tsx, app.set_ranks_rules).
 *
 * The owner edits; a manager reads the rules and works the results. Ranks are business-wide like
 * loyalty's points, so the rules do not follow the rail's branch; the results list does (the
 * server narrows it to the branches in scope). Every write is online only and re-reads the page.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { VENUE_TZ, formatDate, formatNumber, formatTime, isolate } from '@touch/i18n';
import { useLocale, pickName } from '../../lib/i18n';
import { can, useAuth } from '../../lib/auth';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Switch } from '../../components/Switch';
import { Button, ErrorText, Field, Skeleton, Tabs, inputStyle } from '../../components/ui';
import {
  AsyncStateWrapper,
  EmptyState,
  MessagePresenter,
  PageHeader,
  Panel,
  SegmentedControl,
  StatusBadge,
  TableFrame,
  ViewMore,
  asyncStatus,
  useListCap,
  type Tone,
} from '../../components/kit';
import { CountInput } from '../../components/inputs';
import { NumberField } from '../admin/settings/settingsFields';
import {
  ADJUST_MAX,
  LEVELS_MAX,
  LEVEL_NAME_MAX,
  RESULTS_FILTERS,
  RULE_LIMITS,
  addLevel,
  adjustDelta,
  adjustErrors,
  canEditResult,
  canStaffConfirm,
  canVoidResult,
  decimalTyping,
  levelText,
  levelsDirty,
  levelsDraft,
  levelsErrors,
  levelsPayload,
  levelsValid,
  removeLevel,
  rulesDraft,
  rulesErrors,
  rulesPatch,
  type AdjustDraft,
  type BoardRow,
  type DeskResult,
  type LevelDraft,
  type Headline,
  type RanksAdmin,
  type RanksBoard,
  type RanksLevel,
  type ResultStatus,
  type ResultsFilter,
  type RuleNumberKey,
  type RulesDraft,
} from './ranksLogic';
import {
  adjustRanks,
  invalidateRanks,
  saveRanksLevels,
  saveRanksSettings,
  useRanksAdmin,
  useRanksBoard,
  useRanksResults,
  staffConfirmResult,
} from './useRanks';
import { RanksChecks } from './RanksChecks';
import { RulesEditor, hasRules } from './RulesEditor';
import { Team, VoidDialog } from './resultParts';
import { LevelReviews } from '../players/LevelReviews';
import { PlayerPicker } from './PlayerPicker';
import { RecordResultDialog } from './RecordResultDialog';

const K = 'ws.ranks';

type View = 'board' | 'checks' | 'rules' | 'levels';

const muted: CSSProperties = { margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' };
const hintStyle: CSSProperties = { margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' };
const labelStyle: CSSProperties = { fontSize: 'var(--tp-fs-sm)', fontWeight: 600 };

export function RanksScreen() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const canEdit = can(staff, 'editRanks');
  const canRecord = can(staff, 'recordRanks');
  // 0368: a manager or the owner may confirm a level from here (the desk does
  // it on the customer record, mid-conversation).
  const canJudge = can(staff, 'judgePlayerLevel');
  const { reachable } = useStationReach();
  const [view, setView] = useState<View>('board');
  const [recording, setRecording] = useState(false);
  const board = useRanksBoard();
  const off = board.data?.enabled === false;

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }} data-testid="ranks-screen">
      <PageHeader
        title={tr(`${K}.title`)}
        subtitle={tr(`${K}.lead`)}
        style={{ marginBlockEnd: 0 }}
        actions={
          canRecord ? (
            <Button
              kind="primary"
              icon="trophy"
              disabled={!reachable || off}
              disabledReason={off ? tr(`${K}.board.off`) : undefined}
              onClick={() => setRecording(true)}
              data-testid="ranks-record-open"
            >
              {tr(`${K}.results.record`)}
            </Button>
          ) : undefined
        }
      />
      {!canEdit && <MessagePresenter tone="info" icon="lock" message={tr(`${K}.ownerOnly`)} />}
      <Tabs<View>
        value={view}
        onChange={setView}
        style={{ marginBlockEnd: 0 }}
        items={[
          { id: 'board', label: tr(`${K}.tabs.board`) },
          // 0444: the Level checks and the results where two pairs traded wins.
          { id: 'checks', label: tr(`${K}.tabs.checks`) },
          { id: 'rules', label: tr(`${K}.tabs.rules`) },
          // 0368: the players whose games disagree with their level on record.
          { id: 'levels', label: tr(`${K}.tabs.levels`) },
        ]}
      />
      {view === 'board' ? (
        <BoardView canEdit={canEdit} />
      ) : view === 'checks' ? (
        <RanksChecks />
      ) : view === 'rules' ? (
        <RulesView canEdit={canEdit} />
      ) : (
        <LevelReviews canJudge={canJudge} tz={VENUE_TZ} />
      )}
      {recording && <RecordResultDialog onClose={() => setRecording(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board and results
// ---------------------------------------------------------------------------

function BoardView({ canEdit }: { canEdit: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '2 1 34rem', minInlineSize: 0 }}>
        <ResultsPanel />
      </div>
      <div style={{ flex: '1 1 20rem', display: 'grid', gap: 'var(--tp-sp-4)', minInlineSize: 0 }}>
        <BoardPreview />
        {canEdit && <AdjustPanel />}
      </div>
    </div>
  );
}

const STATUS_TONE: Record<ResultStatus, Tone> = {
  pending: 'warn',
  confirmed: 'neutral',
  rejected: 'neutral',
  expired: 'neutral',
  voided: 'danger',
};

/**
 * The results list. A manager or the owner voids; the desk and up confirm a player's report
 * waiting on an opponent and correct a result (0444, Majed 2026-11-16: "the operator can confirm /
 * edit / set").
 */
export function ResultsPanel() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const canVoid = can(staff, 'voidRanks');
  const canFix = can(staff, 'recordRanks');
  const [filter, setFilter] = useState<ResultsFilter>('all');
  const [voiding, setVoiding] = useState<DeskResult | null>(null);
  const [editing, setEditing] = useState<DeskResult | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; error: unknown } | null>(null);

  async function confirmRow(r: DeskResult) {
    setConfirming(r.id);
    setRowError(null);
    try {
      await staffConfirmResult(r.id);
      invalidateRanks(qc);
      toast.ok(tr(`${K}.results.confirmedToast`));
    } catch (e) {
      setRowError({ id: r.id, error: e });
    } finally {
      setConfirming(null);
    }
  }
  const q = useRanksResults(filter);
  const rows = q.data ?? [];
  const cap = useListCap(rows);
  const status = asyncStatus(q, (d) => d.length === 0);

  return (
    <Panel title={tr(`${K}.results.title`)} data-testid="ranks-results">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <div>
          <SegmentedControl<ResultsFilter>
            size="sm"
            aria-label={tr(`${K}.results.filterLabel`)}
            value={filter}
            onChange={setFilter}
            options={RESULTS_FILTERS.map((f) => ({
              value: f,
              label: tr(`${K}.results.filter.${f}`),
              testId: `ranks-filter-${f}`,
            }))}
          />
        </div>
        <AsyncStateWrapper
          status={status}
          error={q.error}
          onRetry={() => void q.refetch()}
          skeleton={<Skeleton lines={4} />}
          emptyContent={
            <EmptyState compact icon="trophy" titleAs="h3" title={tr(`${K}.results.empty.${filter}`)} />
          }
        >
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {cap.shown.map((r, i) => (
              <ResultRow
                key={r.id}
                r={r}
                first={i === 0}
                canVoid={canVoid}
                onVoid={() => setVoiding(r)}
                canConfirm={canFix && canStaffConfirm(r)}
                offline={!reachable}
                confirming={confirming === r.id}
                onConfirm={() => void confirmRow(r)}
                canEdit={canFix && canEditResult(r)}
                onEdit={() => setEditing(r)}
                error={rowError?.id === r.id ? rowError.error : null}
              />
            ))}
          </ol>
          <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
        </AsyncStateWrapper>
      </div>
      {voiding && <VoidDialog result={voiding} onClose={() => setVoiding(null)} />}
      {editing && <RecordResultDialog edit={editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function ResultRow({
  r,
  first,
  canVoid,
  onVoid,
  canConfirm = false,
  confirming = false,
  onConfirm,
  canEdit = false,
  onEdit,
  error = null,
  offline = false,
}: {
  r: DeskResult;
  first: boolean;
  canVoid: boolean;
  onVoid: () => void;
  canConfirm?: boolean;
  confirming?: boolean;
  onConfirm?: () => void;
  canEdit?: boolean;
  onEdit?: () => void;
  error?: unknown;
  offline?: boolean;
}) {
  const { tr, locale } = useLocale();
  const played = new Date(r.played_at);
  const meta = [
    `${formatDate(played, locale)} ${formatTime(played, locale)}`,
    r.court ? pickName(locale, r.court) : tr(`${K}.results.noBooking`),
    tr(`${K}.results.source.${r.source}`),
  ];
  return (
    <li
      data-testid={`ranks-result-${r.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 'var(--tp-sp-1) var(--tp-sp-4)',
        alignItems: 'center',
        paddingBlock: 'var(--tp-sp-3)',
        borderBlockStart: first ? undefined : '1px solid var(--tp-border)',
      }}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          <Team players={r.a} won={r.winner === 'a'} />
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr(`${K}.results.versus`)}</span>
          <Team players={r.b} won={r.winner === 'b'} />
          {r.winner === 'draw' && <StatusBadge size="sm" tone="neutral" dot={false} label={tr(`${K}.results.draw`)} />}
        </div>
        <p style={hintStyle}>
          <bdi>{meta.join(' · ')}</bdi>
        </p>
        {r.status === 'voided' && r.void_reason && (
          <p style={{ ...hintStyle, color: 'var(--tp-danger-fg)' }}>
            {tr(`${K}.results.voidReason`, { reason: isolate(r.void_reason) })}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {r.score && (
          <span dir="ltr" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {r.score}
          </span>
        )}
        {r.status !== 'confirmed' && (
          <StatusBadge size="sm" tone={STATUS_TONE[r.status]} label={tr(`${K}.results.status.${r.status}`)} />
        )}
        {canConfirm && (
          <Button
            size="sm"
            icon="check"
            busy={confirming}
            disabled={offline}
            title={tr(`${K}.results.confirmHint`)}
            onClick={onConfirm}
            data-testid={`ranks-confirm-${r.id}`}
          >
            {tr(`${K}.results.confirm`)}
          </Button>
        )}
        {canEdit && (
          <Button size="sm" kind="ghost" icon="note" onClick={onEdit} data-testid={`ranks-edit-${r.id}`}>
            {tr(`${K}.results.edit`)}
          </Button>
        )}
        {canVoid && canVoidResult(r) && (
          <Button size="sm" kind="ghost" icon="ban" onClick={onVoid} data-testid={`ranks-void-${r.id}`}>
            {tr(`${K}.results.void`)}
          </Button>
        )}
      </div>
      {error ? <ErrorText error={error} style={{ marginBlock: 0, gridColumn: '1 / -1' }} /> : null}
    </li>
  );
}

/** One line of whichever board leads, as the preview draws it. */
interface PreviewLine {
  rank: number;
  name: string | null;
  tier: RanksLevel | null;
  /** The Touch Level, null while the owner hides it. */
  level: number | null;
  /** Race points; absent on the Touch Level board. */
  points: number | null;
}

/**
 * The lines of the board that leads (0444: the owner's headline switch). A server before 0444
 * sends only `rows` (0364's points board).
 */
function previewLines(b: Extract<RanksBoard, { enabled: true }>): { lead: Headline; lines: PreviewLine[] } {
  if (b.headline === 'level' && b.level) {
    return { lead: 'level', lines: b.level.map((r) => ({ rank: r.rank, name: r.name, tier: r.tier, level: r.level, points: null })) };
  }
  if (b.race) {
    return { lead: 'race', lines: b.race.map((r) => ({ rank: r.rank, name: r.name, tier: r.tier, level: r.level, points: r.points })) };
  }
  return { lead: 'race', lines: b.rows.map((r: BoardRow) => ({ rank: r.rank, name: r.name, tier: r.level, level: null, points: r.points })) };
}

function BoardPreview() {
  const { tr, locale } = useLocale();
  const q = useRanksBoard();
  const b = q.data;
  const shown = b && b.enabled ? previewLines(b) : null;
  const rows = shown?.lines ?? [];
  const cap = useListCap(rows);
  const status = q.isError && !b ? 'error' : !b ? 'loading' : 'ready';

  return (
    <Panel title={tr(`${K}.board.title`)} data-testid="ranks-board">
      <AsyncStateWrapper status={status} error={q.error} onRetry={() => void q.refetch()} skeleton={<Skeleton lines={4} />}>
        {b && !b.enabled && <p style={muted}>{tr(`${K}.board.off`)}</p>}
        {b && b.enabled && shown && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
            <p style={muted}>
              {[
                b.headline ? tr(`${K}.board.${shown.lead === 'level' ? 'leadsLevel' : 'leadsRace'}`) : null,
                shown.lead === 'race' ? tr(`${K}.board.${b.period}`) : null,
                shown.lead === 'race' && b.from ? tr(`${K}.board.since`, { date: formatDate(new Date(b.from), locale) }) : null,
                tr(`${K}.board.top`, { count: formatNumber(b.size, locale) }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {rows.length === 0 ? (
              <p style={muted}>{tr(`${K}.board.${shown.lead === 'level' ? 'levelEmpty' : 'empty'}`)}</p>
            ) : (
              <>
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }} data-testid={`ranks-board-${shown.lead}`}>
                  {cap.shown.map((r, i) => (
                    <BoardLine key={`${r.rank}-${i}`} row={r} />
                  ))}
                </ol>
                <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} style={{ marginBlockStart: 0 }} />
              </>
            )}
          </div>
        )}
      </AsyncStateWrapper>
    </Panel>
  );
}

function BoardLine({ row }: { row: PreviewLine }) {
  const { tr, locale } = useLocale();
  const podium = row.rank <= 3;
  const sub = [row.tier?.name_en ? pickName(locale, row.tier) : null, row.level !== null && row.points !== null ? tr(`${K}.board.level`, { level: levelText(row.level) }) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: '2rem minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 'var(--tp-sp-3)',
        paddingBlock: 'var(--tp-sp-1-5)',
      }}
    >
      <span
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          inlineSize: '1.75rem',
          blockSize: '1.75rem',
          borderRadius: '50%',
          fontWeight: 700,
          fontSize: 'var(--tp-fs-sm)',
          fontVariantNumeric: 'tabular-nums',
          background: podium ? 'var(--tp-accent-soft)' : undefined,
          color: podium ? 'var(--tp-accent-soft-fg)' : 'var(--tp-muted-fg)',
        }}
      >
        {formatNumber(row.rank, locale)}
      </span>
      <span style={{ display: 'grid', minInlineSize: 0 }}>
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <bdi>{row.name ?? tr(`${K}.board.unnamed`)}</bdi>
        </span>
        {sub && <span style={hintStyle}>{sub}</span>}
      </span>
      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {row.points !== null ? (
          tr(`${K}.points`, { points: formatNumber(row.points, locale) })
        ) : row.level !== null ? (
          <bdi dir="ltr">{levelText(row.level)}</bdi>
        ) : null}
      </span>
    </li>
  );
}

function AdjustPanel() {
  const { tr } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const blank: AdjustDraft = { player: null, sign: 'add', amount: 1, note: '' };
  const [d, setD] = useState<AdjustDraft>(blank);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errors = touched ? adjustErrors(d) : [];
  const A = `${K}.adjust` as const;

  async function submit() {
    setTouched(true);
    if (adjustErrors(d).length > 0 || !d.player) return;
    setBusy(true);
    setError(null);
    try {
      await adjustRanks(d.player.id, adjustDelta(d), d.note);
      invalidateRanks(qc);
      toast.ok(tr(`${A}.done`, { name: isolate(d.player.name) }));
      setD(blank);
      setTouched(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={tr(`${A}.title`)} data-testid="ranks-adjust">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <p style={muted}>{tr(`${A}.lead`)}</p>
        <PlayerPicker
          label={tr(`${A}.player`)}
          value={d.player}
          onChange={(player) => setD((x) => ({ ...x, player }))}
          disabled={busy}
          invalid={errors.includes('player')}
          testId="ranks-adjust-player"
        />
        <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            <span id="ranks-adjust-direction" style={labelStyle}>
              {tr(`${A}.direction`)}
            </span>
            <SegmentedControl<'add' | 'remove'>
              aria-labelledby="ranks-adjust-direction"
              value={d.sign}
              onChange={(sign) => setD((x) => ({ ...x, sign }))}
              options={[
                { value: 'add', label: tr(`${A}.add`), icon: 'plus', testId: 'ranks-adjust-add' },
                { value: 'remove', label: tr(`${A}.remove`), icon: 'minus', testId: 'ranks-adjust-remove' },
              ]}
            />
          </div>
          <label style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            <span style={labelStyle}>{tr(`${A}.amount`)}</span>
            <CountInput
              value={d.amount}
              min={1}
              max={ADJUST_MAX}
              disabled={busy}
              onChange={(amount) => setD((x) => ({ ...x, amount }))}
            />
          </label>
        </div>
        <Field
          label={tr(`${A}.reason`)}
          hint={tr(`${A}.reasonHint`)}
          error={errors.includes('reason') ? tr(`${A}.errorReason`) : undefined}
          style={{ marginBlockEnd: 0 }}
        >
          <input
            style={inputStyle}
            value={d.note}
            maxLength={200}
            disabled={busy}
            onChange={(e) => setD((x) => ({ ...x, note: e.target.value }))}
            data-testid="ranks-adjust-reason"
          />
        </Field>
        {errors.includes('player') && <p style={{ ...hintStyle, color: 'var(--tp-danger-fg)' }}>{tr(`${A}.errorPlayer`)}</p>}
        <ErrorText error={error} style={{ marginBlock: 0 }} />
        <div>
          <Button busy={busy} disabled={!reachable} onClick={() => void submit()} data-testid="ranks-adjust-submit">
            {tr(`${A}.submit`)}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Rules and levels
// ---------------------------------------------------------------------------

function RulesView({ canEdit }: { canEdit: boolean }) {
  const q = useRanksAdmin();
  const status = q.isError && !q.data ? 'error' : q.data ? 'ready' : 'loading';
  return (
    <AsyncStateWrapper status={status} error={q.error} onRetry={() => void q.refetch()} skeleton={<Skeleton lines={8} />}>
      {q.data && <RulesBody data={q.data} canEdit={canEdit} />}
    </AsyncStateWrapper>
  );
}

function RulesBody({ data, canEdit }: { data: RanksAdmin; canEdit: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <div
        style={{
          display: 'grid',
          gap: 'var(--tp-sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 26rem), 1fr))',
          alignItems: 'start',
        }}
      >
        <RulesPanel key={JSON.stringify(data.settings)} saved={rulesDraft(data.settings)} canEdit={canEdit} />
        <LevelsPanel key={JSON.stringify(data.levels)} saved={data.levels} canEdit={canEdit} />
      </div>
      {/* 0444: every Touch Level and Season Race rule. An older server sends none. */}
      {hasRules(data) && <RulesEditor data={data} canEdit={canEdit} />}
    </div>
  );
}

/** − n + for a small whole number, clamped to the rule's range. */
function PointStepper({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (n: number) => void;
  testId: string;
}) {
  const { tr } = useLocale();
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }} data-testid={testId}>
      <span style={labelStyle}>{label}</span>
      <span role="group" aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
        <Button
          size="sm"
          icon="minus"
          aria-label={`${label}: ${tr(`${K}.rules.less`)}`}
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        />
        <CountInput
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={onChange}
          style={{ textAlign: 'center', fontWeight: 700 }}
        />
        <Button
          size="sm"
          icon="plus"
          aria-label={`${label}: ${tr(`${K}.rules.more`)}`}
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        />
      </span>
    </div>
  );
}

function RulesPanel({ saved, canEdit }: { saved: RulesDraft; canEdit: boolean }) {
  const { tr } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const [d, setD] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const R = `${K}.rules` as const;
  const errors = rulesErrors(d);
  const patch = rulesPatch(d, saved);
  const dirty = Object.keys(patch).length > 0;
  const set = <F extends keyof RulesDraft>(f: F, v: RulesDraft[F]) => setD((x) => ({ ...x, [f]: v }));
  const readOnly = !canEdit || busy;
  const range = (k: RuleNumberKey) =>
    errors[k] ? tr(`${R}.range`, { min: String(RULE_LIMITS[k].min), max: String(RULE_LIMITS[k].max) }) : undefined;

  async function save() {
    if (Object.keys(errors).length > 0 || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      await saveRanksSettings(patch);
      invalidateRanks(qc);
      toast.ok(tr(`${K}.saved`));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const section: CSSProperties = {
    display: 'grid',
    gap: 'var(--tp-sp-2)',
    paddingBlockStart: 'var(--tp-sp-4)',
    borderBlockStart: '1px solid var(--tp-border)',
  };

  return (
    <Panel title={tr(`${R}.title`)} data-testid="ranks-rules">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <Switch checked={d.enabled} onChange={(v) => set('enabled', v)} label={tr(`${R}.enabled`)} disabled={readOnly} />
          <p style={hintStyle}>{tr(`${R}.enabledHint`)}</p>
        </div>

        <div style={section}>
          <PointStepper
            label={tr(`${R}.boardSize`)}
            value={d.board_size}
            min={RULE_LIMITS.board_size.min}
            max={RULE_LIMITS.board_size.max}
            disabled={readOnly}
            onChange={(n) => set('board_size', n)}
            testId="ranks-rule-board_size"
          />
          <p style={hintStyle}>{tr(`${R}.boardSizeHint`)}</p>
        </div>

        <div style={section}>
          <span style={labelStyle}>{tr(`${R}.sources`)}</span>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            <Switch
              checked={d.count_reported}
              onChange={(v) => set('count_reported', v)}
              label={tr(`${R}.countReported`)}
              disabled={readOnly}
            />
            <p style={hintStyle}>{tr(`${R}.countReportedHint`)}</p>
          </div>
          <Switch
            checked={d.count_tournaments}
            onChange={(v) => set('count_tournaments', v)}
            label={tr(`${R}.countTournaments`)}
            disabled={readOnly}
          />
          {d.count_reported && (
            <div style={{ marginBlockStart: 'var(--tp-sp-2)' }}>
              <NumberField
                label={tr(`${R}.reportHours`)}
                hint={tr(`${R}.reportHoursHint`)}
                unit={tr(`${R}.unitHours`)}
                value={Number.isNaN(d.report_hours) ? '' : String(d.report_hours)}
                onChange={(v) => set('report_hours', v === '' ? NaN : Number(v))}
                error={range('report_hours')}
              />
            </div>
          )}
        </div>

        <ErrorText error={error} style={{ marginBlock: 0 }} />
        {canEdit && (
          <div>
            <Button
              kind="primary"
              busy={busy}
              disabled={!dirty || !reachable || Object.keys(errors).length > 0}
              onClick={() => void save()}
              data-testid="ranks-rules-save"
            >
              {tr(`${R}.saveRules`)}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function LevelsPanel({ saved, canEdit }: { saved: RanksLevel[]; canEdit: boolean }) {
  const { tr } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const [rows, setRows] = useState<LevelDraft[]>(() => levelsDraft(saved));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const L = `${K}.levels` as const;
  const check = useMemo(() => levelsErrors(rows), [rows]);
  const shown = touched ? check : { rows: {}, count: false };
  const dirty = levelsDirty(rows, saved);
  const readOnly = !canEdit || busy;
  const anyNames = Object.values(shown.rows).some((e) => e.includes('names'));
  const anyLevel = Object.values(shown.rows).some((e) => e.includes('level'));
  const update = (key: string, patch: Partial<LevelDraft>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    setTouched(true);
    if (!levelsValid(levelsErrors(rows))) return;
    setBusy(true);
    setError(null);
    try {
      await saveRanksLevels(levelsPayload(rows));
      invalidateRanks(qc);
      toast.ok(tr(`${K}.saved`));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const bad = (key: string, kind: 'names' | 'level'): CSSProperties =>
    shown.rows[key]?.includes(kind) ? { borderColor: 'var(--tp-danger-mark)' } : {};

  return (
    <Panel
      title={tr(`${L}.title`)}
      data-testid="ranks-levels"
      actions={
        canEdit ? (
          <Button
            size="sm"
            icon="plus"
            disabled={readOnly || rows.length >= LEVELS_MAX}
            disabledReason={rows.length >= LEVELS_MAX ? tr(`${L}.max`) : undefined}
            onClick={() => setRows((rs) => addLevel(rs))}
            data-testid="ranks-level-add"
          >
            {tr(`${L}.add`)}
          </Button>
        ) : undefined
      }
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <p style={muted}>{tr(`${L}.lead`)}</p>
        <TableFrame>
        <table className="tp-table" style={{ tableLayout: 'fixed', inlineSize: '100%' }}>
          <colgroup>
            <col />
            <col />
            <col style={{ inlineSize: '8.5rem' }} />
            {canEdit && <col style={{ inlineSize: '2.75rem' }} />}
          </colgroup>
          <thead>
            <tr>
              <th>{tr(`${L}.nameEn`)}</th>
              <th>{tr(`${L}.nameAr`)}</th>
              <th>{tr(`${L}.from`)}</th>
              {canEdit && <th aria-hidden="true" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} data-testid={`ranks-level-${i}`}>
                <td>
                  <input
                    style={{ ...inputStyle, ...bad(r.key, 'names') }}
                    dir="ltr"
                    aria-label={`${tr(`${L}.nameEn`)} ${i + 1}`}
                    value={r.name_en}
                    maxLength={LEVEL_NAME_MAX}
                    disabled={readOnly}
                    onChange={(e) => update(r.key, { name_en: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    style={{ ...inputStyle, ...bad(r.key, 'names') }}
                    dir="rtl"
                    lang="ar"
                    aria-label={`${tr(`${L}.nameAr`)} ${i + 1}`}
                    value={r.name_ar}
                    maxLength={LEVEL_NAME_MAX}
                    disabled={readOnly}
                    onChange={(e) => update(r.key, { name_ar: e.target.value })}
                  />
                </td>
                <td>
                  {i === 0 ? (
                    <span style={{ display: 'grid' }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{levelText(0)}</span>
                      <span style={hintStyle}>{tr(`${L}.base`)}</span>
                    </span>
                  ) : (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
                      <input
                        style={{
                          ...inputStyle,
                          ...bad(r.key, 'level'),
                          inlineSize: '5rem',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                        dir="ltr"
                        inputMode="decimal"
                        aria-label={`${tr(`${L}.from`)} ${i + 1}`}
                        value={r.min}
                        disabled={readOnly}
                        onChange={(e) => update(r.key, { min: decimalTyping(e.target.value, false).slice(0, 4) })}
                      />
                    </span>
                  )}
                </td>
                {canEdit && (
                  <td>
                    {i > 0 && (
                      <Button
                        size="sm"
                        kind="ghost"
                        icon="trash"
                        aria-label={tr(`${L}.remove`)}
                        title={tr(`${L}.remove`)}
                        disabled={readOnly}
                        onClick={() => setRows((rs) => removeLevel(rs, r.key))}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </TableFrame>
        {anyNames && <p style={{ ...hintStyle, color: 'var(--tp-danger-fg)' }}>{tr(`${L}.errorNames`)}</p>}
        {anyLevel && <p style={{ ...hintStyle, color: 'var(--tp-danger-fg)' }}>{tr(`${L}.errorLevel`)}</p>}
        <ErrorText error={error} style={{ marginBlock: 0 }} />
        {canEdit && (
          <div>
            <Button
              kind="primary"
              busy={busy}
              disabled={!dirty || !reachable}
              onClick={() => void save()}
              data-testid="ranks-levels-save"
            >
              {tr(`${L}.saveLevels`)}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
