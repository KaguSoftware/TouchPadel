import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@touch/ui';
import { rootRoute } from './routes/__root';
import { indexRoute } from './routes/index';
import { tillRoute } from './routes/till';
import { deskRoute } from './routes/desk';
import { kdsRoute } from './routes/kds';
import { stockRoute } from './routes/stock';
import { adminRoute } from './routes/admin';
import { LocaleProvider, useLocale } from './lib/i18n';
import { AuthProvider } from './lib/auth';

// Code-based route tree for the shell phase. TODO(FE2): switch to file-based codegen
// (@tanstack/router-plugin generating routeTree.gen.ts) once typed search params land.
const routeTree = rootRoute.addChildren([
  indexRoute,
  tillRoute,
  deskRoute,
  kdsRoute,
  stockRoute,
  adminRoute,
]);

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Browser mode: TanStack Query reads + app.* RPC writes. TODO(Electron): durable
// writes move to the IPC bridge -> SQLite queue (design-arch.md §2.1).
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

function ThemedApp() {
  const { dir } = useLocale();
  // Operator surfaces use the padel theme (cafe theme is for guest cafe pages).
  return (
    <ThemeProvider theme="padel" dir={dir}>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <LocaleProvider>
      <ThemedApp />
    </LocaleProvider>
  </StrictMode>,
);
