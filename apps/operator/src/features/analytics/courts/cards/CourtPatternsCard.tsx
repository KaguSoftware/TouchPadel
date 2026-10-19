/**
 * The deterministic court patterns, grouped by what they are about (Sait,
 * 2026-10-19): one coloured card per kind, the overview's Breakdown card,
 * each its own card in the zone's sideways row. Its shared comparison is said
 * once under the title, and each finding is one row with a bar, the figure,
 * and a mark for what it is measured against. Opening a row shows the sentence (the AI wording when
 * the operator asked for it) and the sample it rests on. Confidence is a quiet
 * dot: green for high, hollow amber for low, nothing for the usual medium.
 * Nothing here calls a model except "Reword with AI".
 */
import { useMemo, useState, type KeyboardEvent } from 'react';
import type { CompareBasis, CourtPatternCandidate, DateRange } from '@touch/core';
import type { Locale, MessageKey } from '@touch/i18n';
import { BREAKDOWN_TONES, BreakdownCard } from '../../../../components/BreakdownCards';
import { Button, ErrorText, Spinner } from '../../../../components/ui';
import { useLocale } from '../../../../lib/i18n';
import {
  analyticsRpc,
  insights as callInsights,
  type JudgedPattern,
} from '../../../../lib/analyticsApi';
import { CardShell, muted, type CardState } from '../../cards/CardShell';
import { makeFormatters, type Formatters } from '../../format';
import { toPatternWire } from '../../patterns';
import type { StoredSets } from '../../useAnalyticsData';
import { groupPatterns, type PatternGroup, type PatternRow } from '../patternGroups';

const p = (k: string) => `ws.analytics.courts.patterns.${k}` as MessageKey;
type Tr = ReturnType<typeof useLocale>['tr'];

/** The heading note: the shared base in words, or what the mark on each bar means. */
function baseNote(tr: Tr, f: Formatters, g: PatternGroup): string | null {
  switch (g.key) {
    case 'cancellations':
    case 'noShows':
    case 'attachGap':
      return g.sharedBase == null ? null : tr(p(`base.${g.key}`), { base: f.pct(g.sharedBase) });
    case 'deadSlot':
    case 'shift':
    case 'courtBasket':
      return tr(p(`base.${g.key}`));
    default:
      return null;
  }
}

/** The small figure at the end of a row: the count behind it, or its own comparison. */
function detail(tr: Tr, f: Formatters, g: PatternGroup, r: PatternRow): string {
  const m = r.candidate.metrics;
  const n = (v: number | string | undefined) => f.num(Number(v ?? 0));
  switch (g.key) {
    case 'cancellations':
    case 'noShows':
      return tr(p('detail.ofTotal'), { n: n(m.n), total: n(m.bookingsTotal) });
    case 'lapsing':
      return tr(p('detail.ofTotal'), { n: n(m.lapsingRegulars), total: n(m.regulars) });
    case 'deadSlot':
      return tr(p('detail.venueAvg'), { pct: f.pct(r.base ?? 0) });
    case 'attachGap':
      return g.sharedBase == null
        ? tr(p('detail.venueAvg'), { pct: f.pct(r.base ?? 0) })
        : tr(p('detail.ofTotal'), { n: n(m.linkedBookings), total: n(m.liveBookings) });
    case 'shift':
      return tr(p('detail.was'), { pct: f.pct(r.base ?? 0) });
    case 'courtBasket':
      return tr(p('detail.lift'), { lift: f.num1(Number(m.lift ?? 0)) });
    case 'saturatedSlot':
      return r.candidate.sampleLabel;
  }
}

const dot = (confidence: CourtPatternCandidate['confidence']) =>
  confidence === 'high'
    ? { background: 'var(--tp-success-mark)' }
    : confidence === 'low'
      ? { border: '2px solid var(--tp-warn-mark)' }
      : null;

function Dot({
  confidence,
  label,
}: {
  confidence: CourtPatternCandidate['confidence'];
  label?: string;
}) {
  const look = dot(confidence);
  return (
    <span
      role={look && label ? 'img' : undefined}
      aria-label={look ? label : undefined}
      aria-hidden={look && label ? undefined : true}
      style={{
        inlineSize: '0.6rem',
        blockSize: '0.6rem',
        borderRadius: '50%',
        boxSizing: 'border-box',
        display: 'inline-block',
        flex: 'none',
        ...look,
      }}
    />
  );
}

