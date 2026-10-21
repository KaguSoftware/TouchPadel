/**
 * The chat model switch (0140, owner call 2026-09-20): every model the
 * pricing table can bill, plus "Venue default" which means the row says
 * nothing and the venue's `llm_default_model` applies. An existing chat is
 * changed through `assistant_set_model` at once; a chat that has no row yet
 * keeps the choice in the parent's state and the first question carries it.
 *
 * The same button row, without the default entry, is `ModelChoice` on the
 * usage page, where it sets the venue default above the pricing table.
 *
 * "The free AI" (owner call 2026-10-16) closes the chat's row: it is not a
 * model of this chat and is never saved on it or sent to assistant-chat. It
 * switches the assistant to the free thread (useAssistantMode), which asks
 * `assistant-free` instead.
 */
import { useId, type ReactNode } from 'react';
import { FREE_MODEL_CHOICE } from '@touch/core/assistant/free';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '../../lib/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { EdgeError } from '../../lib/edge';
import { useToast } from '../../components/toast';
import { Button, ErrorText } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
import { QK, fetchModels, setModel } from './api';

/** Model ids with a spoken name; anything else prints as its id. */
const KNOWN: Record<string, 'opus' | 'sonnet'> = {
  'claude-opus-5-5': 'opus',
  'claude-sonnet-5-5': 'sonnet',
};

type Tr = ReturnType<typeof useLocale>['tr'];

/** "Opus 5.5" — the short name, or the id itself. */
export function modelName(tr: Tr, id: string): string {
  const k = KNOWN[id];
  return k ? tr(`ws.owner.assistant.model.labels.${k}`) : id;
}

/** "Opus 5.5 · best answers" — the short name with its one-phrase hint, or the id itself. */
export function modelLabel(tr: Tr, id: string): string {
  const k = KNOWN[id];
  return k ? `${tr(`ws.owner.assistant.model.labels.${k}`)} · ${tr(`ws.owner.assistant.model.hints.${k}`)}` : id;
}

/** True when the server refused the model because the pricing table has no rates for it (RPC or edge, both carry it as `code`). */
export function isNotPriced(err: unknown): boolean {
  return (err instanceof AppRpcError || err instanceof EdgeError) && err.code === 'ASSISTANT_MODEL_NOT_PRICED';
}

/** The refusal in one sentence; any other error through the shared mapper. */
export function ModelError({ error }: { error: unknown }) {
  const { tr } = useLocale();
  if (error == null) return null;
  if (!isNotPriced(error)) return <ErrorText error={error} />;
  return (
    <p role="alert" style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>
      {tr('ws.owner.assistant.model.notPriced')}
    </p>
  );
}

/**
 * A model picked while the free AI was on (2026-10-20: Free AI is one more
 * button in the model row, not another page). Pressing Opus or Sonnet there
 * switches back to the paid thread, and the next NEW chat starts on that
 * model: the thread takes it once, on mount.
 */
let pendingNewChatModel: string | null = null;
export function setPendingNewChatModel(model: string | null): void {
  pendingNewChatModel = model;
}
export function takePendingNewChatModel(): string | null {
  const m = pendingNewChatModel;
  pendingNewChatModel = null;
  return m;
}

/**
 * A question the free AI could not answer ("needs your figures"), carried to
 * the paid thread's composer by "Ask the paid assistant instead". It is typed
 * there, not sent: the owner still picks what the chat reads and presses Ask.
 */
let pendingQuestion: string | null = null;
export function setPendingQuestion(text: string | null): void {
  pendingQuestion = text;
}
export function takePendingQuestion(): string | null {
  const q = pendingQuestion;
  pendingQuestion = null;
  return q;
}

/** The quiet outlined button under the composer that opens the model row. */
export const MODEL_TRIGGER_STYLE = {
  minBlockSize: '2.5rem',
  paddingInline: 'var(--tp-sp-3)',
  borderRadius: 'var(--tp-radius-panel)',
  border: '1px solid var(--tp-border-strong)',
  background: 'var(--tp-surface)',
  color: 'var(--tp-fg)',
  fontWeight: 600,
  fontSize: 'var(--tp-fs-sm)',
} as const;

