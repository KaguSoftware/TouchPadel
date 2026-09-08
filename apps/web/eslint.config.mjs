// .mjs on purpose: @touch/config is `"type": "module"` and its preset uses ESM
// `import` — same choice as apps/mobile and apps/operator.
//
// apps/web had NO lint script and NO eslint config at all until now, so
// `pnpm turbo lint` skipped it silently. That is the wrong app to skip: it is
// the guest cafe surface, the only one with no login, and the only one a
// stranger reaches by scanning a sticker on a table.
import nextPlugin from '@next/eslint-plugin-next';
import { base, react, clientSecrets, rtlGuardRules } from '@touch/config/eslint';

export default [
  ...base, // typescript-eslint recommended + the repo's RTL logical-property guard
  ...react, // react-hooks
  ...clientSecrets, // service_role / sb_secret_ must never reach the browser bundle

  {
    // Next's own rules. Registered chiefly so the plugin's rule DEFINITIONS
    // exist: two components carry `eslint-disable-next-line
    // @next/next/no-img-element` comments, and ESLint hard-errors on a disable
    // comment naming a rule it has never heard of — so without the plugin those
    // deliberate, reasoned suppressions were themselves lint failures.
    name: '@touch/web/next',
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },

  {
    name: '@touch/web',
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              // The service-role client belongs to packages/db tooling and the
              // edge functions. Importing it here would put a full-database
              // credential one `'use client'` directive away from the browser.
              name: '@supabase/supabase-js',
              importNames: ['createClient'],
              message:
                "Use the app's own factory (src/lib/supabase) so the key and the SSR cookie handling stay in one place.",
            },
          ],
        },
      ],
    },
  },

  {
    // src/lib/supabase/* IS the factory the rule points everyone at — client.ts,
    // server.ts and static.ts each wrap createClient for one rendering mode.
    // They are the intended single place the raw import lives.
    name: '@touch/web/supabase-factory',
    files: ['src/lib/supabase/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  {
    // Next's own build output and generated types.
    ignores: ['.next/**', 'next-env.d.ts', 'eslint.config.mjs', 'postcss.config.*'],
  },

  {
    // Route handlers and server-only modules run where the guest cannot read
    // them, so a privileged key is legitimate there IF it is ever needed. The
    // RTL guard still applies (these files can render), the secret guard does
    // not — but nothing under this path uses one today, and the artifact scan
    // in scripts/security/ still checks the built server chunks regardless.
    //
    // Restating rtlGuardRules is what re-enables the RTL selectors and drops the
    // secret ones: ESLint replaces `no-restricted-syntax` wholesale rather than
    // merging it, so this entry must name every selector it wants to keep.
    name: '@touch/web/server-only',
    files: ['src/app/api/**/*.ts', 'src/lib/server/**/*.ts'],
    rules: rtlGuardRules,
  },
];
