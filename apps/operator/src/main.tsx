import { StrictMode, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter, useNavigate } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@touch/ui';
import { rootRoute } from './routes/__root';
import { indexRoute } from './routes/index';
import { tillRoute } from './routes/till';
import { deskRoute } from './routes/desk';
import { kdsRoute } from './routes/kds';
import { stockRoute } from './routes/stock';
import { adminRoute } from './routes/admin';
import { adminChildren } from './routes/admin/_children';
import { analyticsRoute } from './routes/analytics';
import { LocaleProvider, useLocale } from './lib/i18n';
import { AuthProvider, useAuth, homeRoute } from './lib/auth';
import { AppErrorBoundary, CrashPanel, NotFoundPanel } from './components/CrashScreen';
import { captureException, installGlobalHandlers } from './lib/telemetry';
import { initQueueResults } from './lib/queueResults';
import { initOfflineTabRetirement } from './lib/offlineTabs';

// Code-based route tree for the shell phase. TODO(FE2): switch to file-based codegen
// (@tanstack/router-plugin generating routeTree.gen.ts) once typed search params land.
const routeTree = rootRoute.addChildren([
  indexRoute,
  tillRoute,
  deskRoute,
  kdsRoute,
  stockRoute,
  adminRoute.addChildren([...adminChildren]),
  analyticsRoute,
]);

/** Send the operator back to the screen their role starts on; fall back to `/`. */
function useGoHome(): () => void {
  const navigate = useNavigate();
  const { staff } = useAuth();
  return useCallback(() => {
    void navigate({ to: staff ? homeRoute(staff.role) : '/' });
  }, [navigate, staff]);
}

// A thrown screen used to blank the whole station: till and KDS run in kiosk
// mode with no menu bar, and the shell only reloads on `render-process-gone`,
// which a React exception is not.
function RouteErrorScreen({ error, reset }: { error: unknown; reset: () => void }) {
  const goHome = useGoHome();
  return <CrashPanel error={error} onRetry={reset} onHome={goHome} />;
}

function RouteNotFoundScreen() {
  const goHome = useGoHome();
  return <NotFoundPanel onHome={goHome} />;
}

const router = createRouter({
  routeTree,
  defaultErrorComponent: RouteErrorScreen,
  defaultNotFoundComponent: RouteNotFoundScreen,
  // Report before rendering the panel, so a screen that crashes in a loop still
  // produces one report per occurrence rather than none.
  defaultOnCatch: (error) => captureException(error, { boundary: 'route' }),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Browser mode: TanStack Query reads + app.* RPC writes. In Electron the
// registered mutation types flow renderer -> IPC -> SQLite queue -> replay
// (lib/mutate.ts), and their results land here through initQueueResults.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});
initQueueResults(queryClient);
initOfflineTabRetirement();

/**
 * Boundary fallback for everything ABOVE the router — providers, the sidebar
 * shell, sign-in. `reset` re-mounts the subtree; a station that is truly stuck
 * still has "Restart the app" inside the panel.
 */
function ShellCrash({ error, reset }: { error: unknown; reset: () => void }) {
  // No router here (the crash may BE the router), so no "go home" — only retry
  // and reload, both of which work without navigation. CrashPanel reads the
  // locale itself, and LocaleProvider sits outside this boundary.
  return <CrashPanel error={error} onRetry={reset} />;
}

function ThemedApp() {
  const { dir } = useLocale();
  // Operator surfaces use the padel theme (cafe theme is for guest cafe pages).
  return (
    <ThemeProvider theme="padel" dir={dir}>
      <AppErrorBoundary fallback={(error, reset) => <ShellCrash error={error} reset={reset} />}>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </AuthProvider>
      </AppErrorBoundary>
    </ThemeProvider>
  );
}

// Errors React cannot see: handlers that escape, timers, unawaited promises.
// On a kiosk with no devtools these otherwise leave no trace at all.
installGlobalHandlers();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <LocaleProvider>
      <ThemedApp />
    </LocaleProvider>
  </StrictMode>,
);
