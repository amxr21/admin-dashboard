# Branch protection setup

CI checks are only useful if GitHub is configured to **require them** before merge. Without branch protection, checks are advisory — a red PR can still be merged. This is the one-time UI setup.

**Do this AFTER the first CI run on `dev`**, not before. GitHub's status-check picker is empty until a workflow has reported at least once — see `FOUNDATIONS.md` → "What comes next" for why the ordering matters.

Two rulesets — `main` (strict) and `dev` (lightweight). The battery differs per merge type, matching `merge-gate.md`.

---

## Ruleset 1 — `main` (production, strict)

For `dev → main` merges.

1. GitHub → **Settings** → **Rules** → **Rulesets** → **New branch ruleset**.
2. **Name:** `main-protection`.
3. **Enforcement status:** Active.
4. **Target branches:** Include default branch (`main`).
5. **Bypass list:** leave empty — including yourself. This is the last line of defense before production.
6. Enable:

   **Restrict deletions** ✓

   **Require a pull request before merging** ✓
   - Required approvals: **0** — solo project. Raise to 1+ the day a second person joins.
   - Require review from Code Owners: leave off while approvals are 0 (CODEOWNERS is already in place for when this flips)

   **Require status checks to pass** ✓
   - Require branches to be up to date before merging: ✓
   - Required checks (full battery):
     - `CI passed` ← the aggregator job in `ci.yml`
     - `Playwright` ← from `e2e.yml`
     - `CodeQL analysis` ← from `security.yml`
     - `Vercel` (appears automatically once the repo is connected to Vercel)
     - `Render` (appears automatically once connected — see `backend/render.yaml`)

   **Require linear history** ✓ — no merge commits, keeps `git log` readable.

   **Block force pushes** ✓.

7. Save.

---

## Ruleset 2 — `dev` (integration, lightweight)

For feature branches merging into `dev`.

1. Same path → **New branch ruleset**.
2. **Name:** `dev-protection`.
3. **Enforcement status:** Active.
4. **Target branches:** Include `dev`.
5. **Bypass list:** leave empty.
6. Enable:

   **Restrict deletions** ✓

   **Require a pull request before merging** ✓
   - Required approvals: **0** — still get the checks without blocking on a reviewer that doesn't exist yet.

   **Require status checks to pass** ✓
   - Require branches to be up to date before merging: ✓
   - Required checks (LIGHTWEIGHT battery only):
     - `CI passed` ← lint + typecheck + unit tests + build, both packages
     - `Vercel` (preview deploy, useful even solo — click through before merging)
   - **Deliberately NOT required here:** `Playwright`, `CodeQL analysis` — both run only on PRs targeting `main` (see the `on:` block in each workflow). Too slow to gate every feature branch.

   **Block force pushes** ✓.

7. Save.

---

## Why two rulesets

Full E2E + security on every feature PR makes iteration crawl. Nothing checked until `dev → main` lets integration breakage compound silently. Two rulesets: fast feedback while integrating (`dev`), rigorous verification before production (`main`).

---

## GitHub repo secrets — required for CI to work

**Settings → Secrets and variables → Actions.** Base CI (lint/typecheck/test/build) needs none of these — it runs entirely against the checked-out code.

| Secret | Used by | Where to get it |
|---|---|---|
| `VERCEL_TOKEN` | `e2e.yml`, to look up the preview URL | Vercel → Account Settings → Tokens |
| `RENDER_API_KEY` | `e2e.yml`, once the Render preview lookup is implemented (currently a placeholder — see the TODO in `e2e.yml`) | Render → Account Settings → API Keys |
| `SENTRY_AUTH_TOKEN` | Not used by CI. Set in **Vercel's** env vars for source-map upload at build time — see `frontend/.env.example`. | Sentry → Settings → Auth Tokens (`project:releases` scope) |

Backend secrets (`DATABASE_URL`, `SENTRY_DSN`, `CORS_ORIGINS`) are **not** GitHub secrets — they're set directly in the Render dashboard per environment, per `backend/render.yaml`. CI's own `backend-test` job uses a throwaway MySQL service container, not Aiven.

## Verification

1. Open a PR that intentionally breaks something — a lint error is the fastest to fake.
2. Push it.
3. Watch `CI passed` turn red.
4. Try to merge. GitHub should refuse.

If it doesn't refuse, re-check "Require status checks to pass" — the most common cause is a check name that doesn't exactly match the job's `name:` field in the workflow file.

## Common pitfalls

- **Status check names must match exactly.** Rename a job in `ci.yml` → update the ruleset too.
- **Checks must have run at least once to appear in the picker.** Push a commit to `dev` first.
- **Admin override.** By default repo admins can bypass rules — you are that admin. Leave the bypass list empty rather than relying on self-discipline.
- **Aiven, not Render Postgres.** `render.yaml` deliberately provisions no database — `DATABASE_URL` is `sync: false` and points at Aiven MySQL, set per environment in the dashboard. Don't let Render's blueprint UI offer to create a database; decline it.
