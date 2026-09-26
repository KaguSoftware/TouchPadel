import { makeT, type Locale } from '@touch/i18n';
import type { VenueBranch } from '@/lib/menu';
import { branchAddress, branchName } from '@/lib/site/contact';

/**
 * The walk-in branch chooser (multi-venue slice 4): `/{locale}/menu` with no
 * table cookie, several open branches and no `?b=<slug>` naming one of them.
 * Every branch is a plain link to `/{locale}/menu?b=<slug>`, so it works before
 * (and without) hydration; the menu page reads the slug. A guest at a table
 * never sees this: the table's QR decides the branch. Server component.
 */
export function BranchChooser({
  locale,
  branches,
}: {
  locale: Locale;
  branches: readonly VenueBranch[];
}) {
  const tr = makeT(locale);
  return (
    <main className="tp-boot tp-branches">
      <h1>{tr('branches.web.menuPickerTitle')}</h1>
      <p>{tr('branches.web.menuPickerHint')}</p>
      <ul className="tp-branches__list" aria-label={tr('branches.common.chooseBranch')}>
        {branches.map((b) => {
          const address = branchAddress(locale, b, { fallback: false });
          return (
            <li key={b.id}>
              <a
                className="tp-branches__option"
                href={`/${locale}/menu?b=${encodeURIComponent(b.slug)}`}
              >
                <span className="tp-branches__name">{branchName(locale, b)}</span>
                {address ? <span className="tp-branches__address">{address}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
