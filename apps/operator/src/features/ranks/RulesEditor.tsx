/**
 * Ranks › Rules and tiers › Ranking rules (0443/0444; plan docs/design/ranks/plan-2026-11-13.md
 * §9a, Majed 2026-11-16: "everything we set here can be changed in the operator").
 *
 * Every rule of the Touch Level and the Season Race, grouped the way the owner thinks about
 * them: the boards, where players start, how a game moves the level (folded away: the maths),
 * the Touch Level board's gate, Level checks, the Season Race and the boosts. A changed rule
 * shows its default with "Back to default"; one Save sends the whole set of changes to
 * app.set_ranks_rules (which replaces the overrides, so a rule put back to its default is
 * simply left out) and, when the season length changed, that one ranks_settings column to
 * set_ranks_settings. A change to a rule that moves levels asks first, because the server
 * replays every player's level from all past games.
 *
 * The owner edits; a manager reads the same page with every control off.
 */
import { useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDate, formatNumber, formatTime } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { Switch } from '../../components/Switch';
import { Button, ErrorText, inputStyle } from '../../components/ui';
import { Panel, SegmentedControl } from '../../components/kit';
import {
  CHECK_ROLES,
  NUMBER_RULES,
  OFFPEAK_MAX,
  addOffpeak,
  changedRules,
  decimalTyping,
  defaultText,
  isDefaultRule,
  rescoresLevels,
  resetRule,
  rulesCheck,
  rulesCheckValid,
  rulesEditDraft,
  rulesOverrides,
  toggleOffpeakDay,
  type CheckRole,
  type Headline,
  type NumberRuleKey,
  type OffpeakDraft,
  type RanksAdmin,
  type RanksPeriod,
  type RanksRules,
  type RuleKey,
  type RulesEditDraft,
} from './ranksLogic';
import { invalidateRanks, saveRanksRules, saveRanksSettings } from './useRanks';

const K = 'ws.ranks';
const E = 'ws.ranks.editor';

type Unit = 'days' | 'games' | 'points' | 'times' | 'opponents' | 'results';

/** The word written after a number box, so "30" is never read as games when it means days. */
const UNIT: Partial<Record<NumberRuleKey, Unit>> = {
  improved_days: 'days',
  improved_min_games: 'games',
  provisional_games: 'games',
  settling_games: 'games',
  trust_tournament: 'times',
  trust_desk: 'times',
  trust_player: 'times',
  repeat_days: 'days',
  soft_loss_factor: 'times',
  return_games: 'games',
  reliable_games: 'games',
  reliable_days: 'days',
  reliable_opponents: 'opponents',
  inactive_days: 'days',
  check_days: 'days',
  race_win: 'points',
  race_strength_max: 'times',
  race_loss: 'points',
  race_draw: 'points',
  race_best_matches: 'results',
  race_best_tournaments: 'results',
  t_first: 'points',
  t_second: 'points',
  t_semi: 'points',
  t_top_half: 'points',
  t_played: 'points',
  boost_offpeak: 'times',
  boost_event: 'times',
  boost_welcome: 'times',
  boost_max_per_season: 'results',
};

/** The cross-field checks' messages: the tournament places share one. */
const ORDER_MESSAGE: Partial<Record<NumberRuleKey, 'class_a_from' | 'level_max' | 'repeat_zero_from' | 'settling_games' | 'place'>> = {
  class_a_from: 'class_a_from',
  level_max: 'level_max',
  repeat_zero_from: 'repeat_zero_from',
  settling_games: 'settling_games',
  t_second: 'place',
  t_semi: 'place',
  t_top_half: 'place',
  t_played: 'place',
};

/** Saturday first: the week as Baghdad lives it. Values stay the server's 0 = Sunday. */
const WEEK: readonly number[] = [6, 0, 1, 2, 3, 4, 5];

/** Every half hour; the end list runs to midnight ('24:00'). */
const HALF_HOURS: readonly string[] = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const END_TIMES: readonly string[] = [...HALF_HOURS.slice(1), '24:00'];

