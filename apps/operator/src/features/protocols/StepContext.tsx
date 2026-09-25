/**
 * The context read above a step form (build-contracts-2026-09-23 §5.4 "its
 * context read (§2.9-2.13)"). Each read is the narrow one the contract gives
 * that step, so a person sees what they need to act and nothing their role may
 * not read: the recipe without cost for the test, the cost for the price step
 * (management), the plan without money for the desk and marketing
 * (tournament_context), the figures of a price change for management only.
 *
 * A read the caller may not make fails quietly and its block is left out: the
 * server decides, not this file.
 */
import { formatDateTime, formatIQD, formatNumber, formatTimeRange, type MessageKey } from '@touch/i18n';
import type { ProtocolKind } from '@touch/core/protocols';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { StatusBadge } from '../../components/kit';
import { Icon } from '../../components/icons';
import { useStepRead } from './api';
import {
  readCost,
  readFeasibility,
  readNumbers,
  readReadiness,
  readTestContext,
  readTournamentContext,
  type CostContext,
  type Feasibility,
  type PriceNumbers,
  type Readiness,
  type TestContext,
  type TournamentContext,
} from './contextLogic';
import { pickText } from './protocolLogic';
import { ContextBlock } from './StepForm';

export interface StepContexts {
  test: TestContext | null;
  cost: CostContext | null;
  readiness: Readiness | null;
  feasibility: Feasibility | null;
  tournament: TournamentContext | null;
  numbers: PriceNumbers | null;
}

/** The context reads of one step, each enabled only where it serves (and, for the management reads, only for management). */
export function useStepContexts(kind: ProtocolKind, stepKey: string | null, runId: string, stepId: string, mgmt: boolean): StepContexts {
  const release = kind === 'product_release';
  const on = {
    test: release && stepKey === 'test',
    cost: release && stepKey === 'analysis' && mgmt,
    readiness: release && stepKey === 'launch' && mgmt,
    feasibility: kind === 'tournament' && stepKey === 'feasibility' && mgmt,
    tournament: kind === 'tournament' && (stepKey === 'courts' || stepKey === 'marketing'),
    numbers: kind === 'price_promo' && (stepKey === 'numbers' || stepKey === 'apply') && mgmt,
  };
  const test = useStepRead('test', runId, async () => readTestContext(await appRpc<unknown>('release_test_context', { p_run_id: runId })), on.test);
  const cost = useStepRead('analysis', runId, async () => readCost(await appRpc<unknown>('release_cost', { p_run_id: runId })), on.cost);
  const readiness = useStepRead('launch', runId, async () => readReadiness(await appRpc<unknown>('release_readiness', { p_run_id: runId })), on.readiness);
  const feasibility = useStepRead('feasibility', runId, async () => readFeasibility(await appRpc<unknown>('tournament_feasibility', { p_run_id: runId })), on.feasibility);
  const tournament = useStepRead(
    `plan:${stepId}`,
    runId,
    async () => readTournamentContext(await appRpc<unknown>('tournament_context', { p_run_step_id: stepId })),
    on.tournament,
  );
  const numbers = useStepRead('numbers', runId, async () => readNumbers(await appRpc<unknown>('price_promo_numbers', { p_run_id: runId })), on.numbers);
  // A read switched off still hands back what its key cached for another step
  // of the run (the launch's readiness on the proposal): only the step's own count.
  const own = <T,>(enabled: boolean, data: T | undefined): T | null => (enabled ? data ?? null : null);
  return {
    test: own(on.test, test.data),
    cost: own(on.cost, cost.data),
    readiness: own(on.readiness, readiness.data),
    feasibility: own(on.feasibility, feasibility.data),
    tournament: own(on.tournament, tournament.data),
    numbers: own(on.numbers, numbers.data),
  };
}

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;
const cell = { paddingBlock: 'var(--tp-sp-1)', paddingInline: 'var(--tp-sp-1)' } as const;

function Money({ v }: { v: number | null | undefined }) {
  const { locale } = useLocale();
  return <span dir="ltr">{v == null ? '—' : formatIQD(v, locale)}</span>;
}

