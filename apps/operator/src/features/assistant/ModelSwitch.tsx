/**
 * The chat model switch (0140, owner call 2026-09-20): every model the
 * pricing table can bill, plus "Venue default" which means the row says
 * nothing and the venue's `llm_default_model` applies. An existing chat is
 * changed through `assistant_set_model` at once; a chat that has no row yet
 * keeps the choice in the parent's state and the first question carries it.
 *
 * The same button row, without the default entry, is `ModelChoice` on the
 * usage page, where it sets the venue default above the pricing table.
 */
import { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '../../lib/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { EdgeError } from '../../lib/edge';
import { useToast } from '../../components/toast';
import { Button, ErrorText } from '../../components/ui';
import { QK, fetchModels, setModel } from './api';

/** Model ids with a spoken name; anything else prints as its id. */
const KNOWN: Record<string, 'opus' | 'sonnet' | 'gptoss'> = {
  'claude-opus-5': 'opus',
  'claude-sonnet-5': 'sonnet',
  'openai/gpt-oss-120b': 'gptoss',
};

type Tr = ReturnType<typeof useLocale>['tr'];

/** "Opus 5" — the short name, or the id itself. */
export function modelName(tr: Tr, id: string): string {
  const k = KNOWN[id];
  return k ? tr(`ws.owner.assistant.model.labels.${k}`) : id;
}

/** "Opus 5 · best answers" — the short name with its one-phrase hint, or the id itself. */
export function modelLabel(tr: Tr, id: string): string {
  const k = KNOWN[id];
  return k ? `${tr(`ws.owner.assistant.model.labels.${k}`)} · ${tr(`ws.owner.assistant.model.hints.${k}`)}` : id;
}

/** True when the server refused the model because the pricing table has no rates for it. */
export function isNotPriced(err: unknown): boolean {
  return (err instanceof AppRpcError && err.code === 'ASSISTANT_MODEL_NOT_PRICED') || (err instanceof EdgeError && err.detail === 'ASSISTANT_MODEL_NOT_PRICED');
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
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: {
  models: readonly string[];
  /** Offer "Venue default (X)" as the first choice; `null` selects it. */
  defaultModel?: string | null;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
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
    </div>
  );
}

export function ModelSwitch({
  conversationId,
  value,
  onChange,
  disabled,
  titleHidden,
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
          aria-labelledby={titleId}
          aria-describedby={hintId}
        />
      )}
      <p id={hintId} style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', margin: 0 }}>
        {tr('ws.owner.assistant.model.hint')}
      </p>
      {save.isError && <ModelError error={save.error} />}
    </div>
  );
}
