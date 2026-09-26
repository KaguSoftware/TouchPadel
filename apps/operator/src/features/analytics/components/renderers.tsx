/**
 * Renderers for the content an analytics component returns (plan §5.4 step 2).
 *
 * The content is typed data shaped by the component's output_schema, never
 * prose or markup, so each built-in shape has a deterministic renderer here
 * and the page decides the layout, not the model. The shape is detected from
 * the content itself (findings / rows / the three stock lists / figures +
 * paragraph / paragraph), so a pinned card with the fixed pinned schema and a
 * future built-in both land on a renderer, and anything else falls back to a
 * plain key/value listing rather than nothing.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { InsightWire } from '@touch/core';
import { Button } from '../../../components/ui';
import { StatusBadge } from '../../../components/kit';
import { useLocale } from '../../../lib/i18n';
import type { Formatters } from '../format';
import { muted } from '../cards/CardShell';
import type { ComponentContent } from './useAssistantComponent';
import type { ComponentParams } from './params';

const list: CSSProperties = { margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.45rem' };
const body: CSSProperties = { margin: 0, fontSize: 'var(--tp-fs-md)', lineHeight: 1.45 };
const cell: CSSProperties = { padding: '0.25rem 0.4rem', textAlign: 'start', verticalAlign: 'top', fontSize: 'var(--tp-fs-sm)' };
const num: CSSProperties = { ...cell, textAlign: 'end', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/** A figure's page, opened on the card's own range. */
function RouteLink({ route, params, children }: { route: string | null | undefined; params: ComponentParams; children: ReactNode }) {
  if (!route || !route.startsWith('/')) return <>{children}</>;
  return (
    <Link to={route as never} search={{ from: params.from, to: params.to } as never} className="tp-link">
      {children}
    </Link>
  );
}