export function StepContextPanel({ ctx }: { ctx: StepContexts }) {
  const { tr, locale } = useLocale();
  const blocks = [];

  if (ctx.test && ctx.test.sizes.length > 0) {
    blocks.push(
      <ContextBlock key="test" title={tr('ws.protocols.context.test.title')}>
        {ctx.test.sizes.map((s) => (
          <div key={s.variant_id}>
            <strong>{pickText(locale, s.name_en, s.name_ar)}</strong>
            {s.lines.length === 0 ? (
              <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.context.test.noLines')}</p>
            ) : (
              <ul style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
                {s.lines.map((l, i) => (
                  <li key={i}>
                    {pickText(locale, l.name_en, l.name_ar)} · <span dir="ltr">{formatNumber(l.qty, locale)} {l.unit}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </ContextBlock>,
    );
  }

  if (ctx.cost) {
    blocks.push(
      <ContextBlock key="cost" title={tr('ws.protocols.context.cost.title')}>
        <table style={{ borderCollapse: 'collapse' }}>
          <tbody>
            {ctx.cost.sizes.map((s) => (
              <tr key={s.variant_id}>
                <td style={cell}>{pickText(locale, s.name_en, s.name_ar)}</td>
                <td style={{ ...cell, textAlign: 'end' }}>{s.cost_known ? <Money v={s.cost_iqd} /> : <span style={muted}>{tr('ws.protocols.context.cost.unknown')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ctx.cost.unknown_lines.length > 0 && <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.context.cost.unknownLines', { lines: ctx.cost.unknown_lines.join(tr('ws.protocols.view.listJoin')) })}</p>}
      </ContextBlock>,
    );
  }

  if (ctx.readiness) {
    blocks.push(
      <ContextBlock key="ready" title={tr('ws.protocols.context.readiness.title')}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-0)' }}>
          {ctx.readiness.checks.map((c) => (
            <li key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', color: c.ok ? 'var(--tp-success-fg)' : 'var(--tp-danger-fg)' }}>
              <Icon name={c.ok ? 'check' : 'x'} size={14} />
              {tr(`ws.protocols.context.readiness.${c.key}` as MessageKey)}
            </li>
          ))}
          {ctx.readiness.warnings.map((w) => (
            <li key={w} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', color: 'var(--tp-warn-fg)' }}>
              <Icon name="alert" size={14} />
              {tr(`ws.protocols.context.readiness.warn_${w}` as MessageKey)}
            </li>
          ))}
        </ul>
        <span style={{ justifySelf: 'start' }}>
          <StatusBadge tone={ctx.readiness.ready ? 'success' : 'warn'} label={tr(ctx.readiness.ready ? 'ws.protocols.context.readiness.ready' : 'ws.protocols.context.readiness.notReady')} />
        </span>
      </ContextBlock>,
    );
  }

  if (ctx.feasibility) {
    blocks.push(
      <ContextBlock key="feas" title={tr('ws.protocols.context.feasibility.title')}>
        {ctx.feasibility.ranges.length === 0 ? (
          <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.context.feasibility.none')}</p>
        ) : (
          <ul style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
            {ctx.feasibility.ranges.map((r, i) => (
              <li key={i}>
                {tr('ws.protocols.context.feasibility.row', {
                  court: pickText(locale, r.court_name_en, r.court_name_ar),
                  when: r.from && r.to ? formatTimeRange(new Date(r.from), new Date(r.to), locale) : '—',
                  bookings: formatNumber(r.bookings, locale),
                  guests: formatNumber(r.guests, locale),
                })}
              </li>
            ))}
          </ul>
        )}
      </ContextBlock>,
    );
  }

  if (ctx.tournament) {
    const t = ctx.tournament;
    blocks.push(
      <ContextBlock key="plan" title={tr('ws.protocols.context.tournament.title', { name: pickText(locale, t.name_en, t.name_ar) })}>
        <p style={{ margin: 0 }}>
          {[
            t.class ? tr('ws.protocols.context.tournament.class', { class: t.class }) : null,
            t.format ? tr(`ws.protocols.options.format.${t.format}` as MessageKey) : null,
            t.capacity ? tr(`ws.protocols.context.tournament.capacity_${t.capacity.unit === 'pairs' ? 'pairs' : 'players'}`, { count: formatNumber(t.capacity.count, locale) }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <ul style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
          {t.ranges.map((r, i) => (
            <li key={i}>
              {r.courts.map((c) => pickText(locale, c.en, c.ar)).join(tr('ws.protocols.view.listJoin'))} · {r.from ? formatDateTime(new Date(r.from), locale) : '—'}
              {' → '}
              {r.to ? formatDateTime(new Date(r.to), locale) : '—'}
            </li>
          ))}
        </ul>
        <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.context.tournament.blocked', { count: formatNumber(t.blocked, locale) })}</p>
      </ContextBlock>,
    );
  }

  if (ctx.numbers) {
    const n = ctx.numbers;
    blocks.push(
      <ContextBlock key="numbers" title={tr('ws.protocols.context.numbers.title')}>
        {n.sizes.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', inlineSize: '100%', fontSize: 'var(--tp-fs-sm)' }}>
              <thead>
                <tr style={muted}>
                  {(['size', 'now', 'new', 'cost', 'marginNow', 'marginNew', 'sold'] as const).map((h) => (
                    <th key={h} style={{ ...cell, textAlign: h === 'size' ? 'start' : 'end', fontWeight: 600 }}>
                      {tr(`ws.protocols.context.numbers.cols.${h}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {n.sizes.map((s, i) => (
                  <tr key={s.variant_id ?? `new-${i}`} style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
                    <td style={cell}>
                      {pickText(locale, s.name_en, s.name_ar)}
                      {s.variant_id === null && <span style={muted}> · {tr('ws.protocols.context.numbers.newSize')}</span>}
                    </td>
                    <td style={{ ...cell, textAlign: 'end' }}><Money v={s.current_price_iqd} /></td>
                    <td style={{ ...cell, textAlign: 'end', fontWeight: 600 }}><Money v={s.new_price_iqd} /></td>
                    <td style={{ ...cell, textAlign: 'end' }}>{s.cost_known ? <Money v={s.cost_iqd} /> : <span style={muted}>{tr('ws.protocols.context.cost.unknown')}</span>}</td>
                    <td style={{ ...cell, textAlign: 'end' }}><Money v={s.margin_before_iqd} /></td>
                    <td style={{ ...cell, textAlign: 'end' }}><Money v={s.margin_after_iqd} /></td>
                    <td style={{ ...cell, textAlign: 'end' }}>{formatNumber(s.units_30d, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {n.addons.length > 0 && (
          <ul style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
            {n.addons.map((a) => (
              <li key={a.modifier_id}>
                {pickText(locale, a.group_name_en, a.group_name_ar)} · {pickText(locale, a.name_en, a.name_ar)}: <Money v={a.current_delta_iqd} /> → <Money v={a.new_delta_iqd} />{' '}
                <span style={muted}>{tr('ws.protocols.context.numbers.addonSold', { count: formatNumber(a.count_30d, locale) })}</span>
              </li>
            ))}
          </ul>
        )}
        {n.promotion && (
          <p style={{ margin: 0 }}>
            {tr('ws.protocols.context.numbers.promotion', {
              now: n.promotion.current_value == null ? '—' : formatNumber(n.promotion.current_value, locale),
              next: n.promotion.new_value == null ? '—' : formatNumber(n.promotion.new_value, locale),
              cost: formatIQD(n.promotion.discount_cost_30d_iqd, locale),
              units: formatNumber(n.promotion.units_30d, locale),
            })}
          </p>
        )}
        {n.rate && (
          <div>
            <ul style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
              {n.rate.durations.map((d) => (
                <li key={d.duration_min}>
                  {tr('ws.protocols.form.minutes', { n: formatNumber(d.duration_min, locale) })}: <Money v={d.current_price_iqd} /> → <Money v={d.new_price_iqd} />
                </li>
              ))}
            </ul>
            <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.context.numbers.rate', { count: formatNumber(n.rate.bookings_30d, locale), revenue: formatIQD(n.rate.revenue_30d_iqd, locale) })}</p>
          </div>
        )}
        {n.featured && (
          <p style={{ margin: 0 }}>
            {tr('ws.protocols.context.numbers.featured', {
              now: n.featured.current_pct == null ? '—' : formatNumber(n.featured.current_pct, locale),
              next: n.featured.new_pct == null ? '—' : formatNumber(n.featured.new_pct, locale),
              units: formatNumber(n.featured.units_30d, locale),
              cost: formatIQD(n.featured.discount_cost_30d_iqd, locale),
            })}
          </p>
        )}
        <p style={{ ...muted, margin: 0 }}>{tr('ws.protocols.context.numbers.basis')}</p>
      </ContextBlock>,
    );
  }

  if (blocks.length === 0) return null;
  return <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>{blocks}</div>;
}
