/**
 * "Check figures still hold" (plan §3.5, DECIDE 10): a button on a saved
 * answer that read business figures. Pressing it asks the chat function to
 * re-run that message's tool calls with the same arguments against live data
 * and report which printed figures are no longer there — no model, nothing
 * billed, never automatic. The result is one sentence under the button, and
 * the changed figures are marked in the text (Message.tsx) with the same
 * dotted mark the gate uses, under a different sentence.
 */
import { useState } from 'react';
import { formatNumber } from '@touch/i18n';
import { toolByName } from '@touch/core/assistant/tools';
import { useLocale } from '../../lib/i18n';
import { Button, Spinner } from '../../components/ui';
import { recheckMessage, type RecheckResult, type SourceItem } from './api';

/** A message can be re-checked when at least one of its calls read business figures and succeeded. */
export function hasRecheckableTools(tools: readonly SourceItem[]): boolean {
  return tools.some((t) => {
    if (t.error) return false;
    const spec = toolByName(t.name);
    return !!spec && spec.kind !== 'knowledge' && spec.kind !== 'meta';
  });
}

/** Arabic-Indic and Extended Arabic-Indic digits → ASCII (gate.ts does the same before it counts). */
function latinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Same token shape as the gate's, so what it saw as one figure is what gets marked. */
const NUMBER_RE = /(?<![A-Za-z0-9#_.])[-−]?[\d٠-٩۰-۹][\d٠-٩۰-۹,٬]*(?:[.٫][\d٠-٩۰-۹]+)?%?(?![A-Za-z0-9_])/g;

/**
 * The raw number tokens in `text` whose value is one of `values`, for
 * `renderInline`. `228,000` and `٢٢٨٬٠٠٠` both match 228000.
 */
export function rawsForValues(text: string, values: readonly number[]): string[] {
  if (values.length === 0) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(NUMBER_RE)) {
    const raw = m[0];
    const body = latinDigits(raw).replace(/%$/, '').replace(/[,٬]/g, '').replace('٫', '.').replace('−', '-');
    const value = Number(body);
    if (!Number.isFinite(value)) continue;
    if (values.some((v) => Math.abs(v - value) <= 1e-6)) out.add(raw);
  }
  return [...out];
}

export function RecheckControl({ messageId, result, onResult }: { messageId: string; result: RecheckResult | null; onResult: (r: RecheckResult | null) => void }) {
  const { tr, locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async () => {
    setBusy(true);
    setFailed(false);
    try {
      onResult(await recheckMessage(messageId));
    } catch {
      setFailed(true);
      onResult(null);
    } finally {
      setBusy(false);
    }
  };

  const fmt = (n: number) => `⁨${formatNumber(n, locale)}⁩`;
  let line: string | null = null;
  if (result) {
    if (!result.baseline) line = tr('ws.owner.assistant.message.recheck.noBaseline');
    else if (result.changed.length === 0 && result.unchanged === 0) line = tr('ws.owner.assistant.message.recheck.noneToCheck');
    else if (result.changed.length === 0)
      line = result.unchanged === 1 ? tr('ws.owner.assistant.message.recheck.allHoldOne') : tr('ws.owner.assistant.message.recheck.allHold', { n: fmt(result.unchanged) });
    else {
      const list = result.changed
        .map((c) => (c.value_now === undefined ? tr('ws.owner.assistant.message.recheck.gone', { then: fmt(c.value_then) }) : `${fmt(c.value_then)} → ${fmt(c.value_now)}`))
        .join(', ');
      line =
        result.changed.length === 1
          ? tr('ws.owner.assistant.message.recheck.changedOne', { list })
          : tr('ws.owner.assistant.message.recheck.changed', { n: fmt(result.changed.length), list });
    }
  }
  const toolFailures = result?.tools.filter((t) => t.error) ?? [];
  const changedAny = (result?.changed.length ?? 0) > 0;

  return (
    <div data-recheck="" style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start', fontSize: 'var(--tp-fs-xs)' }}>
      <Button kind="soft" size="sm" icon="refresh" busy={busy} onClick={() => void run()} title={tr('ws.owner.assistant.message.recheck.hint')}>
        {busy ? tr('ws.owner.assistant.message.recheck.checking') : tr('ws.owner.assistant.message.recheck.button')}
      </Button>
      {busy && (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'center', color: 'var(--tp-muted-fg)' }}>
          <Spinner size="xs" /> {tr('ws.owner.assistant.message.recheck.checking')}
        </span>
      )}
      {!busy && failed && (
        <p role="alert" style={{ color: 'var(--tp-danger-fg)' }}>
          {tr('ws.owner.assistant.message.recheck.failed')}
        </p>
      )}
      {!busy && line && (
        <p
          data-recheck-result={changedAny ? 'changed' : 'hold'}
          style={{
            color: changedAny ? 'inherit' : 'var(--tp-muted-fg)',
            borderInlineStart: changedAny ? '2px dotted var(--tp-warn-fg, currentColor)' : undefined,
            paddingInlineStart: changedAny ? 'var(--tp-sp-2)' : undefined,
          }}
        >
          {line}
          {toolFailures.length > 0 && <> {toolFailures.map((t) => tr('ws.owner.assistant.message.recheck.toolFailed', { name: `⁨${t.name}⁩` })).join(' ')}</>}{' '}
          <span style={{ color: 'var(--tp-muted-fg)' }}>
            {tr('ws.owner.assistant.message.recheck.checkedAt', { when: `⁨${new Date(result!.checked_at).toLocaleTimeString(locale === 'ar' ? 'ar-IQ' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}⁩` })}
          </span>
        </p>
      )}
    </div>
  );
}
