import { makeT, type Locale } from '@touch/i18n';
import type { VenueBranch } from '@/lib/menu';
import { branchName } from '@/lib/site/contact';

/**
 * One line above the hero naming the branch whose menu a walk-in is reading,
 * with a way back to the chooser (multi-venue slice 4). CafeApp draws it only
 * for a walk-in while several branches are open; a table guest's branch is the
 * table's, and with one branch there is nothing to say.
 */
export function BranchBar({ locale, branch }: { locale: Locale; branch: VenueBranch }) {
  const tr = makeT(locale);
  return (
    <div className="tp-branchbar">
      <span>
        {tr('branches.common.branch')}:{' '}
        <span className="tp-branchbar__name">{branchName(locale, branch)}</span>
      </span>
      <a href={`/${locale}/menu`}>{tr('branches.common.changeBranch')}</a>
    </div>
  );
}