/** The value of the "Venue default" button: the row will say nothing. */
export const VENUE_DEFAULT = '__venue_default__';

/**
 * A row of pressed/unpressed buttons, one per model. With `defaultModel`
 * given, a "Venue default (X)" button leads and selecting it yields `null`.
 */
export function ModelChoice({
  models,
  defaultModel,
  value,
  onChange,
  disabled,
  trailing,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: {
  models: readonly string[];
  /** Offer "Venue default (X)" as the first choice; `null` selects it. */
  defaultModel?: string | null;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /** One more button after the models, in the same row (the chat's "The free AI"). */
  trailing?: ReactNode;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  const { tr } = useLocale();
  const withDefault = defaultModel !== undefined;
  return (
    <div role="group" aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy} style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
      {withDefault && (
        <Button
          size="sm"
          kind={value === null ? 'primary' : 'soft'}
          aria-pressed={value === null}
          data-testid={`model-${VENUE_DEFAULT}`}
          onClick={() => onChange(null)}
          disabled={disabled}
        >
          {tr('ws.owner.assistant.model.venueDefault', { model: defaultModel ? `⁨${modelName(tr, defaultModel)}⁩` : '—' })}
        </Button>
      )}
      {models.map((m) => {
        const active = value === m;
        return (
          <Button key={m} size="sm" kind={active ? 'primary' : 'soft'} aria-pressed={active} data-testid={`model-${m}`} onClick={() => onChange(m)} disabled={disabled}>
            <span dir="auto">{modelLabel(tr, m)}</span>
          </Button>
        );
      })}
      {trailing}
    </div>
  );
}

export function ModelSwitch({
  conversationId,
  value,
  onChange,
  disabled,
  titleHidden,
  onChooseFree,
  compact,
  freeActive,
  onChoosePaid,
}: {
  /** `null` while the chat has no row yet: the choice is held by the parent. */
  conversationId: string | null;
  /** The chat's model, or `null` for the venue default. */
  value: string | null;
  /** Called with the new choice: at once for a new chat, after the row is saved for an existing one. */
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /** The title stays for screen readers but is not drawn (a Disclosure header already shows it). */
  titleHidden?: boolean;
  /** Offer "The free AI" after the models; pressing it switches the assistant, not this chat. */
  onChooseFree?: () => void;
  /**
   * The chat toolbar's form (2026-10-20): short names in one segmented row,
   * the model in use pressed (the venue default when the chat names none), no
   * "Venue default" button and no hint line; each button's title says it.
   */
  compact?: boolean;
  /** The free AI is on (compact only): its button is pressed and no model is. */
  freeActive?: boolean;
  /** While the free AI is on, a model was pressed: switch back to the paid thread with it. */
  onChoosePaid?: (model: string) => void;
}) {
  const { tr } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const titleId = useId();
  const hintId = useId();

  const modelsQ = useQuery({ queryKey: QK.models, queryFn: fetchModels, staleTime: 5 * 60_000 });

  const save = useMutation({
    mutationFn: async (next: string | null) => {
      if (conversationId) await setModel(conversationId, next);
      return next;
    },
    onSuccess: (next) => {
      onChange(next);
      if (conversationId) {
        toast.ok(tr('ws.owner.assistant.model.chatSaved'));
        void qc.invalidateQueries({ queryKey: QK.conversation(conversationId) });
        void qc.invalidateQueries({ queryKey: QK.conversations });
      }
    },
  });

  const models = modelsQ.data?.models ?? [];
  const defaultModel = modelsQ.data?.default_model ?? null;

  const freeButton = onChooseFree ? (
    <Button size="sm" kind="soft" icon="spark" aria-pressed={false} data-testid={`model-${FREE_MODEL_CHOICE}`} onClick={onChooseFree} disabled={disabled}>
      <span dir="auto">{`${tr('ws.assistantFree.name')} · ${tr('ws.assistantFree.hint')}`}</span>
    </Button>
  ) : null;

  if (compact) {
    const inUse = value ?? defaultModel;
    const off = !!disabled || save.isPending;
    return (
      <div data-model-switch="" style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
        {/* Free AI is not a Claude model (Sait, 2026-10-20): it stands apart
            after a rule, in green with a "Free" tag, beside the Claude pair. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2-5)', flexWrap: 'nowrap' }}>
          {/* The app's own segmented control (kit SegmentedControl, the green
              sliding thumb), so the model pick reads like every other choice.
              With the free AI on, no Claude model is chosen: no thumb. */}
          <SegmentedControl
            aria-label={tr('ws.owner.assistant.model.claude')}
            value={freeActive ? '' : (inUse ?? '')}
            onChange={(m) => {
              if (freeActive) onChoosePaid?.(m);
              else if (m !== value && !(value === null && m === defaultModel)) save.mutate(m);
            }}
            options={models.map((m) => ({ value: m, label: <span dir="auto">{modelName(tr, m)}</span>, disabled: off, testId: `model-${m}` }))}
          />
          {onChooseFree && <span aria-hidden="true" style={{ inlineSize: '1px', blockSize: '1.75rem', background: 'var(--tp-border)' }} />}
            {onChooseFree && (
              <button
                type="button"
                aria-pressed={!!freeActive}
                data-testid={`model-${FREE_MODEL_CHOICE}`}
                title={`${tr('ws.assistantFree.name')} · ${tr('ws.assistantFree.hint')}`}
                onClick={() => {
                  if (!freeActive) onChooseFree?.();
                }}
                disabled={!!disabled}
                style={{
                  minBlockSize: '2.375rem',
                  paddingInline: 'var(--tp-sp-3)',
                  borderRadius: 'var(--tp-radius-panel)',
                  border: `1.5px solid ${freeActive ? 'var(--tp-breakdown-green-edge)' : 'var(--tp-card-1)'}`,
                  background: freeActive ? 'var(--tp-card-1)' : 'transparent',
                  color: freeActive ? 'var(--tp-card-ink)' : 'var(--tp-fg)',
                  fontWeight: freeActive ? 700 : 600,
                  fontSize: 'var(--tp-fs-sm)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--tp-sp-1-5)',
                  whiteSpace: 'nowrap',
                  cursor: disabled ? 'default' : 'pointer',
                  opacity: disabled ? 'var(--tp-opacity-disabled)' : undefined,
                }}
              >
                {tr('ws.owner.assistant.model.free')}
                <span style={{ paddingInline: 'var(--tp-sp-1-5)', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-card-ink)', color: 'var(--tp-card-1)', fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.04em', lineHeight: 1.6 }}>
                  {tr('ws.assistantFree.badge')}
                </span>
              </button>
            )}
        </div>
        {modelsQ.isError && <ErrorText error={modelsQ.error} />}
        {save.isError && <ModelError error={save.error} />}
      </div>
    );
  }

  return (
    <div data-model-switch="" style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
      <span id={titleId} style={titleHidden ? { position: 'absolute', inlineSize: 1, blockSize: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } : { fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
        {tr('ws.owner.assistant.model.title')}
      </span>
      {modelsQ.isLoading && <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.model.loading')}</span>}
      {modelsQ.isError && <ErrorText error={modelsQ.error} />}
      {modelsQ.isSuccess && models.length === 0 && <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-warn-fg)' }}>{tr('ws.owner.assistant.model.none')}</span>}
      {models.length > 0 && (
        <ModelChoice
          models={models}
          defaultModel={defaultModel}
          value={value}
          onChange={(next) => {
            if (next !== value) save.mutate(next);
          }}
          disabled={disabled || save.isPending}
          trailing={freeButton}
          aria-labelledby={titleId}
          aria-describedby={hintId}
        />
      )}
      {models.length === 0 && freeButton}
      <p id={hintId} style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', margin: 0 }}>
        {tr('ws.owner.assistant.model.hint')}
      </p>
      {save.isError && <ModelError error={save.error} />}
    </div>
  );
}
