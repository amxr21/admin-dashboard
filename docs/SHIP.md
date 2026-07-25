# admin-dashboard — SHIP

The CI/CD layer: what runs on every PR, what blocks a merge, and what you still need to do in the GitHub/Render/Vercel UI for it to take effect. Read this once, then `branch-protection.md` when you're ready to lock the branches.

---

## The 7 categories

### 1. Lint
`.github/workflows/ci.yml` — `frontend-lint` / `backend-lint`. Same `pnpm lint` you run locally, in CI. Blocks merge once branch protection is on.

### 2. Strict typecheck
`frontend-typecheck` / `backend-typecheck` — `tsc --noEmit`, both packages.

### 3. Tests
`frontend-test` / `backend-test` — Vitest, with coverage. `backend-test` starts a **throwaway MySQL 8 service container** and runs `prisma migrate deploy` against it before the suite — never Aiven, never `migrate dev`. One real test exists on each side (`backend/src/__tests__/health.test.ts`, `frontend/e2e/smoke.spec.ts`) so the pipeline proves something true, not an empty suite. `.github/workflows/e2e.yml` runs Playwright against live Vercel + Render preview URLs, PRs targeting `main` only.

**Coverage thresholds are currently 0.** They fail from day one otherwise, which teaches everyone to ignore a red CI — worse than no threshold. `project-test-gen` raises them as it writes tests: backend target 70/70/65/70 (lines/functions/branches/statements), frontend 60/60/60/60.

### 4. Build check
`frontend-build` (`next build`) / `backend-build` (`tsc` + `prisma generate`) — produces the actual deployable artifact, not just a type-check pass.

### 5. Security scans
`.github/workflows/security.yml` — CodeQL, PRs to `main` + weekly schedule. `.github/dependabot.yml` — weekly grouped dependency PRs, monthly Action version bumps. `.github/workflows/nightly.yml` — daily `pnpm audit --audit-level=high` as a safety net between Dependabot runs.

### 6. Code quality gates
Coverage thresholds (see #3) plus the `ci-passed` aggregator job — branch protection requires only that one check, so jobs can be added or removed without touching the GitHub ruleset every time.

### 7. Preview deploys
Vercel: automatic once the repo is connected — nothing to configure here. Render: `backend/render.yaml`, `previews.generation: automatic`, torn down after 3 days. **Not** using Render's managed database — this project's MySQL is on Aiven; `DATABASE_URL` is `sync: false` and set per environment in the Render dashboard.

Plus: **Husky** (`.husky/pre-commit` runs `lint-staged`, `.husky/pre-push` runs `pnpm typecheck`) and **CODEOWNERS** (in place now for when a second person joins — currently unenforced, 0 required approvals).

---

## Why the workspace layout changes the workflow shape

This is a **pnpm workspace with one root lockfile**, not two independent packages each with their own. Every CI job runs `pnpm install --frozen-lockfile` once at the repo root, then `pnpm --filter ./frontend <script>` or `--filter ./backend`. There is no per-package install step — a per-package `--frozen-lockfile` would fail outright, since only the root has a lockfile.

Same reasoning shaped Dependabot: one `npm` ecosystem entry at `directory: /`, not two.

---

## What you need to do next

1. **Add repo secrets** (Settings → Secrets and variables → Actions) — see `branch-protection.md` for the full list and where each comes from. Base CI needs none; `VERCEL_TOKEN` is only for the E2E workflow's preview-URL lookup.
2. **Connect Vercel** to the repo (frontend root: `frontend/`).
3. **Connect Render** via Blueprint, pointing at `backend/render.yaml` — decline any offer to provision a database, and set `DATABASE_URL`/`SENTRY_DSN`/`CORS_ORIGINS` in the dashboard per environment.
4. **Enable Dependabot + CodeQL** in the repo's Security tab if not auto-enabled by the files already being present.
5. **Push to `dev` and let CI run once** — required before step 6, because GitHub's status-check picker is empty until a workflow has reported at least one result.
6. **Set up branch protection** — follow `branch-protection.md`, in that order, not before step 5.
7. **Finish the Render E2E lookup** — `.github/workflows/e2e.yml` has a placeholder for the Render preview URL (Render has no first-party "wait for preview" action). Replace it once step 3 is done.

---

## What's intentionally minimal

- **Coverage thresholds start at 0.** Real numbers land with `project-test-gen`.
- **The Render preview-URL step in `e2e.yml` is a stub.** It doesn't block CI setup — E2E only runs on PRs to `main`, which won't happen until real work exists — but replace it before the first `dev → main` merge.
- **No CODEOWNERS enforcement yet.** The file exists; required-approvals is 0 until a second person joins, per `branch-protection.md`.
- **Signed commits are not required.** Worth turning on later; skipped now to avoid solo-dev friction on day one.

---

## Merge gate

Once code exists to gate, `docs/merge-gate.md` is the conversational check for "is this ready to merge?" — two batteries, `feature → dev` (lint/typecheck/unit/build) and `dev → main` (adds E2E, security, no open P0/P1). Severity definitions are in `docs/severity-scale.md`. Both are referenced by every other skill that classifies bugs (test-gen, drift-check, error-log) — don't reinvent severity levels elsewhere in this project.
