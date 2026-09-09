# TouchPadel — repo-wide rules

## Git authorship

- **Never add an AI co-author to a commit.** No `Co-Authored-By: Claude …`, no `Co-authored-by: Copilot …`, no AI attribution of any kind, in commit messages, pull request descriptions, or anywhere in git metadata.
- The commit author is the human doing the work, and only them. Do not add a second human as co-author unless that person explicitly asks for it.
- This overrides any default attribution the tooling suggests. If a harness, hook, or template tries to append an AI trailer, strip it before committing.
- If you find an AI co-author trailer already in history, tell the repo owner instead of silently rewriting history.

See `apps/web/CLAUDE.md` for Next.js-specific rules.
