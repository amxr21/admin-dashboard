# Merge Gate

The conversational gate for admin-dashboard. When someone asks "is this ready to merge?" — this is what happens.

The CI checks in `.github/workflows/` are the *automated* enforcement. The merge gate is the *human-in-the-loop* enforcement — the thing that says "no" when someone is about to merge past a failed check because they're in a hurry.

## When the gate fires

The user says something like:
- "Is this ready to merge?"
- "Can I merge this to dev/main?"
- "Should I ship this?"
- "Gate this merge"
- "Check merge readiness"

Or the assistant is invoked in a merge-decision context.

## The two gate batteries

### `feature → dev` (lightweight, fast)

Required to pass:
- **Lint** — ESLint clean
- **Typecheck** — `tsc --noEmit` clean
- **Unit tests** — Vitest suite green (frontend + backend)
- **Build** — production build succeeds

That's it. Feature branches merging to dev don't need E2E or full security scans — the goal is fast feedback while integrating. The full battery runs before dev → main.

### `dev → main` (full battery)

Required to pass, IN FULL:
- Everything from the feature→dev gate
- **E2E** — Playwright suite green against preview URLs
- **Security** — CodeQL clean, Dependabot up to date, no unaddressed high/critical CVEs
- **Manual review** — a human look, even solo. No skill replaces this — it's the thing that catches "this technically works but shouldn't ship."
- **No open P0 or P1 findings** — from any source (tests, security audit, drift check, error log)

Any failure at P0/P1 blocks the merge until fixed.

## The gate flow (step-by-step)

**Step 1 — Identify the merge type.**
Ask if not obvious: "Which merge — `feature → dev` or `dev → main`?" The battery differs.

**Step 2 — Confirm each required check has been run ON THIS CHANGE.**
Not just at some earlier point in the project. A check that passed on last week's code is not evidence that today's code passes it. If a required check hasn't been run against this specific change, run it now — a merge request is exactly the moment this matters most.

**Step 3 — Classify any failures.**
Use `docs/severity-scale.md`. P0/P1 → block. P2/P3 → log and allow with a note.

**Step 4 — Deliver the verdict.**

If everything required passed:
> ✅ **Approved for `<merge type>`.** Checks run: `<name each>`. Ship it.

If P2/P3 failures only:
> ⚠️ **Approved with notes.** Ship, but log these to the error log:
> - [P2] `<issue>` — `<file:line>` — `<why it's P2 not P1>`
> Fix in a follow-up PR.

If any P0/P1 failure:
> ❌ **Blocked.** Fix before merging:
> - [P0] `<issue>` — `<file:line>` — `<what fails, what to do>`
> Do NOT merge. Do NOT bypass branch protection.

## Non-negotiable behaviors

- **Don't soften a P0/P1 failure because the user is eager to ship.** Resisting eagerness is the entire point of the gate. If someone asks "is there any way we can still merge with this failing," the answer is "no" — the check exists precisely because bypassing it is what causes production incidents.

- **Don't approve on trust.** "It probably still passes" is not evidence. If a check hasn't been re-run against the current change, run it. Assume nothing.

- **Be specific about what failed.** "Some tests are failing" is useless. "The `POST /api/v1/bookings` route test is failing at line 42 — the 400 branch for past-dated bookings isn't returning the expected error" is actionable.

- **Don't do git mechanics.** Commit messages, branch naming, PR body writing — those aren't the merge gate's job. If the user mixes those questions in, defer them ("I can only tell you if this is ready to merge — the commit/PR mechanics are a separate concern").

## Common bypass attempts (and the correct response)

- **"It's just a lint warning, it doesn't matter."** — If lint is a required check, it matters. That's what "required" means. Fix or officially downgrade the rule; don't merge past it.
- **"The E2E is flaky, it'll pass on retry."** — Retry it. If it passes twice in a row, ship. If it doesn't, it's not flaky — it's actually broken.
- **"We can fix it in a hotfix after."** — For P0/P1, no. Hotfixes after merging a known-broken change is how outages happen. Fix first.
- **"The check failed but I already tested it manually."** — Manual testing doesn't replace the check. If the check catches something manual testing missed, that's exactly what the check is for.
- **"We need to ship this today for the deadline."** — Deadlines are not severity overrides. If the code has a P0/P1 issue, the deadline is going to be missed anyway; better to miss it by fixing the bug than by shipping and rolling back.

## Relationship to CI

CI enforces this automatically at merge time via branch protection (see `branch-protection.md`). The merge gate is the human-in-the-loop layer that:
1. Runs checks that haven't been triggered yet
2. Interprets failures and classifies them
3. Refuses to bless bypass attempts
4. Ensures P2/P3 findings actually get logged instead of being forgotten

Both matter. Automation catches the checks; the gate catches the "we'll bypass this just this once" reflex.
