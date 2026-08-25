/**
 * Helpers shared by the /admin child routes: a per-section role guard wrapper
 * (belt; RLS + in-RPC guards are braces) and the Suspense fallback used while
 * a lazily-loaded section chunk downloads.
 */
import type { ComponentType, ReactElement } from 'react';
import { RequireRole } from '../__root';
import { Spinner } from '../../components/ui';

export function guarded(route: string, Component: ComponentType): () => ReactElement {
  return function GuardedSection() {
    return (
      <RequireRole route={route}>
        <Component />
      </RequireRole>
    );
  };
}

export function RoutePending() {
  return (
    <div style={{ paddingBlock: '2rem', display: 'flex', justifyContent: 'center' }}>
      <Spinner size="md" />
    </div>
  );
}
