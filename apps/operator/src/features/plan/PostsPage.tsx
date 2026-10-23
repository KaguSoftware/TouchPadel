/**
 * Sent for approval (0362): marketing's posts and plan results for the
 * owner's approval (0199), on a page of their own instead of under My tasks.
 * What the owner sent back opens first. `?open=<id>` opens one item's sheet,
 * as the plan's "Open result" does.
 */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useLocale } from '../../lib/i18n';
import { PageHeader } from '../../components/kit';
import { MarketingContentPanel } from '../content/ContentSection';
import type { PostsSearch } from './search';

export function PostsScreen() {
  const { tr } = useLocale();
  const search = useSearch({ strict: false }) as PostsSearch;
  const navigate = useNavigate();
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', alignContent: 'start' }}>
      <PageHeader title={tr('ws.plan.posts.title')} subtitle={tr('ws.plan.posts.lead')} style={{ marginBlockEnd: 0 }} />
      <MarketingContentPanel
        key={search.open ?? ''}
        openId={search.open ?? null}
        onOpenChange={(id) => void navigate({ to: '/posts', search: (id ? { open: id } : {}) as never, replace: true })}
      />
    </div>
  );
}
