/**
 * "Pin to Analytics" (plan §5.4, DECIDE 13): a saved answer that read business
 * figures becomes a card on the analytics tabs. The card keeps the owner's
 * question and the tools that answered it, and is rewritten for whatever
 * range the page shows, through the same cache as the built-in cards. The pin
 * itself is a database row and costs nothing; the first rewrite for a range is
 * billed when the owner presses Refresh on the card, never on page open.
 */
import { useState } from 'react';
import { toolByName } from '@touch/core/assistant/tools';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { pinAnswer } from '../analytics/components/pin';
import type { ComponentScope } from '../analytics/components/params';
import type { SourceItem } from './api';

/** An answer can be pinned when at least one of its calls read business figures and succeeded. */
export function hasPinnableTools(tools: readonly SourceItem[]): boolean {
  return tools.some((t) => {
    if (t.error) return false;
    const spec = toolByName(t.name);
    return !!spec && spec.kind !== 'knowledge' && spec.kind !== 'meta';
  });
}

/** Which tab the card belongs to: the answer's scopes name it when they name one side only. */
export function scopeForPin(scopes: readonly string[] | null | undefined): ComponentScope | null {
  const cafe = scopes?.includes('cafe') ?? false;
  const courts = scopes?.includes('courts') ?? false;
  if (cafe && !courts) return 'cafe';
  if (courts && !cafe) return 'courts';
  return null;
}

export function PinControl({
  question,
  tools,
  scopes,
}: {
  question: string;
  tools: readonly SourceItem[];
  scopes?: readonly string[] | null;
}) {
  const { tr } = useLocale();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');

  const pin = async () => {
    setState('busy');
    try {
      await pinAnswer({
        question,
        tools: tools.filter((t) => !t.error).map((t) => ({ name: t.name, args: t.args })),
        figures: [],
        scope: scopeForPin(scopes),
      });
      setState('done');
    } catch {
      setState('failed');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start' }}>
      <Button
        size="sm"
        kind="ghost"
        icon="star"
        busy={state === 'busy'}
        disabled={state === 'done'}
        onClick={() => void pin()}
        title={tr('ws.owner.assistant.message.pin.hint')}
        data-testid="assistant-pin"
      >
        {tr(state === 'done' ? 'ws.owner.assistant.message.pin.pinned' : 'ws.owner.assistant.message.pin.button')}
      </Button>
      {state === 'done' && (
        <p data-pin-result="done" style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.owner.assistant.message.pin.done')}
        </p>
      )}
      {state === 'failed' && (
        <p role="alert" style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-danger-fg)' }}>
          {tr('ws.owner.assistant.message.pin.failed')}
        </p>
      )}
    </div>
  );
}
