---
id: my-check
title: One line naming what the check enforces
kind: scripted
analyser: scripts/checks/my-check.mjs
severity: error
config: [checks.my-check.someThreshold]
staff: [staffExceptions.my-check.someThreshold]
exempt: exempt.my-check
---

# How to add a check

Copy this file to `checks/<id>.md`, where `<id>` is a short kebab-case name, and fill in every
section below. Keep the header fields and the section headings exactly as they are. The runner
(`scripts/run.mjs`) finds checks by listing `checks/*.md`. Files whose names start with `_` are
skipped, so this template never runs. You do not need to edit anything else: SKILL.md,
config.json and run.mjs all stay as they are.

There are two kinds of check:

- **Scripted** (`kind: scripted`): add `scripts/checks/<id>.mjs` next to the doc. The runner
  imports it and calls it with the crawl snapshot:

  ```js
  export default {
    id: '<id>',                       // must equal the file name and the header id
    defaults: { someThreshold: 3 },   // config.json checks.<id> is merged over these
    run(snapshot, cfg, ctx) {
      // cfg: this check's config (defaults < config.json checks.<id>)
      // ctx.cfgFor(staff): the same with staffExceptions.<id> merged on top when staff is true
      // ctx.uniqueElements(snapshot) / ctx.uniqueCards(snapshot): records deduped per viewport,
      //   each { vp, rec, screens[], staffAll }
      // ctx.tokensOf(snapshot, vp, rec): design tokens resolved AT that element (px / rgb)
      // ctx.source.resolve(classes): { primary: {file,line,selector}, jsx: {file,line} }
      // ctx.source.declsFor(cls): every CSS declaration that styles a class
      // ctx.ds: design-system.json; ctx.config: config.json
      return { findings: [/* see below */], info: ['one line printed under the verdict'] };
    },
  };
  ```

  A finding is
  `{ check, severity: 'error'|'warn', key, screen, viewport, staff, message, evidence, source?, path? }`.
  `key` is what `exempt.<id>` matches. `message` is the line Majed reads, so state the measured
  value, the canon value and the rule. `source` is `file:line · Component.tsx:line`. The runner
  applies `exempt.<id>`, applies the `staffExceptions.<id>` `exempt`/`severity` keys, merges
  identical findings across viewports, and prints the result. `run` may be async. The runner
  validates the shape (`key`, `message`, `viewport` strings, `severity` `error`|`warn`); a load
  error, a throw or a wrong shape becomes this check's `CRASH` line and exit 2, while the
  other checks still run and print. Use only Node built-ins and the helpers in
  `scripts/lib/`, and add no dependencies. `ctx.source.resolveEl(rec)` / `sourceText` only
  name rules that were live on the record's page (`rec.css`), so a source line is never a
  stylesheet the page did not load.

  What a snapshot state records: `pathname`, `layer` (the open dialog or sheet, or `page`),
  `depth`, `path` (the click keys that lead to it), `staff`, `root`/`rootKind` (`start` for
  /en, `seed` for config.json seedPaths) and `shot` (a screenshot path, for the first state of
  each page/layer). Element records hold `key`, `kind`, `tag`, `classes`, `rect`, `hit`
  (effective hit area), `inline` (an inline link sharing a line box with non-link text),
  `hasBox`, `hasText` (false for icon-only controls), `label` (type of the element that holds
  the visible label: font family, size, weight, tracking, case), `family` (`padel`|`cafe`),
  `mode`, `dir`, `tok`, `css` (the page's live-selector set id) and `style` (computed: font
  family, padding, borders with style and colour, radius, colours, font size, weight,
  tracking, case, shadow, min height). Card records hold the same
  style data. When your check needs something the crawl does not record yet, add it to
  `scripts/lib/page-probe.mjs` in full mode. That is the one shared file a check may extend,
  and only by adding new fields.

- **Doc-only** (`kind: doc`, `analyser: none`): there is no script. The runner prints
  `DOC <id>` in the report, and Claude carries out the check by following the "How it is
  measured" section: reading the code, `test-results/ux-run/snapshot.json` and the
  screenshots in `test-results/ux-run/shots/<viewport>/`. Claude reports its findings in the
  same format as the scripted checks (severity, screen, key, message, source).

Put the check's thresholds in `config.json` under `checks.<id>`. Put its staff-screen
overrides under `staffExceptions.<id>` and its exemptions under `exempt.<id>`. All three are
optional, because the analyser's `defaults` apply when a key is missing.

## Enforces

The rule, stated so a reader can tell a pass from a fail.

## Why

The user-facing reason, and the design-system or WCAG source (file and section).

## Thresholds and config keys

| key | default | meaning |
| --- | --- | --- |
| `checks.<id>.someThreshold` | 3 | … |

## How it is measured

Which analyser is used, what it reads from the snapshot, and how it groups and dedupes.

## Staff screens

Which `staffExceptions.<id>` keys apply on screens matched by `staffScreens`, and why staff
screens get them.

## False positives

The cases where the measurement is known to mislead, and how the check avoids them.

## How to fix

What the FIX phase changes, with the canonical values (tokens and shared classes). It never
goes past those: no new tokens without approval, and no navigation changes without approval.

## How to exempt

The exact `exempt.<id>` entry (the key, or a `/regex/`) and the reason to write next to it.
