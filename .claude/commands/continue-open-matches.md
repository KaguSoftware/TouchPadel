---
description: Resume the open-matches build from where it paused
---

Continue the open-matches build.

1. Read `docs/design/open-matches/CONTINUE.md` in full. It says what is done, what is next, and how to
   run it.
2. Read `docs/design/open-matches/build-contracts-2026-09-27.md` §0 and §1 (binding decisions and names,
   including the §1.12 merge rulings).
3. Check the state: `git status`, `git log --oneline -5`, the latest migration ordinal, and whether
   `docs/design/open-matches/drafts/review-*.md` exist.
4. Pick up at the first step in CONTINUE.md that is not finished. Use workflows. Keep CONTINUE.md's
   "Where things stand" table current as each step lands, so the build can pause again at any point.
5. Do not commit or push until Parsa says so.

$ARGUMENTS
