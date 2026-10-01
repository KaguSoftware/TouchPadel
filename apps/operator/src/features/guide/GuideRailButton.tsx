/**
 * The rail footer's "Guide" row (court desk, till, Touch Shop), the first row
 * of the footer, above the options group. The kitchen has no rail; its guide
 * opens from the key legend's pill instead (KitchenDisplayScreen). Renders
 * nothing for a workspace without a guide (manager, owner, team).
 */
import type { CSSProperties } from 'react';
import { useLocale } from '../../lib/i18n';
import { Icon } from '../../components/icons';
import { useGuideOrNull } from './GuideProvider';

export function GuideRailButton({ style }: { style?: CSSProperties }) {
  const { tr } = useLocale();
  const guide = useGuideOrNull();
  if (!guide?.available) return null;
  return (
    <button
      type="button"
      className="tp-nav-item"
      style={style}
      data-testid="rail.guide"
      aria-haspopup="dialog"
      aria-expanded={guide.open}
      onClick={guide.openGuide}
    >
      <Icon name="bookOpen" size={16} />
      <span style={{ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tr('ws.guide.chrome.open')}
      </span>
    </button>
  );
}
