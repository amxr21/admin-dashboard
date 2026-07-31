# admin-dashboard — Foundations

This is the one-page brief on how admin-dashboard is set up at the config layer, why each piece is there, and what a new dev or coding agent needs to know before touching code.

Read this before opening a PR. If a rule below is inconvenient in a specific case, raise it in review — don't quietly work around it.

---

## Stack

- **Frontend**: Next.js 15 (App Router) + TypeScript → Vercel
- **Backend**: Express 5 + TypeScript → Render
- **Database**: MySQL via Prisma — `backend/prisma/`
- **Package manager**: pnpm (workspace root; `frontend` and `backend` are the two packages)
- **Node**: 22 LTS (see `.nvmrc`)
- **Error tracking**: Sentry (FE browser + server + edge, BE)
- **Logging**: pino → JSON → the host's log drain

---

## The 8 foundations (and where they live)

### 1. Strict TypeScript
Both packages extend `tsconfig.strict.json` at the repo root. `strict: true` plus `noUncheckedIndexedAccess` (so `arr[0]` is `T | undefined` and you must handle it) and `noUnusedLocals`. `any` is banned by ESLint. To escape the type system, use `unknown` plus a runtime check — never `any`, never `!`.

Path alias: `@/` → `src/`. That's the only one. Keep it that way.

### 2. Linting
ESLint flat config (v9), one per package. `pnpm lint` at the root runs both. Notable rules: `no-console` is an **error** on the backend (use the logger) and a warning on the frontend; `no-floating-promises` and `no-misused-promises` are on, which catches the forgotten `await` class of bug at lint time rather than in production.

### 3. Structured logging
`backend/src/logger.ts`. Every log goes through `req.log` (in routes) or the imported `logger` (everywhere else). **Never `console.log`.**

Every line is a JSON object carrying `service`, `env`, and — inside a request — `requestId`. Conventions, which are not optional if you want the logs to be queryable:

- **camelCase** field names. `userId`, never `user_id`.
- Every log has an **`event`** field in dot-notation: `user.login.succeeded`, `payment.charge.failed`, `db.query.slow`. Read it aloud — if you can't tell what happened, it's named wrong.
- Durations are `durationMs`, integer.
- Amounts are in the smallest unit (`amountCents: 4999`), never floats — `49.99 * 100` is not `4999` in JavaScript.
- Errors go in as strings: `error: err instanceof Error ? err.message : String(err)`. A raw `Error` object does not serialise.

**Never log** passwords (even hashed), full card numbers, API keys, JWTs, session cookies, or full request bodies. The `redact` list in `logger.ts` is a safety net, not a substitute for thinking.

### 4. Error tracking (Sentry)
Backend: `backend/src/sentry.ts`, imported first in `server.ts` so it hooks Node's error handling before anything else runs.

Frontend: three runtimes, three configs. `instrumentation-client.ts` (browser — note this replaces the deprecated `sentry.client.config.ts`, which Turbopack ignores), plus `sentry.server.config.ts` and `sentry.edge.config.ts`, both loaded via `instrumentation.ts`. `src/app/global-error.tsx` catches React render errors, which no other hook sees.

Enabled in production and preview; off in local dev so your own errors don't pollute the feed.

The backend distinguishes two kinds of failure, and this distinction is the point:

- **`AppError`** (`backend/src/errors/AppError.ts`) — an expected failure. Not found, forbidden, bad input. The message goes to the caller verbatim and it is **not** sent to Sentry. Burying real incidents in 404 noise is how alerting dies.
- **Anything else** — a bug. The caller gets a generic message plus a `requestId`; the real error goes to Sentry and the logs.

So: never `throw new Error('Order not found')`. Throw `AppError.notFound('Order not found')`.

Never put PII in Sentry extras — `userId` only, no emails, no request bodies.

### 5. Environment separation
Two persistent environments plus preview-per-PR:

- **development** — your laptop. `backend/.env`, `frontend/.env.local`.
- **production** — live. Values set in the Vercel/Render dashboards, never committed.
- **preview** — automatic per pull request. Vercel spins up the frontend, Render the backend. Dies when the PR closes. Uses a throwaway DB — there is deliberately no shared "staging" database to drift out of sync with prod.

