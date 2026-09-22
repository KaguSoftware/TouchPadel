/**
 * One turn of the chat (plan §5.2). The owner's text is shown as typed. The
 * assistant's text goes through a tiny renderer — paragraphs, `- ` lists,
 * `1. ` lists, `|` pipe tables, `**bold**` — no markdown library, because the
 * model is told to answer tersely and anything richer is noise. Figures the
 * gate could not verify are wrapped in `UnverifiedMark`, with a footnote that
 * counts them. A refused scope in the answer becomes a "Turn on <Scope>"
 * button that re-asks. A saved answer that read business figures carries the
 * re-check control (plan §3.5, DECIDE 10); figures it reports as changed get
 * the same mark with a different sentence.
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { AssistantScope } from '@touch/core/assistant/tools';
import { useLocale } from '../../lib/i18n';
import { Button, Spinner } from '../../components/ui';
import type { AssistantErrorCode, GatePayload, RecheckResult, UsagePayload } from './api';
import { RecheckControl, hasRecheckableTools, rawsForValues } from './RecheckControl';
import { PinControl, hasPinnableTools } from './PinControl';
import { Sources, scopeLabel, type SourceRow } from './Sources';
import { UnverifiedMark } from './UnverifiedMark';
import { UsageMeter } from './UsageMeter';
import { Disclosure } from './Disclosure';
import { formatTokens, formatUsd, priceFor, totalTokens, type PricingMap } from '../../lib/assistantPricing';

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?[\s:|-]+\|?\s*$/;

/** Split assistant text into blocks. Exported for the test. */
export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        if (!TABLE_SEP.test(lines[i]!)) rows.push(splitRow(lines[i]!));
        i += 1;
      }
      if (rows.length > 0) blocks.push({ kind: 'table', header: rows[0]!, rows: rows.slice(1) });
      continue;
    }
    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i]!)) {
        items.push(BULLET.exec(lines[i]!)![1]!);
        i += 1;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    if (NUMBERED.test(line)) {
      const items: string[] = [];
      while (i < lines.length && NUMBERED.test(lines[i]!)) {
        items.push(NUMBERED.exec(lines[i]!)![1]!);
        i += 1;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !TABLE_ROW.test(lines[i]!) && !BULLET.test(lines[i]!) && !NUMBERED.test(lines[i]!)) {
      para.push(lines[i]!);
      i += 1;
    }
    blocks.push({ kind: 'p', lines: para });
  }
  return blocks;
}

