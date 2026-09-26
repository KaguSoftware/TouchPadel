/**
 * How many options a guest may pick in a group, said in words.
 *
 * The screens printed this as "(0–1)", "0–2 · 1 · 5" and two bare number boxes
 * with a "/" between them, validated by "Min choices ≤ Max choices · Max
 * choices ≥ 1". Staff read "Optional · choose up to 2" and type into a
 * sentence instead.
 */
import { useId } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { inputStyle } from '../../../components/ui';
import { choiceRule, minMaxError } from './addonsLogic';

/** "Required · choose 1" / "Required · choose 1 to 3" / "Optional · choose up to 2". */
export function useChoiceRuleText(): (min: number, max: number) => string {
  const { tr, locale } = useLocale();
  return (min, max) => {
    const rule = choiceRule(min, max);
    const n = (v: number) => formatNumber(v, locale);
    if (rule.kind === 'exactly') return tr('op.addons.ruleExactly', { count: n(rule.count) });
    if (rule.kind === 'range') return tr('op.addons.ruleRange', { min: n(rule.min), max: n(rule.max) });
    return tr('op.addons.ruleUpTo', { max: n(rule.max) });
  };
}

const numStyle = { ...inputStyle, inlineSize: '4.5rem', textAlign: 'center' as const };

/** "At least [0] · At most [1]", the rule it makes, and an error in a sentence. */
export function ChoiceLimits({
  min,
  max,
  onMin,
  onMax,
  disabled,
}: {
  min: number;
  max: number;
  onMin: (n: number) => void;
  onMax: (n: number) => void;
  disabled?: boolean;
}) {
  const { tr } = useLocale();
  const ruleText = useChoiceRuleText();
  const minId = useId();
  const maxId = useId();
  const labelId = useId();
  const err = minMaxError(min, max);
  const errText = err === 'min' ? tr('op.addons.errMin') : err === 'max' ? tr('op.addons.errMax') : err === 'order' ? tr('op.addons.errOrder') : null;
  const parse = (raw: string) => Math.max(0, Math.floor(Number(raw) || 0));

  return (
    <div role="group" aria-labelledby={labelId} style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', marginBlockEnd: 'var(--tp-sp-2)' }}>
      <span id={labelId} style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
        {tr('op.addons.limits')}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <label htmlFor={minId} style={{ fontSize: 'var(--tp-fs-sm)' }}>
          {tr('op.addons.atLeast')}
        </label>
        <input id={minId} style={numStyle} dir="ltr" type="number" min={0} value={min} disabled={disabled} aria-invalid={err === 'min' || err === 'order' || undefined} onChange={(e) => onMin(parse(e.target.value))} />
        <label htmlFor={maxId} style={{ fontSize: 'var(--tp-fs-sm)', marginInlineStart: 'var(--tp-sp-2)' }}>
          {tr('op.addons.atMost')}
        </label>
        <input id={maxId} style={numStyle} dir="ltr" type="number" min={1} value={max} disabled={disabled} aria-invalid={err === 'max' || err === 'order' || undefined} onChange={(e) => onMax(parse(e.target.value))} />
        {!errText && <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginInlineStart: 'var(--tp-sp-2)' }}>{ruleText(min, max)}</span>}
      </div>
      {errText && (
        <span role="alert" style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-danger-fg)' }}>
          {errText}
        </span>
      )}
    </div>
  );
}