Each environment gets its own Sentry environment tag and its own keys.

`.env.example` in each package documents every required variable. On the backend these are **validated at boot** by `backend/src/config/env.ts` — a missing or malformed variable exits the process immediately with a readable message, rather than surfacing as a mystery failure under load hours later. When you add a variable, add it in both `env.ts` and `.env.example`.

**When to add a real staging environment:** when you have QA who isn't the dev, external integrations with approval flows, destructive migrations that need prod-like rehearsal, or an SLA where 20 minutes of downtime costs real money. Until then, preview-per-PR covers it.

### 6. Versioned DB migrations
Prisma. Every schema change is a migration file, committed to git, reviewed like any other code.

```bash
pnpm db:migrate --name add_user_email_index   # local: creates + applies
pnpm db:deploy                                 # CI/prod: applies only
```

Rules: never hand-edit a production database. Never `db push` against prod. Migration names describe the change (`add_user_email_index`, not `fix1`). Destructive migrations get a review **and** a backup snapshot before deploy.

**If `migrate dev` says a migration is "applied but missing from the local migrations directory" and offers to reset:** do not accept it. That prompt cannot tell real drift (someone deleted a migration file) from harmless bookkeeping residue (a failed attempt that got rolled back, then retried under a new timestamp) — it raises the same alarm either way. Query `_prisma_migrations` directly first: a row with `rolled_back_at` set and `finished_at` null, immediately followed by a same-named migration that DID finish, is the harmless case — but `prisma migrate resolve --rolled-back <name>` will not clear it if the row is already marked rolled back (it's a no-op, and `migrate dev` will raise the same alarm again). Instead, avoid `migrate dev` for this migration entirely: confirm `prisma migrate deploy` reports no pending migrations (it doesn't run this reconciliation), generate the new migration's SQL with `prisma migrate diff --from-schema-datamodel <previous schema.prisma> --to-schema-datamodel <current schema.prisma> --script` (no DB connection needed), write it into a hand-created `prisma/migrations/<timestamp>_<name>/migration.sql`, then apply with `migrate deploy`. Never `migrate reset` against a shared database. Full incident: `.claude-workbook/errors-log.md`, 2026-07-31.

### 7. API versioning
Everything lives under `/api/v1/`. Route files are in `backend/src/routes/v1/`, registered in that folder's `index.ts`, which `app.ts` mounts at `/api/v1`.

When a response shape needs a breaking change, add `/v2/` — do not silently change v1. Retrofitting versioning onto a live unversioned API means either breaking clients or a multi-month migration.

`example.route.ts` is the reference implementation: Zod validation at the boundary, thin handler, `req.log`, throw don't-build-error-responses. Copy its shape and delete the file once real routes exist.

### 8. Feature flags
`backend/src/config/featureFlags.ts`. Read with `isEnabled('flagName', { userId })`. Config-driven and per-environment, no external service.

Ship behind a flag when the change is risky, needs gradual rollout, or has to coordinate with a frontend deploy. **Delete the flag once it's fully rolled out** — dead flags rot into permanent confusing branches.

---

## Response shape (the FE/BE contract)

Success and failure each have exactly one shape, everywhere:

```jsonc
// success
{ "data": { /* ... */ } }

// failure
{ "error": { "code": "NOT_FOUND", "message": "…", "requestId": "abc-123", "details": {} } }
```

The frontend never calls `fetch` directly — it goes through `frontend/src/lib/api.ts`, which unwraps the envelope and throws a typed `ApiError`. The `requestId` is surfaced to the user on purpose: when they report "it broke", that string takes you straight to the request in the logs.

---

## What's intentionally left out (add when you outgrow the simple version)