const hint: CSSProperties = { margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' };
const label: CSSProperties = { fontSize: 'var(--tp-fs-sm)', fontWeight: 600 };

/** Is this an older server without 0444's rules? Then the editor is not drawn at all. */
export function hasRules(data: RanksAdmin): data is RanksAdmin & { rules: RanksRules; defaults: RanksRules } {
  return Boolean(data.rules && data.defaults);
}

export function RulesEditor({ data, canEdit }: { data: RanksAdmin & { rules: RanksRules; defaults: RanksRules }; canEdit: boolean }) {
  // Remounted on a fresh read (the key), so the draft always starts from what is in force.
  return <RulesEditorBody key={JSON.stringify([data.rules, data.settings.period])} data={data} canEdit={canEdit} />;
}

function RulesEditorBody({ data, canEdit }: { data: RanksAdmin & { rules: RanksRules; defaults: RanksRules }; canEdit: boolean }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { reachable } = useStationReach();
  const saved = useMemo(() => rulesEditDraft(data.rules, data.settings.period), [data.rules, data.settings.period]);
  const [d, setD] = useState<RulesEditDraft>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [serverKey, setServerKey] = useState<NumberRuleKey | null>(null);
  const defaults = data.defaults;
  const check = useMemo(() => rulesCheck(d), [d]);
  const valid = rulesCheckValid(check, d);
  const changed = changedRules(d, data.rules);
  const periodChanged = d.period !== data.settings.period;
  const dirty = changed.length > 0 || periodChanged;
  const readOnly = !canEdit || busy;

  const edit = (next: RulesEditDraft) => {
    setD(next);
    setServerKey(null);
  };
  const setNum = (k: NumberRuleKey, raw: string) => edit({ ...d, nums: { ...d.nums, [k]: decimalTyping(raw, NUMBER_RULES[k].whole) } });

  function fieldError(k: NumberRuleKey): string | undefined {
    const e = check.fields[k];
    const { min, max } = NUMBER_RULES[k];
    if (e === 'range' && !NUMBER_RULES[k].whole) return tr(`${E}.error.range`, { min: String(min), max: String(max) });
    if (e === 'range' || e === 'whole') return tr(`${E}.error.whole`, { min: String(min), max: String(max) });
    if (e === 'order') {
      const m = ORDER_MESSAGE[k];
      return m ? tr(`${E}.error.${m}`) : undefined;
    }
    if (serverKey === k) return tr(`${E}.serverRefused`);
    return undefined;
  }

  async function save() {
    if (!valid || !dirty || readOnly) return;
    if (rescoresLevels(changed)) {
      const yes = await confirm({
        title: tr(`${E}.confirmTitle`),
        body: tr(`${E}.confirmBody`),
        confirmLabel: tr(`${E}.confirmSave`),
        kind: 'primary',
      });
      if (!yes) return;
    }
    setBusy(true);
    setError(null);
    setServerKey(null);
    try {
      if (periodChanged) await saveRanksSettings({ period: d.period });
      if (changed.length > 0) await saveRanksRules(rulesOverrides(d, defaults));
      invalidateRanks(qc);
      toast.ok(tr(`${E}.saved`));
    } catch (e) {
      setError(e);
      if (e instanceof AppRpcError && e.code === 'INVALID_VALUE' && e.details && e.details in NUMBER_RULES) {
        setServerKey(e.details as NumberRuleKey);
      }
    } finally {
      setBusy(false);
    }
  }

  /** The default line under a changed rule: the default, and the way back to it (owner only). */
  const defaultLine = (key: RuleKey, value: string) =>
    isDefaultRule(d, key, defaults) ? null : (
      <DefaultLine value={value} canReset={!readOnly} onReset={() => edit(resetRule(d, key, defaults))} testId={`ranks-rule-reset-${key}`} />
    );

  const num = (k: NumberRuleKey) => (
    <NumberRow
      key={k}
      k={k}
      value={d.nums[k]}
      unit={UNIT[k]}
      disabled={readOnly}
      error={fieldError(k)}
      onChange={(raw) => setNum(k, raw)}
      footer={defaultLine(k, defaultText(k, defaults))}
    />
  );

  const rb = data.rebuild;

  return (
    <Panel title={tr(`${E}.title`)} data-testid="ranks-rules-editor">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-5)' }}>
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', maxInlineSize: '70ch' }}>{tr(`${E}.lead`)}</p>

        <Section id="boards" title={tr(`${E}.sections.boards.title`)} lead={tr(`${E}.sections.boards.lead`)}>
          <Row
            title={tr(`${K}.rule.headline.label`)}
            help={tr(`${K}.rule.headline.hint`)}
            footer={defaultLine('headline', tr(`${E}.headline.${defaults.headline}`))}
            control={
              <SegmentedControl<Headline>
                size="sm"
                aria-label={tr(`${K}.rule.headline.label`)}
                value={d.headline}
                onChange={(v) => !readOnly && edit({ ...d, headline: v })}
                options={(['race', 'level'] as const).map((v) => ({
                  value: v,
                  label: tr(`${E}.headline.${v}`),
                  disabled: readOnly,
                  testId: `ranks-rule-headline-${v}`,
                }))}
              />
            }
          />
          <Row
            title={tr(`${K}.rule.show_level.label`)}
            help={tr(`${K}.rule.show_level.hint`)}
            footer={defaultLine('show_level', tr(`${E}.${defaults.show_level ? 'on' : 'off'}`))}
            control={
              <Switch
                checked={d.show_level}
                onChange={(v) => edit({ ...d, show_level: v })}
                label={tr(`${K}.rule.show_level.label`)}
                hideLabel
                disabled={readOnly}
              />
            }
          />
          {num('class_b_from')}
          {num('class_a_from')}
          {num('improved_days')}
          {num('improved_min_games')}
        </Section>

        <Section id="start" title={tr(`${E}.sections.start.title`)} lead={tr(`${E}.sections.start.lead`)}>
          <SubHead>{tr(`${E}.startCheck`)}</SubHead>
          {(['start_a', 'start_b', 'start_c', 'start_new'] as const).map(num)}
          <SubHead>{tr(`${E}.startSignup`)}</SubHead>
          {(['self_advanced', 'self_intermediate', 'self_beginner', 'self_new', 'start_unknown'] as const).map(num)}
        </Section>

        <details data-testid="ranks-rules-moves" style={{ display: 'grid' }}>
          <summary
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--tp-sp-2)',
              paddingBlock: 'var(--tp-sp-2)',
              borderBlockStart: '1px solid var(--tp-border)',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-md)', fontWeight: 700, display: 'inline' }}>{tr(`${E}.sections.moves.title`)}</h3>
            {changed.some((k) => MOVES.includes(k as NumberRuleKey)) && <ChangedDot label={tr(`${E}.unsaved`)} />}
          </summary>
          <div style={{ display: 'grid', gap: 0, paddingBlockStart: 'var(--tp-sp-2)' }}>
            <p style={{ ...hint, fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-2)', maxInlineSize: '70ch' }}>{tr(`${E}.sections.moves.lead`)}</p>
            {MOVES.map(num)}
          </div>
        </details>

        <Section id="levelBoard" title={tr(`${E}.sections.levelBoard.title`)} lead={tr(`${E}.sections.levelBoard.lead`)}>
          {(['reliable_games', 'reliable_days', 'reliable_opponents', 'inactive_days'] as const).map(num)}
        </Section>

        <Section id="checks" title={tr(`${E}.sections.checks.title`)} lead={tr(`${E}.sections.checks.lead`)}>
          <Row
            title={tr(`${K}.rule.check_roles.label`)}
            help={tr(`${K}.rule.check_roles.hint`)}
            footer={defaultLine(
              'check_roles',
              defaults.check_roles.length ? defaults.check_roles.map((r) => tr(`${E}.role.${r}`)).join(' · ') : tr(`${E}.noneShort`),
            )}
            control={
              <RoleChecks
                value={d.check_roles}
                disabled={readOnly}
                label={tr(`${K}.rule.check_roles.label`)}
                onChange={(check_roles) => edit({ ...d, check_roles })}
              />
            }
          />
          {num('check_days')}
          {num('check_max_change')}
        </Section>

        <Section id="race" title={tr(`${E}.sections.race.title`)} lead={tr(`${E}.sections.race.lead`)}>
          <Row
            title={tr(`${K}.rule.period.label`)}
            help={tr(`${K}.rule.period.hint`)}
            control={
              <SegmentedControl<RanksPeriod>
                size="sm"
                aria-label={tr(`${K}.rule.period.label`)}
                value={d.period}
                onChange={(v) => !readOnly && edit({ ...d, period: v })}
                options={(['quarter', 'month', 'all'] as const).map((v) => ({
                  value: v,
                  label: tr(`${E}.period.${v}`),
                  disabled: readOnly,
                  testId: `ranks-period-${v}`,
                }))}
              />
            }
          />
          {(['race_win', 'race_strength_max', 'race_loss', 'race_draw', 'race_best_matches', 'race_best_tournaments'] as const).map(num)}
          <SubHead hint={tr(`${E}.racePlacesHint`)}>{tr(`${E}.racePlaces`)}</SubHead>
          {(['t_first', 't_second', 't_semi', 't_top_half', 't_played'] as const).map(num)}
        </Section>

        <Section id="boosts" title={tr(`${E}.sections.boosts.title`)} lead={tr(`${E}.sections.boosts.lead`)}>
          <OffpeakEditor
            windows={d.offpeak}
            errors={check.offpeak}
            disabled={readOnly}
            onChange={(offpeak) => edit({ ...d, offpeak })}
            footer={defaultLine('offpeak', tr(`${E}.noneShort`))}
          />
          {(['boost_offpeak', 'boost_event', 'boost_welcome', 'boost_max_per_season'] as const).map(num)}
        </Section>

        {rb?.at && (
          <p style={hint} data-testid="ranks-rules-rebuilt">
            {tr(`${E}.rebuilt`, {
              date: `${formatDate(new Date(rb.at), locale)} ${formatTime(new Date(rb.at), locale)}`,
              results: formatNumber(rb.results ?? 0, locale),
              ms: formatNumber(rb.ms ?? 0, locale),
            })}
          </p>
        )}

        {canEdit && (
          <div
            style={{
              position: 'sticky',
              insetBlockEnd: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--tp-sp-3)',
              flexWrap: 'wrap',
              paddingBlock: 'var(--tp-sp-3)',
              borderBlockStart: '1px solid var(--tp-border)',
              background: 'var(--tp-panel-body)',
            }}
          >
            <Button
              kind="primary"
              busy={busy}
              disabled={!dirty || !valid || !reachable}
              disabledReason={dirty && !valid ? tr(`${E}.errorFix`) : undefined}
              onClick={() => void save()}
              data-testid="ranks-rules-editor-save"
            >
              {tr(`${E}.save`)}
            </Button>
            {dirty && (
              <Button kind="ghost" disabled={busy} onClick={() => edit(saved)} data-testid="ranks-rules-editor-discard">
                {tr(`${E}.discard`)}
              </Button>
            )}
            {dirty && <span style={{ ...hint, fontSize: 'var(--tp-fs-sm)' }}>{valid ? tr(`${E}.unsaved`) : tr(`${E}.errorFix`)}</span>}
            <ErrorText error={error} style={{ marginBlock: 0, flexBasis: '100%' }} />
          </div>
        )}
      </div>
    </Panel>
  );
}

