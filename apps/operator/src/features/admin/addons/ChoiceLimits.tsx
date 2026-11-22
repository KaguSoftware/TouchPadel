/**
 * How many options a guest may pick in a group, said in words.
 *
 * The screens printed this as "(0–1)", "0–2 · 1 · 5" and two bare number boxes
 * with a "/" between them. Staff read "Optional · choose up to 2" instead.
 */
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { choiceRule } from './addonsLogic';

/** "Required · choose 1" / "Required · choose 1 to 3" / "Optional · choose up to 2". */
export function useChoiceRuleText(): (min: number, max: number) => string {
  const { tr, locale } = useLocale();
  return (min, max) => {
    const rule = choiceRule(min, max);
    const n = (v: number) => formatNumber(v, locale);
    if (rule.kind === 'exactly') return tr('op.addons.ruleExactly', { count: n(rule.count) });
    if (rule.kind === 'range')
      return tr('op.addons.ruleRange', { min: n(rule.min), max: n(rule.max) });
    return tr('op.addons.ruleUpTo', { max: n(rule.max) });
  };
}