- **The design system.** Tailwind v4 is wired up and the font is registered, but the semantic token palette and dark-mode strategy are stubs in `globals.css`. Build them with the **project-ui-system** skill *before* component work starts — retrofitting tokens across built components is miserable.
- **CI/CD, tests, branch protection.** No `.github/` yet. That's the **project-ship** layer.
- **Observability beyond error tracking** — log aggregation, uptime checks, alert routing. That's the **project-run** layer, and it needs SHIP first.
- **Auth and RBAC.** Deliberately not ported from the old template. `AppError.unauthorized()` / `.forbidden()` and the commented `JWT_*` env vars are the hooks it will plug into.
- **Feature flag service** — current setup needs a redeploy to change a flag. Swap for LaunchDarkly / ConfigCat / Unleash when you need runtime targeting.
- **Rate limiting** — add `express-rate-limit` before the API is public.

---

## What comes next — do these in this order

Foundations is the config layer only. Two layers sit on top of it, and the sequence is
load-bearing — doing it out of order creates work you have to undo.

```
BUILD      AUTHOR                  VERIFY                    OBSERVE
foundations ─┬─ code-standards ─┬─ test-gen ─── ship(gate) ─── run
             ├─ ui-system       │      ▲            ▲
             └─ motion          │      │            │
                                └── ship(CI setup) ─┘
CROSS-CUTTING:  docs (public) · workbook (private) · error-log · drift-check (on demand)
```

Concretely, in order:

```
1. Commit the foundations to dev                                    ✓ done
2. Push it                                                          ✓ done
3. project-ui-system    → design tokens, dark mode, fonts           ✓ done
4. project-ship         → CI workflows, Husky, Dependabot, RUNNERS  ← here
5. Let CI run once      → so check names register with GitHub
6. Branch protection rules, referencing those now-existing checks
7. project-test-gen     → writes the tests the runners from step 4 execute
8. project-ship (gate)  → "is this ready to merge?" — used per-merge from here on
9. project-run          → observability, alerting, incident response
```

**`project-code-standards` and `project-motion` are not steps in this list** — they're
shape-as-you-go skills that apply *while* feature code is written. They have nothing to act on
until the first real route or component exists. Don't "run" them; let them shape the work.

**`project-docs`, `project-workbook`, and `project-error-log` are continuous**, not sequenced.

**Note the two modes of `project-ship`.** Step 4 is CI *setup*. Step 8 is the *merge gate*.
`project-test-gen` sits between them — it assumes the runners from step 4 exist, and the gate is
only meaningful once tests do.

### Why branch protection comes AFTER CI, not before

Setting up GitHub rules first is the most common sequencing mistake. It fails three ways:

- **It blocks the foundations commit itself.** Enable "require a pull request before merging"
  and the very commit establishing the baseline can't land directly. You end up opening a PR
  against a branch with no CI, getting zero checks, and merging anyway — pure ceremony.
- **The status-check dropdown is empty.** The rule worth having is *"require status checks to
  pass."* GitHub only lets you select a check after a workflow has reported it at least once.
  Configure rules first and you either have nothing to pick, or you pin a check name that never
  runs — which blocks the branch permanently.
- **There's no baseline to test.** CI's first run should validate the foundations commit. If
  nothing is on the remote yet, there is nothing for it to check.

### Why the design system comes before components

`project-ui-system` defines the semantic token palette and dark-mode strategy. Retrofitting
tokens across components that already hardcode colours means touching every file you wrote.
Do it while the component count is zero — which, right now, it is.

### Solo developer note

Skip *"require approvals from another reviewer"* — you will lock yourself out of your own
repository. The rules that carry their weight solo are **require status checks to pass** and
**no force-push to main**.

---

## First-time setup (dev machine)

```bash
pnpm install

cp backend/.env.example  backend/.env          # fill in DATABASE_URL
cp frontend/.env.example frontend/.env.local

pnpm --filter ./backend db:migrate             # creates the schema
pnpm dev                                       # FE :3000 · BE :4000
```

Sanity check: `curl http://localhost:4000/api/v1/health` → `{"data":{"status":"ok","db":"ok"}}`

---

## When something breaks in production

1. Grab the `requestId` — from the Sentry issue, the `x-request-id` response header, or the user's error message.
2. Filter the logs by that requestId.
3. You now have the full story of that one request, in order. Follow the trail.

If there's no requestId (a background job, say), filter by `service` + time window + `event`.
