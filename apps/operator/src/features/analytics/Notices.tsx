/**
 * The page-level notice line under the sticky bar: coverage gaps, the
 * engagement floor, a missing PostHog project, missing opening hours. These
 * are STATE, so they stay visible (an explanation would go in a tip). The
 * line is rendered even when empty so the zones below never shift.
 */
import type { ReactNode } from 'react';
import { Button } from '../../components/ui';
import { useLocale } from '../../lib/i18n';
import { muted } from './cards/CardShell';

export function Notices({ lines, onRetry }: { lines: readonly ReactNode[]; onRetry?: () => void }) {
  const { tr } = useLocale();
  return (
    <div style={{ marginBlockEnd: 'var(--tp-sp-2-5)', minBlockSize: '1.25rem', display: 'flex', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
      {lines.map((line, i) => (
        <span key={i} style={muted}>
          {line}
        </span>
      ))}
      {onRetry && (
        <Button onClick={onRetry} style={{ fontSize: 'var(--tp-fs-sm)', paddingBlock: 'var(--tp-sp-1)' }}>
          {tr('common.retry')}
        </Button>
      )}
    </div>
  );
}