const MOVES: NumberRuleKey[] = [
  'scale',
  'win_weight',
  'k_provisional',
  'k_settling',
  'k_settled',
  'provisional_games',
  'settling_games',
  'trust_tournament',
  'trust_desk',
  'trust_player',
  'repeat_days',
  'repeat_half_from',
  'repeat_zero_from',
  'soft_loss_below',
  'soft_loss_factor',
  'max_move',
  'level_min',
  'level_max',
  'return_games',
];

function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  const headingId = `ranks-rules-${id}`;
  return (
    <section aria-labelledby={headingId} data-testid={`ranks-rules-section-${id}`} style={{ display: 'grid', paddingBlockStart: 'var(--tp-sp-2)', borderBlockStart: '1px solid var(--tp-border)' }}>
      <h3 id={headingId} style={{ margin: 0, fontSize: 'var(--tp-fs-md)', fontWeight: 700 }}>
        {title}
      </h3>
      <p style={{ ...hint, fontSize: 'var(--tp-fs-sm)', marginBlock: 'var(--tp-sp-1) var(--tp-sp-2)', maxInlineSize: '70ch' }}>{lead}</p>
      {children}
    </section>
  );
}

function SubHead({ children, hint: sub }: { children: ReactNode; hint?: string }) {
  return (
    <div style={{ paddingBlock: 'var(--tp-sp-3) var(--tp-sp-1)' }}>
      <h4 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 700, color: 'var(--tp-heading)' }}>{children}</h4>
      {sub && <p style={hint}>{sub}</p>}
    </div>
  );
}

