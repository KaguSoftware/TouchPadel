import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { rootRoute } from './routes/__root';
import { indexRoute } from './routes/index';
import { tillRoute } from './routes/till';
import { deskRoute } from './routes/desk';
import { kdsRoute } from './routes/kds';
import { stockRoute } from './routes/stock';
import { adminRoute } from './routes/admin';

// Code-based route tree for the shell phase. TODO(FE2): switch to file-based codegen
// (@tanstack/router-plugin generating routeTree.gen.ts) once real feature routes with
// typed search params (?tab=, ?date= — design-arch.md §2.1) start landing.
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

// TanStack Query for READS only — every durable write goes through the IPC bridge
// to the main-process SQLite queue, even when online (design-arch.md §2.1).
const queryClient = new QueryClient();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