function Bar({ value, base, max }: { value: number; base: number | null; max: number }) {
  const at = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'relative',
        display: 'block',
        blockSize: '0.55rem',
        borderRadius: 'var(--tp-radius-pill)',
        background: 'var(--tp-surface-3)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          insetBlock: 0,
          insetInlineStart: 0,
          inlineSize: at(value),
          borderRadius: 'var(--tp-radius-pill)',
          background: 'var(--tp-accent)',
        }}
      />
      {base != null && (
        <span
          style={{
            position: 'absolute',
            insetBlock: '-0.2rem',
            insetInlineStart: at(base),
            inlineSize: '2px',
            marginInlineStart: '-1px',
            borderRadius: '1px',
            background: 'var(--tp-fg)',
          }}
        />
      )}
    </span>
  );
}

export function CourtPatternsCard({
  patterns,
  state,
  refreshing,
  tip,
  range,
  compareBasis,
  courtId = null,
  stored,
}: {
  patterns: readonly CourtPatternCandidate[];
  state: CardState;
  refreshing?: boolean;
  tip: string;
  range: DateRange;
  compareBasis: CompareBasis;
  /** The tab's court filter (0098): the judged set is stored under this court; null = venue-wide. */
  courtId?: string | null;
  stored: StoredSets;
}) {
  const { tr, locale } = useLocale();
  const [judged, setJudged] = useState<JudgedPattern[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [degraded, setDegraded] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const f = useMemo(() => makeFormatters(locale as Locale), [locale]);
  const shown = useMemo(() => patterns.slice(0, 10), [patterns]);
  const groups = useMemo(() => groupPatterns(shown), [shown]);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const onKey = (id: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(id);
    }
  };
  // A judged sentence replaces the templated one for the same candidate id;
  // the statistics never change, only the wording.
  const byId = new Map((judged ?? stored.patterns?.patterns ?? []).map((p) => [p.id, p]));

  async function judge() {
    if (shown.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await callInsights({
        mode: 'patterns',
        lang: locale as 'ar' | 'en',
        range_from: range.from,
        range_to: range.to,
        compare_basis: compareBasis,
        scope: 'courts',
        data: {
          rejections: stored.rejections.map((r) => r.text),
          patterns: shown.map(toPatternWire),
        },
      });
      setDegraded(res.degraded);
      const out = res.patterns ?? [];
      setJudged(out);
      if (out.length > 0) {
        await analyticsRpc.savePatterns({
          from: range.from,
          to: range.to,
          locale: locale as Locale,
          scope: 'courts',
          courtId,
          patterns: out,
        });
        stored.reload();
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const shellState = state === 'ready' && shown.length === 0 ? 'empty' : state;
  // Loading, empty or failed: one plain card holds the zone's first slot.
  if (shellState !== 'ready') {
    return (
      <CardShell
        title={tr('ws.analytics.courts.cards.patterns')}
        tip={tip}
        state={shellState}
        refreshing={refreshing}
        emptyKey="ws.analytics.courts.patterns.none"
        skeletonLines={5}
      >
        {null}
      </CardShell>
    );
  }

  // A bordered button, so it gives back the pull the band applies to a
  // ghost icon at its end and lines up with the card's inset.
  const reword = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', marginInlineEnd: 'var(--tp-sp-2)' }}>
      {busy && <Spinner size="xs" />}
      <Button size="sm" disabled={busy} onClick={() => void judge()}>
        {tr('analytics.patterns.reword')}
      </Button>
    </span>
  );
  const footer = (
    <>
      {(error != null || degraded) && (
        <div
          style={{
            display: 'grid',
            gap: 'var(--tp-sp-1)',
            paddingInline: 'var(--tp-sp-4)',
            paddingBlockEnd: 'var(--tp-sp-2)',
          }}
        >
          <ErrorText error={error} />
          {degraded && (
            <p style={{ fontSize: 'var(--tp-fs-xs)' }}>{tr('analytics.notices.noAi')}</p>
          )}
        </div>
      )}
      {shown.some((c) => c.confidence !== 'medium') && (
        <div
          style={{
            ...muted,
            display: 'flex',
            flexWrap: 'wrap',
            columnGap: 'var(--tp-sp-4)',
            rowGap: 'var(--tp-sp-1)',
            fontSize: 'var(--tp-fs-xs)',
            paddingInline: 'var(--tp-sp-4)',
            paddingBlockEnd: 'var(--tp-sp-3)',
          }}
        >
          {(['high', 'low'] as const)
            .filter((c) => shown.some((s) => s.confidence === c))
            .map((c) => (
              <span
                key={c}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}
              >
                <Dot confidence={c} />
                {tr(p(`legend.${c}`))}
              </span>
            ))}
        </div>
      )}
    </>
  );

  // No card of its own (Sait, 2026-10-19): each group is a card in the zone's
  // sideways row, next to the AI cards.
  return (
    <>
      {groups.map((g, i) => {
        const note = baseNote(tr, f, g);
        return (
          <BreakdownCard
            key={g.key}
            bandRow
            tone={BREAKDOWN_TONES[i % BREAKDOWN_TONES.length]!}
            title={tr(p(`groups.${g.key}`))}
            // The first card carries what the old Patterns card did: its tip and "Reword with AI".
            hint={i === 0 ? tip : undefined}
            action={i === 0 ? reword : undefined}
          >
            {note && (
              <p
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--tp-sp-1-5)',
                  paddingInline: 'var(--tp-sp-4)',
                  paddingBlockStart: 'var(--tp-sp-2-5)',
                  fontSize: 'var(--tp-fs-sm)',
                }}
              >
                {g.rows.some((r) => r.base != null) && (
                  <span
                    aria-hidden="true"
                    style={{
                      inlineSize: '2px',
                      blockSize: '0.8rem',
                      background: 'var(--tp-fg)',
                      display: 'inline-block',
                      flex: 'none',
                    }}
                  />
                )}
                {note}
              </p>
            )}
            <ul
              className="tp-breakdown-rows"
              style={{ display: 'grid', paddingBlock: 'var(--tp-sp-1)' }}
            >
              {g.rows.map((r) => {
                const id = r.candidate.id;
                const expanded = open.has(id);
                const sub = r.hours ?? (r.dimension ? tr(p(`dimension.${r.dimension}`)) : null);
                return (
                  <li key={id}>
                    <div
                      className="tp-row"
                      data-clickable="true"
                      role="button"
                      tabIndex={0}
                      aria-expanded={expanded}
                      onClick={() => toggle(id)}
                      onKeyDown={onKey(id)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) auto',
                        alignItems: 'center',
                        columnGap: 'var(--tp-sp-3)',
                        rowGap: 'var(--tp-sp-1-5)',
                        paddingBlock: 'var(--tp-sp-2-5)',
                        paddingInline: 'var(--tp-sp-4)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      <span style={{ minInlineSize: 0, display: 'grid' }}>
                        <span
                          style={{
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {r.label}
                        </span>
                        {sub && <span style={{ fontSize: 'var(--tp-fs-xs)' }}>{sub}</span>}
                      </span>
                      <span style={{ display: 'grid', justifyItems: 'end' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 'var(--tp-sp-1-5)',
                            fontWeight: 700,
                          }}
                        >
                          <Dot
                            confidence={r.candidate.confidence}
                            label={tr(
                              `analytics.patterns.confidence.${r.candidate.confidence}` as MessageKey,
                            )}
                          />
                          {f.pct(r.value)}
                        </span>
                        <span style={{ fontSize: 'var(--tp-fs-xs)', whiteSpace: 'nowrap' }}>
                          {detail(tr, f, g, r)}
                        </span>
                      </span>
                      <span style={{ gridColumn: '1 / -1' }}>
                        <Bar value={r.value} base={r.base} max={g.scaleMax} />
                      </span>
                    </div>
                    {expanded && (
                      <div
                        style={{
                          display: 'grid',
                          gap: 'var(--tp-sp-0)',
                          paddingInline: 'var(--tp-sp-4)',
                          paddingBlockEnd: 'var(--tp-sp-2-5)',
                        }}
                      >
                        <span style={{ fontSize: 'var(--tp-fs-sm)' }}>
                          {byId.get(id)?.text ?? r.candidate.fallbackText}
                        </span>
                        <span style={{ fontSize: 'var(--tp-fs-xs)' }}>
                          {r.candidate.sampleLabel}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {i === 0 && footer}
          </BreakdownCard>
        );
      })}
    </>
  );
}