export function FindingsList({
  findings,
  onHide,
  busy,
  f,
}: {
  findings: readonly InsightWire[];
  onHide?: (finding: InsightWire) => void;
  busy?: boolean;
  f: Formatters;
}) {
  const { tr } = useLocale();
  void f;
  if (!findings.length) return <p style={muted}>{tr('ws.analytics.components.nothing')}</p>;
  return (
    <ul style={list}>
      {findings.map((finding, i) => (
        <li key={`${i}-${finding.text}`} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
          <StatusBadge
            size="sm"
            tone={finding.confidence === 'high' ? 'success' : finding.confidence === 'low' ? 'warn' : 'neutral'}
            label={tr(`analytics.patterns.confidence.${finding.confidence}`)}
          />
          <span style={{ flex: 1, fontSize: 'var(--tp-fs-md)' }}>{finding.text}</span>
          {onHide && (
            <Button size="sm" kind="ghost" icon="eyeOff" disabled={busy} onClick={() => onHide(finding)}>
              {tr('ws.analytics.components.hide')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function FiguresRow({ figures, params }: { figures: readonly { label: string; value: string; route?: string | null }[]; params: ComponentParams }) {
  if (!figures.length) return null;
  return (
    <ul style={{ ...list, display: 'flex', flexWrap: 'wrap', gap: '0.35rem 1rem' }}>
      {figures.map((fig, i) => (
        <li key={`${i}-${fig.label}`} style={{ fontSize: 'var(--tp-fs-sm)' }}>
          <span style={muted}>{fig.label}: </span>
          <RouteLink route={fig.route} params={params}>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fig.value}</span>
          </RouteLink>
        </li>
      ))}
    </ul>
  );
}

export function ChangedRows({ rows, params, f }: { rows: NonNullable<ComponentContent['rows']>; params: ComponentParams; f: Formatters }) {
  const { tr } = useLocale();
  if (!rows.length) return <p style={muted}>{tr('ws.analytics.components.nothing')}</p>;
  return (
    <table style={{ borderCollapse: 'collapse', inlineSize: '100%' }}>
      <thead>
        <tr style={muted}>
          <th style={cell}>{tr('ws.analytics.components.figure')}</th>
          <th style={num}>{tr('ws.analytics.components.now')}</th>
          <th style={num}>{tr('ws.analytics.components.before')}</th>
          <th style={num}>{tr('ws.analytics.components.change')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${i}-${r.figure}`} style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
            <td style={cell}>
              <RouteLink route={r.route} params={params}>
                {r.figure}
              </RouteLink>
            </td>
            <td style={num}>{r.value}</td>
            <td style={{ ...num, color: 'var(--tp-muted-fg)' }}>{r.previous}</td>
            <td style={{ ...num, color: r.change_pct == null ? 'var(--tp-muted-fg)' : r.change_pct < 0 ? 'var(--tp-danger)' : 'var(--tp-success)' }}>
              {r.change_pct == null ? '—' : f.signedPct(r.change_pct)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Bullets({ title, items }: { title: string; items: readonly string[] }) {
  const { tr } = useLocale();
  return (
    <div>
      <p style={{ ...muted, fontWeight: 600, marginBlockEnd: '0.2rem' }}>{title}</p>
      {items.length ? (
        <ul style={{ margin: 0, paddingInlineStart: '1.1rem', fontSize: 'var(--tp-fs-sm)', display: 'grid', gap: '0.2rem' }}>
          {items.map((t, i) => (
            <li key={`${i}-${t}`}>{t}</li>
          ))}
        </ul>
      ) : (
        <p style={{ ...muted, fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.analytics.components.nothing')}</p>
      )}
    </div>
  );
}

export function StockWatch({ content }: { content: ComponentContent }) {
  const { tr } = useLocale();
  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <Bullets title={tr('ws.analytics.components.expiring')} items={content.expiring ?? []} />
      <Bullets title={tr('ws.analytics.components.variance')} items={content.variance ?? []} />
      <Bullets title={tr('ws.analytics.components.writeoffs')} items={content.writeoffs ?? []} />
    </div>
  );
}

/** Anything the built-in renderers do not know: strings as paragraphs, string arrays as bullets, object arrays as a table. */
function Generic({ content }: { content: Record<string, unknown> }) {
  const entries = Object.entries(content).filter(([, v]) => v !== null && v !== undefined);
  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      {entries.map(([k, v]) => {
        if (typeof v === 'string' || typeof v === 'number') return <p key={k} style={body}>{String(v)}</p>;
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return <Bullets key={k} title={k} items={v as string[]} />;
        if (Array.isArray(v) && v.every((x) => x && typeof x === 'object')) {
          const rows = v as Record<string, unknown>[];
          const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
          return (
            <table key={k} style={{ borderCollapse: 'collapse', inlineSize: '100%' }}>
              <thead>
                <tr style={muted}>
                  {cols.map((c) => (
                    <th key={c} style={cell}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
                    {cols.map((c) => (
                      <td key={c} style={cell}>
                        {r[c] == null ? '' : typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        return (
          <p key={k} style={{ ...body, fontSize: 'var(--tp-fs-sm)' }}>
            {k}: {JSON.stringify(v)}
          </p>
        );
      })}
    </div>
  );
}

/** Pick the renderer from the content's shape. */
export function ContentView({
  content,
  params,
  f,
  onHide,
  busy,
}: {
  content: ComponentContent;
  params: ComponentParams;
  f: Formatters;
  onHide?: (finding: InsightWire) => void;
  busy?: boolean;
}) {
  if (Array.isArray(content.findings)) return <FindingsList findings={content.findings} onHide={onHide} busy={busy} f={f} />;
  if (Array.isArray(content.rows)) return <ChangedRows rows={content.rows} params={params} f={f} />;
  if (Array.isArray(content.expiring) || Array.isArray(content.variance) || Array.isArray(content.writeoffs)) return <StockWatch content={content} />;
  if (typeof content.paragraph === 'string') {
    return (
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <p style={body}>{content.paragraph}</p>
        {Array.isArray(content.figures) && <FiguresRow figures={content.figures} params={params} />}
      </div>
    );
  }
  return <Generic content={content} />;
}
