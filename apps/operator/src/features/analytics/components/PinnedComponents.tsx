/**
 * Every component the owner pinned from the assistant (kind = 'pinned'), as a
 * card on the analytics tab, regenerated for the page's own range through the
 * same cache as the built-ins (plan §5.4 pinned components, DECIDE 13).
 *
 * The list is read straight from `assistant_components` under RLS. Removing a
 * card is an archive (the chat answer it came from stays), confirmed first.
 */
import { useQueryClient } from '@tanstack/react-query';
import type { CompareBasis, DateRange } from '@touch/core';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useToast } from '../../../components/toast';
import { useLocale } from '../../../lib/i18n';
import type { Formatters } from '../format';
import { AssistantComponentCard } from './AssistantComponentCard';
import { componentParams, PINNED_COMPONENTS_KEY, type ComponentScope } from './params';
import { archivePinned } from './pin';
import { usePinnedComponents } from './useAssistantComponent';

export function PinnedComponents({
  scope,
  range,
  compareBasis,
  courtId = null,
  f,
}: {
  scope: ComponentScope;
  range: DateRange;
  compareBasis: CompareBasis;
  courtId?: string | null;
  f: Formatters;
}) {
  const { tr, locale } = useLocale();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const pinned = usePinnedComponents();

  // Pinned cards without a scope belong to both tabs; a scoped one to its tab.
  const rows = (pinned.data ?? []).filter((r) => {
    const s = r.default_params?.scope;
    return s === undefined || s === null || s === scope;
  });
  if (!rows.length) return null;

  async function archive(key: string, question: string) {
    const ok = await confirm({ title: tr('ws.analytics.components.archive'), body: `${tr('ws.analytics.components.archivePrompt')}\n\n${question.split('\n')[0]}`, kind: 'danger' });
    if (!ok) return;
    try {
      await archivePinned(key);
      toast.ok(tr('ws.analytics.components.archived'));
      void queryClient.invalidateQueries({ queryKey: PINNED_COMPONENTS_KEY });
    } catch (e) {
      toast.err(e);
    }
  }

  return (
    <>
      {rows.map((row) => (
        <AssistantComponentCard
          key={row.key}
          componentKey={row.key}
          title={tr('ws.analytics.components.pinned')}
          params={componentParams({ range, compareBasis, scope, courtId, locale })}
          f={f}
          pinned={{ question: row.question, onArchive: () => void archive(row.key, row.question) }}
        />
      ))}
    </>
  );
}
