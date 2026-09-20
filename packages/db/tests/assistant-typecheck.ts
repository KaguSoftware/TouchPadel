/**
 * Typecheck anchor for the assistant's pure edge modules (contracts, Lane C
 * verification). `supabase/functions/**` is outside tsconfig's `include`, so
 * this file — which IS included — imports every pure module and drags them
 * into `pnpm --filter @touch/db typecheck`. It is not a test; vitest ignores
 * it (no `.test.ts` suffix). The Deno-only modules (provider.ts, map.ts, the
 * three index.ts) import `npm:` specifiers and `Deno` and are NOT checked here.
 */
import * as clean from '../supabase/functions/_shared/assistant/clean.ts';
import * as embed from '../supabase/functions/_shared/assistant/embed.ts';
import * as estimate from '../supabase/functions/_shared/assistant/estimate.ts';
import * as gate from '../supabase/functions/_shared/assistant/gate.ts';
import * as handles from '../supabase/functions/_shared/assistant/handles.ts';
import * as prompt from '../supabase/functions/_shared/assistant/prompt.ts';
import * as recheck from '../supabase/functions/_shared/assistant/recheck.ts';
import * as scopes from '../supabase/functions/_shared/assistant/scopes.ts';
import * as sse from '../supabase/functions/_shared/assistant/sse.ts';
import * as tools from '../supabase/functions/_shared/assistant/tools.ts';
import * as groqWire from '../supabase/functions/_shared/assistant/groqWire.ts';

export const ASSISTANT_PURE_MODULES = { clean, embed, estimate, gate, groqWire, handles, prompt, recheck, scopes, sse, tools } as const;
