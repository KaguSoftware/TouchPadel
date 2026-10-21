/**
 * The question box (plan §5.2, §5.3). Enter sends, Shift+Enter starts a new
 * line; the Ask button's hint says a press is billed; Stop replaces Ask while
 * an answer streams. Nothing here is sent without a press. The free AI
 * (FreeThread) passes its own placeholder, hint and length cap: its press is
 * not billed.
 *
 * Since 2026-10-20 (designs C and D) it is one rounded box: the line you type
 * on, any `actions`, then Ask; `below` is a row under the box (the Reads and
 * Model buttons). `locked`: a new paid chat reads nothing until the owner
 * picks, so the line is shut and says why. `hideHint` keeps the hint for
 * screen readers only (the start screen and the thread say it elsewhere).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';

export function Composer({
  onAsk,
  onStop,
  streaming,
  disabled,
  autoFocus,
  placeholder,
  hint,
  maxLength = 4000,
  locked,
  actions,
  below,
  hideHint,
  initialText,
}: {
  onAsk: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Defaults to the paid assistant's words. */
  placeholder?: string;
  /** The line under the box and the Ask button's title; defaults to "billed". */
  hint?: string;
  maxLength?: number;
  /** Nothing may be sent yet: the chat reads nothing. */
  locked?: boolean;
  /** Buttons inside the box, before Ask. */
  actions?: ReactNode;
  /** A row under the box (the Reads and Model buttons, 2026-10-20). */
  below?: ReactNode;
  hideHint?: boolean;
  /** Typed into the box on mount (a question handed over from the free AI). */
  initialText?: string;
}) {
  const { tr } = useLocale();
  const [text, setText] = useState(initialText ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = 'tp-assistant-ask-hint';

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const send = () => {
    const q = text.trim();
    if (q === '' || streaming || disabled || locked) return;
    onAsk(q);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const shut = disabled || locked;
  const canAsk = !shut && text.trim() !== '';
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
      <div
        data-composer={locked ? 'locked' : 'open'}
        className="tp-assistant-box"
        style={{
          display: 'flex',
          gap: 'var(--tp-sp-2)',
          alignItems: 'center',
          background: 'var(--tp-surface)',
          // Edge and glow: .tp-assistant-box (green in dark mode, blue in light).
          borderRadius: 'calc(var(--tp-radius-panel) + 4px)',
          paddingBlock: 'var(--tp-sp-2)',
          paddingInlineStart: 'var(--tp-sp-4)',
          paddingInlineEnd: 'var(--tp-sp-2)',
        }}
      >
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={maxLength}
          disabled={shut}
          placeholder={locked ? tr('ws.owner.assistant.composer.locked') : (placeholder ?? tr('ws.owner.assistant.composer.placeholder'))}
          aria-label={tr('ws.owner.assistant.composer.ask')}
          aria-describedby={hintId}
          className="tp-assistant-input"
          style={{ resize: 'none', flex: 1, minInlineSize: 0, border: 'none', background: 'transparent', color: locked ? 'var(--tp-muted-fg)' : 'var(--tp-fg)', font: 'inherit', fontSize: 'var(--tp-fs-lg)', lineHeight: 1.5, paddingBlock: 'var(--tp-sp-2)' }}
        />
        {actions}
        {streaming ? (
          <Button kind="danger" icon="x" onClick={onStop} aria-label={tr('ws.owner.assistant.composer.stop')}>
            {tr('ws.owner.assistant.composer.stop')}
          </Button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!canAsk}
            className="tp-assistant-ask"
            title={hint ?? tr('ws.owner.assistant.composer.askBilled')}
            style={{
              minBlockSize: '2.75rem',
              paddingInline: 'var(--tp-sp-4)',
              border: 'none',
              borderRadius: 'var(--tp-radius-panel)',
              // Colours: .tp-assistant-ask (green in dark mode, blue in light).
              fontWeight: 600,
              cursor: canAsk ? 'pointer' : 'not-allowed',
            }}
          >
            {tr('ws.owner.assistant.composer.ask')}
          </button>
        )}
      </div>
      {below && <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>{below}</div>}
      <p
        id={hintId}
        style={
          hideHint
            ? { position: 'absolute', inlineSize: 1, blockSize: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }
            : { fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', textAlign: 'center' }
        }
      >
        {locked ? tr('ws.owner.assistant.composer.lockedHint') : (hint ?? tr('ws.owner.assistant.composer.askBilled'))}
      </p>
    </div>
  );
}