function splitRow(line: string): string[] {
  const cells = line.trim().split('|');
  if (cells[0]?.trim() === '') cells.shift();
  if (cells[cells.length - 1]?.trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Inline text: `**bold**`, the unverified figures and the figures a re-check
 * found changed. The figures are matched as the gate reported them (`raw`),
 * longest first so `1,250` is not eaten by `250`, and only on a digit boundary
 * so `12` does not mark the `12` in `120`. A figure in both lists is
 * unverified: it was never a figure from the data.
 */
export function renderInline(text: string, unverified: readonly string[], key: string, changed: readonly string[] = []): ReactNode {
  const unverifiedSet = new Set(unverified.filter((r) => r !== ''));
  const raws = [...new Set([...unverifiedSet, ...changed.filter((r) => r !== '')])].sort((a, b) => b.length - a.length);
  // A digit, or a separator followed by a digit, on either side means the
  // match is part of a longer number; a trailing comma or full stop of the
  // sentence is not.
  const markRe = raws.length > 0 ? new RegExp(`(?<!\\d|\\d[.,])(${raws.map(escapeRe).join('|')})(?!\\d|[.,]\\d)`, 'g') : null;
  const out: ReactNode[] = [];
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);
  boldParts.forEach((part, bi) => {
    if (part === '') return;
    const isBold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
    const inner = isBold ? part.slice(2, -2) : part;
    const pieces = markRe ? inner.split(markRe) : [inner];
    const nodes = pieces.map((piece, pi) =>
      markRe && pi % 2 === 1 ? (
        <UnverifiedMark key={`${key}-${bi}-${pi}`} variant={unverifiedSet.has(piece) ? 'unverified' : 'changed'}>
          {piece}
        </UnverifiedMark>
      ) : (
        <Fragment key={`${key}-${bi}-${pi}`}>{piece}</Fragment>
      ),
    );
    out.push(isBold ? <strong key={`${key}-b${bi}`}>{nodes}</strong> : <Fragment key={`${key}-f${bi}`}>{nodes}</Fragment>);
  });
  return out;
}

export function AssistantText({ text, unverified, changed = [] }: { text: string; unverified: readonly string[]; changed?: readonly string[] }) {
  const blocks = parseBlocks(text);
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', overflowWrap: 'anywhere' }}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case 'p':
            return (
              <p key={k} style={{ margin: 0, lineHeight: 1.5 }}>
                {b.lines.map((line, li) => (
                  <Fragment key={li}>
                    {li > 0 && <br />}
                    {renderInline(line, unverified, `${k}-${li}`, changed)}
                  </Fragment>
                ))}
              </p>
            );
          case 'ul':
          case 'ol': {
            const Tag = b.kind;
            return (
              <Tag key={k} style={{ margin: 0, paddingInlineStart: '1.25rem', display: 'grid', gap: '0.2rem', lineHeight: 1.5 }}>
                {b.items.map((item, li) => (
                  <li key={li}>{renderInline(item, unverified, `${k}-${li}`, changed)}</li>
                ))}
              </Tag>
            );
          }
          case 'table':
            return (
              <div key={k} style={{ overflowX: 'auto', maxInlineSize: '100%' }}>
                <table className="tp-table" style={{ inlineSize: 'auto', minInlineSize: '50%', borderCollapse: 'collapse', fontSize: 'var(--tp-fs-sm)' }}>
                  <thead>
                    <tr>
                      {b.header.map((h, ci) => (
                        <th key={ci} style={{ textAlign: 'start', paddingBlock: '0.25rem', paddingInline: '0.5rem', borderBlockEnd: '1px solid var(--tp-border)' }}>
                          {renderInline(h, unverified, `${k}-h${ci}`, changed)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{ paddingBlock: '0.25rem', paddingInline: '0.5rem', borderBlockEnd: '1px solid var(--tp-border)', fontFamily: /^[\d.,%\s-]+$/.test(cell) ? 'var(--tp-font-numeric)' : undefined }}>
                            {renderInline(cell, unverified, `${k}-${ri}-${ci}`, changed)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------

export interface MessageProps {
  role: 'user' | 'assistant';
  text: string;
  /** The stored row's id; enables the re-check control on a saved assistant answer. */
  messageId?: string;
  /** The owner's question this answer replies to; enables "Pin to Analytics" on a saved answer. */
  question?: string;
  tools?: readonly SourceRow[];
  scopes?: readonly string[] | null;
  gate?: GatePayload | null;
  usage?: Partial<UsagePayload> | null;
  pricing?: PricingMap | null;
  fallbackMicrosPerMtok?: number;
  streaming?: boolean;
  stopped?: boolean;
  error?: { code: AssistantErrorCode; message: string } | null;
  /** Scopes the answer said were off; one button each. */
  turnOn?: readonly AssistantScope[];
  onTurnOn?: (scope: AssistantScope) => void;
  turningOn?: boolean;
  /** The answer was written by a job, not a chat turn. */
  fromJob?: boolean;
  compact?: boolean;
  onNavigate?: () => void;
}

export function Message(props: MessageProps) {
  const { tr } = useLocale();
  const { role, text, tools = [], gate, usage, streaming, stopped, error, turnOn = [], onTurnOn, compact } = props;
  // The last re-check of this message; forgotten when the row changes.
  const [recheck, setRecheck] = useState<RecheckResult | null>(null);
  useEffect(() => setRecheck(null), [props.messageId]);

  if (role === 'user') {
    return (
      <div data-message-role="user" style={{ display: 'grid', gap: '0.15rem', justifyItems: 'end', marginInlineStart: compact ? 'var(--tp-sp-4)' : '20%' }}>
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{tr('ws.owner.assistant.message.you')}</span>
        <div
          style={{
            background: 'var(--tp-accent-soft, var(--tp-surface-2))',
            border: '1px solid var(--tp-border)',
            borderRadius: 'var(--tp-radius-panel)',
            paddingBlock: 'var(--tp-sp-2)',
            paddingInline: 'var(--tp-sp-3)',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            lineHeight: 1.5,
          }}
        >
          <bdi>{text}</bdi>
        </div>
      </div>
    );
  }

  const unverified = gate?.unverified?.map((u) => u.raw) ?? [];
  const unverifiedCount = unverified.length;
  const pendingTools = tools.filter((t) => t.pending);
  const changedRaws = recheck ? rawsForValues(text, recheck.changed.map((c) => c.value_then)) : [];
  const canRecheck = !streaming && !!props.messageId && hasRecheckableTools(tools);
  const canPin = !streaming && !!props.messageId && !!props.question && !props.fromJob && hasPinnableTools(tools);

  return (
    <div data-message-role="assistant" style={{ display: 'grid', gap: 'var(--tp-sp-2)', marginInlineEnd: compact ? 0 : '10%' }}>
      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontWeight: 600, display: 'flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
        {tr('ws.owner.assistant.message.assistant')}
        {props.fromJob && <span style={{ fontWeight: 400 }}>· {tr('ws.owner.assistant.sources.job')}</span>}
        {streaming && <Spinner size="xs" />}
      </span>

      {/* Tool rows while the answer is being read: the pending ones, in words. */}
      {streaming && pendingTools.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.15rem', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {pendingTools.map((t) => (
            <li key={t.call_id} style={{ display: 'flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
              <Spinner size="xs" />
              <span>{tr('ws.owner.assistant.message.toolPending', { name: `⁨${t.name}⁩` })}</span>
            </li>
          ))}
        </ul>
      )}

      {text !== '' ? (
        <AssistantText text={text} unverified={unverified} changed={changedRaws} />
      ) : streaming ? (
        <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.assistant.message.reading')}</p>
      ) : null}

      {unverifiedCount > 0 && (
        <p data-unverified-footnote="" style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', borderInlineStart: '2px dotted var(--tp-warn-fg, currentColor)', paddingInlineStart: 'var(--tp-sp-2)' }}>
          {unverifiedCount === 1
            ? tr('ws.owner.assistant.message.unverifiedFootnoteOne')
            : tr('ws.owner.assistant.message.unverifiedFootnote', { n: `⁨${unverifiedCount}⁩` })}
          {gate?.retried && <> {tr('ws.owner.assistant.message.gateRetried')}</>}
        </p>
      )}

      {stopped && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.composer.stopped')}</p>}

      {error && (
        <p role="alert" style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-danger-fg)' }}>
          {tr(`ws.owner.assistant.message.errors.${error.code}`)}
        </p>
      )}

      {turnOn.length > 0 && onTurnOn && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start' }}>
          <div style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
            {turnOn.map((scope) => (
              <Button key={scope} kind="soft" size="sm" icon="check" busy={props.turningOn} onClick={() => onTurnOn(scope)}>
                {tr('ws.owner.assistant.scopes.turnOn', { scope: scopeLabel(tr, scope) })}
              </Button>
            ))}
          </div>
          <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.scopes.turnOnHint')}</p>
        </div>
      )}

      {!streaming && tools.length > 0 && <Sources items={tools} scopes={props.scopes} compact={compact} onNavigate={props.onNavigate} />}

      {(canRecheck || canPin) && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', alignItems: 'start' }}>
          {canRecheck && <RecheckControl messageId={props.messageId!} result={recheck} onResult={setRecheck} />}
          {canPin && <PinControl question={props.question!} tools={tools} scopes={props.scopes} />}
        </div>
      )}

      {usage && totalTokens(usage) > 0 && (
        <Disclosure
          storageKey="message-meter"
          defaultOpen={false}
          title={tr('ws.owner.assistant.meter.thisMessage')}
          summary={`⁨${formatTokens(totalTokens(usage))}⁩ · ⁨${formatUsd(usage.cost_micros ?? priceFor({ model: usage.model ?? '', ...usage }, props.pricing, props.fallbackMicrosPerMtok ?? 0))}⁩`}
        >
          <UsageMeter
            compact
            hideLabels
            slots={[{ label: 'thisMessage', tokens: usage, costMicros: usage.cost_micros ?? null, model: usage.model ?? null, calls: usage.calls ?? null }]}
            pricing={props.pricing}
            fallbackMicrosPerMtok={props.fallbackMicrosPerMtok ?? 0}
          />
        </Disclosure>
      )}
    </div>
  );
}
