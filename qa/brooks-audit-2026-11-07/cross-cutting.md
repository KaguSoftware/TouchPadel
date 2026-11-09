# Cross-cutting (tool) results

## jscpd (min 15 lines / 100 tokens, tests + smoke + generated types excluded)
- 1,805 duplicated lines of 432,164 = 0.42%, 38 clones. Copy-paste is NOT the problem.
- Largest: core analytics insightsContract/insightsText ↔ edge _shared copies (430 + 277 lines) —
  INTENTIONAL, header-documented, guarded by packages/db/tests/insights-text-parity.test.ts → looks bad but fine.
- Real clones worth a look:
  - apps/mobile/app/(coaching)/lesson-review.tsx:177 ↔ lesson-times.tsx:277 (148 lines) + :333↔:419 (40)
  - apps/operator/src/features/admin/RateRuleEditor.tsx:228 ↔ genderHours/GenderHoursEditor.tsx:182 (80) + :426↔:376 (25)
  - apps/operator/src/features/till/FloorView.tsx:602↔:615 (64, self-clone)
  - apps/operator/src/features/coaching/AddStudentDialog.tsx:238 ↔ matches/AddSeatDialog.tsx:232 (54)
  - apps/mobile/app/review.tsx:374↔:448 (50, self-clone); review.tsx:601 ↔ success.tsx:152 (26)
  - cross-app: operator↔mobile telemetry.ts (31+19), assistant sse.ts (30), assistant chat (22),
    desk/eventBlock.ts ↔ mobile staff/protocols/logic.ts (26+21+18 — same protocol-event logic in both apps),
    mobile↔web monitoring.ts (20), brandPattern.ts (23), operator lib/edge.ts:332 ↔ mobile assistant/api.ts:205 (17)

## knip (default config, no knip.json)
- Mostly false positives: edge-function entry points (Deno), electron preload, `.ios.tsx` platform files,
  one-off scripts, .claude/skills scripts. Raw counts (77 files / 454 exports) are NOT meaningful without a config.
- Verified real (grep-gated):
  - apps/operator/package.json: `qrcode` + `@types/qrcode` — no import anywhere in apps/operator
  - apps/mobile/package.json: `@touch/ui` — no import anywhere in apps/mobile
  - apps/mobile/src/components/SmileyBall.tsx — no importer; a test asserts the boot overlay must NOT use it
  - apps/web/src/components/cafe/{BasketSheet,ItemSheet,QrRequiredSheet}/index.ts barrels — every importer
    bypasses them and imports the inner file directly