function ChangedDot({ label: text }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      style={{ inlineSize: '0.5rem', blockSize: '0.5rem', borderRadius: '50%', background: 'var(--tp-accent)', alignSelf: 'center' }}
    />
  );
}

/** Label and one line of help at the start, the control at the end, the default under it. */
function Row({
  title,
  help,
  control,
  footer,
  labelFor,
  helpId,
  testId,
}: {
  title: string;
  help: string;
  control: ReactNode;
  footer?: ReactNode;
  labelFor?: string;
  helpId?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 'var(--tp-sp-1) var(--tp-sp-4)',
        alignItems: 'center',
        paddingBlock: 'var(--tp-sp-2)',
      }}
    >
      <div style={{ display: 'grid', gap: '0.125rem', minInlineSize: 0 }}>
        {labelFor ? (
          <label htmlFor={labelFor} style={label}>
            {title}
          </label>
        ) : (
          <span style={label}>{title}</span>
        )}
        <span id={helpId} style={hint}>
          {help}
        </span>
      </div>
      <div style={{ display: 'grid', justifyItems: 'end', gap: 'var(--tp-sp-1)' }}>
        {control}
        {footer}
      </div>
    </div>
  );
}

function DefaultLine({ value, canReset, onReset, testId }: { value: string; canReset: boolean; onReset: () => void; testId: string }) {
  const { tr } = useLocale();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <span style={{ ...hint, fontVariantNumeric: 'tabular-nums' }}>{tr(`${E}.defaultIs`, { value })}</span>
      {canReset && (
        <Button size="sm" kind="ghost" icon="undo" onClick={onReset} data-testid={testId}>
          {tr(`${E}.backToDefault`)}
        </Button>
      )}
    </span>
  );
}

