/**
 * The start of a price or promo change as a button, and the note that says
 * why a price is read-only (build-contracts-2026-09-23 §5.5). Shared by
 * Promotions, Rates, the hero builder, Stock ▸ Products and Add-ons; the why
 * and the pure half are in priceChange.ts.
 *
 * A start renders only for a caller who may start a change AND open
 * /protocols: a manager or the owner. Marketing may start one too, but from
 * /tasks, and never reaches these screens.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { can, canAccess, useAuth } from '../../../lib/auth';
import { Button, type ButtonKind, type ButtonSize } from '../../../components/ui';
import { MessagePresenter } from '../../../components/kit';
import type { IconName } from '../../../components/icons';
import { priceChangeSearch, type PriceChangeTarget } from './priceChange';

/** Opens the start for a target, or null when the caller cannot start one here. */
export function usePriceChangeStart(): ((target: PriceChangeTarget) => void) | null {
  const { staff } = useAuth();
  const navigate = useNavigate();
  const role = staff?.role;
  if (!can(role, 'startProtocolPriceChange') || !canAccess(role, '/protocols')) return null;
  return (target) => void navigate({ to: '/protocols', search: priceChangeSearch(target) });
}

export function PriceChangeButton({
  target,
  label,
  ariaLabel,
  kind = 'default',
  size,
  icon,
}: {
  target: PriceChangeTarget;
  label: string;
  /** For a start repeated per row: names the row ("Put on sale: Oat milk"). */
  ariaLabel?: string;
  kind?: ButtonKind;
  size?: ButtonSize;
  icon?: IconName;
}) {
  const start = usePriceChangeStart();
  if (!start) return null;
  return (
    <Button kind={kind} size={size} icon={icon} iconEnd="arrowUpRight" aria-label={ariaLabel} onClick={() => start(target)}>
      {label}
    </Button>
  );
}

/**
 * Said once, where the read-only controls are, in place of the "needs the
 * owner role" notice: the manager is not refused, they propose.
 */
export function PriceLockNote({ message, style }: { message: ReactNode; style?: CSSProperties }) {
  return <MessagePresenter tone="info" icon="lock" message={message} style={style} />;
}
