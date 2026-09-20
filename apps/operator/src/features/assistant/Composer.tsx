/**
 * The question box (plan §5.2, §5.3). Enter sends, Shift+Enter starts a new
 * line; the Ask button's hint says a press is billed; Stop replaces Ask while
 * an answer streams. Nothing here is sent without a press.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale } from '../../lib/i18n';
import { Button, inputStyle } from '../../components/ui';

export function Composer({
  onAsk,
  onStop,
  streaming,
  disabled,
  autoFocus,
}: {
  onAsk: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const { tr } = useLocale();
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = 'tp-assistant-ask-hint';

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const send = () => {
    const q = text.trim();
    if (q === '' || streaming || disabled) return;
    onAsk(q);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'flex-end' }}>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={4000}
          disabled={disabled}
          placeholder={tr('ws.owner.assistant.composer.placeholder')}
          aria-label={tr('ws.owner.assistant.composer.ask')}
          aria-describedby={hintId}
          style={{ ...inputStyle, resize: 'vertical', minBlockSize: '3.25rem', flex: 1 }}
        />
        {streaming ? (
          <Button kind="danger" icon="x" onClick={onStop} aria-label={tr('ws.owner.assistant.composer.stop')}>
            {tr('ws.owner.assistant.composer.stop')}
          </Button>
        ) : (
          <Button kind="primary" icon="spark" onClick={send} disabled={disabled || text.trim() === ''} title={tr('ws.owner.assistant.composer.askBilled')}>
            {tr('ws.owner.assistant.composer.ask')}
          </Button>
        )}
      </div>
      <p id={hintId} style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
        {tr('ws.owner.assistant.composer.askBilled')}
      </p>
    </div>
  );
}