function NumberRow({
  k,
  value,
  unit,
  disabled,
  error,
  onChange,
  footer,
}: {
  k: NumberRuleKey;
  value: string;
  unit?: Unit;
  disabled: boolean;
  error?: string;
  onChange: (raw: string) => void;
  footer: ReactNode;
}) {
  const { tr } = useLocale();
  const id = useId();
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  return (
    <Row
      testId={`ranks-rule-${k}`}
      labelFor={id}
      helpId={helpId}
      title={tr(`${K}.rule.${k}.label`)}
      help={tr(`${K}.rule.${k}.hint`)}
      control={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
          {unit === 'times' && <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>×</span>}
          <input
            id={id}
            style={{
              ...inputStyle,
              inlineSize: '6rem',
              textAlign: 'end',
              fontVariantNumeric: 'tabular-nums',
              border: `1px solid ${error ? 'var(--tp-danger-mark)' : 'var(--tp-border-strong)'}`,
            }}
            dir="ltr"
            inputMode={NUMBER_RULES[k].whole ? 'numeric' : 'decimal'}
            autoComplete="off"
            value={value}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${helpId} ${errId}` : helpId}
            onChange={(e) => onChange(e.target.value)}
            data-testid={`ranks-rule-input-${k}`}
          />
          {unit && unit !== 'times' && (
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', minInlineSize: '4.5rem' }}>{tr(`${E}.unit.${unit}`)}</span>
          )}
          {!unit && <span aria-hidden="true" style={{ minInlineSize: '4.5rem' }} />}
          {unit === 'times' && <span aria-hidden="true" style={{ minInlineSize: '4.5rem' }} />}
        </span>
      }
      footer={
        <>
          {error && (
            <span id={errId} role="alert" style={{ ...hint, color: 'var(--tp-danger-fg)' }}>
              {error}
            </span>
          )}
          {footer}
        </>
      }
    />
  );
}

function RoleChecks({
  value,
  disabled,
  label: groupLabel,
  onChange,
}: {
  value: readonly CheckRole[];
  disabled: boolean;
  label: string;
  onChange: (next: CheckRole[]) => void;
}) {
  const { tr } = useLocale();
  return (
    <div role="group" aria-label={groupLabel} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5) var(--tp-sp-3)', justifyContent: 'flex-end' }}>
      {CHECK_ROLES.map((r) => {
        const on = value.includes(r);
        return (
          <label
            key={r}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)', minBlockSize: 'var(--tp-row-h-dense)' }}
          >
            <input
              type="checkbox"
              checked={on}
              disabled={disabled}
              onChange={() => onChange(on ? value.filter((x) => x !== r) : CHECK_ROLES.filter((x) => x === r || value.includes(x)))}
              data-testid={`ranks-rule-check-role-${r}`}
            />
            {tr(`${E}.role.${r}`)}
          </label>
        );
      })}
    </div>
  );
}

function OffpeakEditor({
  windows,
  errors,
  disabled,
  onChange,
  footer,
}: {
  windows: readonly OffpeakDraft[];
  errors: Record<string, ('days' | 'time')[]>;
  disabled: boolean;
  onChange: (next: OffpeakDraft[]) => void;
  footer: ReactNode;
}) {
  const { tr } = useLocale();
  const O = `${E}.offpeak` as const;
  const update = (key: string, next: OffpeakDraft) => onChange(windows.map((w) => (w.key === key ? next : w)));
  const timeOptions = (list: readonly string[], current: string) => (list.includes(current) ? list : [current, ...list]);
  const selectStyle: CSSProperties = { ...inputStyle, inlineSize: 'auto', fontVariantNumeric: 'tabular-nums' };

  return (
    <div data-testid="ranks-rule-offpeak" style={{ display: 'grid', gap: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--tp-sp-1) var(--tp-sp-4)', alignItems: 'center' }}>
        <div style={{ display: 'grid', gap: '0.125rem' }}>
          <span style={label}>{tr(`${K}.rule.offpeak.label`)}</span>
          <span style={hint}>{tr(`${K}.rule.offpeak.hint`)}</span>
        </div>
        <div style={{ display: 'grid', justifyItems: 'end', gap: 'var(--tp-sp-1)' }}>
          {!disabled && (
            <Button
              size="sm"
              icon="plus"
              disabled={windows.length >= OFFPEAK_MAX}
              disabledReason={windows.length >= OFFPEAK_MAX ? tr(`${O}.max`) : undefined}
              onClick={() => onChange(addOffpeak(windows))}
              data-testid="ranks-offpeak-add"
            >
              {tr(`${O}.add`)}
            </Button>
          )}
          {footer}
        </div>
      </div>
      {windows.length === 0 ? (
        <p style={hint}>{tr(`${O}.none`)}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {windows.map((w, i) => {
            const errs = errors[w.key] ?? [];
            return (
              <li
                key={w.key}
                data-testid={`ranks-offpeak-${i}`}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 'var(--tp-sp-2) var(--tp-sp-4)',
                  padding: 'var(--tp-sp-2) var(--tp-sp-3)',
                  borderRadius: 'var(--tp-radius-ctl)',
                  background: 'var(--tp-surface-2)',
                  border: `1px solid ${errs.length ? 'var(--tp-danger-mark)' : 'var(--tp-border)'}`,
                }}
              >
                <div role="group" aria-label={tr(`${O}.days`)} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1)' }}>
                  {WEEK.map((day) => {
                    const on = w.days.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={on}
                        aria-label={tr(`${E}.weekdayLong.d${day as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)}
                        disabled={disabled}
                        onClick={() => update(w.key, toggleOffpeakDay(w, day))}
                        data-testid={`ranks-offpeak-${i}-day-${day}`}
                        style={{
                          minInlineSize: '2.75rem',
                          minBlockSize: '2rem',
                          paddingInline: 'var(--tp-sp-1-5)',
                          borderRadius: 'var(--tp-radius-pill)',
                          border: `1px solid ${on ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
                          background: on ? 'var(--tp-accent)' : 'var(--tp-surface)',
                          color: on ? 'var(--tp-accent-contrast)' : 'var(--tp-fg)',
                          fontWeight: on ? 700 : 500,
                          fontSize: 'var(--tp-fs-xs)',
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          opacity: disabled ? 0.7 : 1,
                        }}
                      >
                        {tr(`${E}.weekday.d${day as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)}
                      </button>
                    );
                  })}
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)' }}>
                  {tr(`${O}.from`)}
                  <select
                    style={selectStyle}
                    dir="ltr"
                    value={w.from}
                    disabled={disabled}
                    onChange={(e) => update(w.key, { ...w, from: e.target.value })}
                    data-testid={`ranks-offpeak-${i}-from`}
                  >
                    {timeOptions(HALF_HOURS, w.from).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)' }}>
                  {tr(`${O}.to`)}
                  <select
                    style={selectStyle}
                    dir="ltr"
                    value={w.to}
                    disabled={disabled}
                    onChange={(e) => update(w.key, { ...w, to: e.target.value })}
                    data-testid={`ranks-offpeak-${i}-to`}
                  >
                    {timeOptions(END_TIMES, w.to).map((t) => (
                      <option key={t} value={t}>
                        {t === '24:00' ? tr(`${O}.midnight`) : t}
                      </option>
                    ))}
                  </select>
                </label>
                {!disabled && (
                  <Button
                    size="sm"
                    kind="ghost"
                    icon="trash"
                    aria-label={tr(`${O}.remove`)}
                    title={tr(`${O}.remove`)}
                    onClick={() => onChange(windows.filter((x) => x.key !== w.key))}
                    style={{ marginInlineStart: 'auto' }}
                    data-testid={`ranks-offpeak-${i}-remove`}
                  />
                )}
                {errs.length > 0 && (
                  <span role="alert" style={{ ...hint, color: 'var(--tp-danger-fg)', flexBasis: '100%' }}>
                    {errs.map((e) => tr(`${O}.${e === 'days' ? 'errorDays' : 'errorTime'}`)).join(' ')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
