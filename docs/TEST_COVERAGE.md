# Test Coverage Map

What is tested, what isn't, and why. Updated per migration group.

**Last updated:** 2026-07-26 (group 6 — `feat/ui-primitives`)
**Totals:** 14 files · 166 tests · all passing (62 backend, 104 frontend)

---

## Group 6 — UI primitives

| Unit | Cases | Notes |
|---|---|---|
| `DataTable` | 23 | state matrix, selection, sorting, Arabic collation |
| `StatusBadge` | 12 | enum translation, tone mapping, unknown-value fallback |
| `TransitionOverlay` | 9 | anti-flash delay, a11y announcement, cancellation |

### What these guard

- **The full state matrix.** Loading shows skeletons, not an empty table — an
  empty table during load reads as "no data", a much more alarming message.
  Error and empty are kept distinct: "no results match your filters" invites a
  filter change, "we couldn't load this" invites a retry.
- **Arabic collation.** `a < b` on Arabic strings gives Unicode codepoint
  order, which is *not* alphabetical. A test sorts أحمد/بدر/تامر and asserts
  proper order — `Intl.Collator` is the only correct way.
- **Nulls sort last in BOTH directions.** Flipping them with the sort makes
  "sort by delivery date" surface undelivered orders at the top.
- **Indeterminate select-all.** A plain unchecked box on a partial selection
  implies "nothing selected", which leads to accidental select-all-then-delete.
- **Unknown enum values degrade.** An enum added to the API before the frontend
  knows about it renders the raw value rather than crashing the page.

### Two real bugs the tests caught

1. `DataTable` read `selected` from the `table` namespace; it lives in `counts`
   because it's a pluralised count. Rendered a raw key path.
2. `StatusBadge` used try/catch for a missing translation — but next-intl does
   **not** throw, it returns the key path. The catch never fired, so an unknown
   status would have shown `orderStatus.FOO` to users. Fixed with `t.has()`.

---

## Group 4 — motion system

First **frontend** tests in the project.

| Unit | Cases | Notes |
|---|---|---|
| Motion tokens | 12 | scale monotonicity, ease validity, `REDUCED` contract |
| `useReducedMotion` | 4 | true, false, mid-session change, missing API |
| `MotionProvider` | 10 | OS preference, override, persistence, timeScale |

### The assertion that matters most

**`timeScale` must never be 0.** `timeScale(0)` freezes tweens where they are,
so an element fading in from `opacity: 0` stays invisible permanently — the
users who most need reduced motion get missing content. That's an accessibility
bug, not a style choice.

Mutation-tested: set it to 0, and *"NEVER freezes the global timeline at zero"*
failed. Restored and re-verified.

### Tokens tested by property, not value

The token tests assert *monotonicity* and *range*, not literal numbers — so
retuning `base` from 0.3 to 0.28 doesn't break the suite, but making `fast`
slower than `slow` does. Testing exact values would make the suite an obstacle
to design tuning rather than a safety net.

### Note for future frontend tests

`window.matchMedia` is stubbed in `vitest.setup.ts`, **not** per-test. GSAP reads
it at import time, so any test importing `lib/gsap.ts` crashes before a
`beforeEach` mock could run. Override per-test with `mockMatchMedia()` from
`src/test/match-media.ts`.

---

## Group 2 — auth

---

## Group 2 — auth

| Unit | Cases | Notes |
|---|---|---|
| `POST /auth/login` | 8 | success, wrong password, unknown user, enumeration parity, malformed email, strict-mode rejection, deactivated, expired |
| Brute-force protection | 3 | account lockout, per-account isolation, per-IP rate limit |
| `GET /auth/me` | 5 | valid token, lowercase scheme, no header, forged signature, deactivated-after-issue |
| Token handling | 3 | round-trip, tampered token, `toSafeUser` stripping |

### Security properties pinned

- **No credential leak.** A test asserts the login response contains neither
  `passwordHash` nor the lockout counters, and never the literal hash value.
- **No user enumeration.** Unknown-user and wrong-password responses must be
  byte-identical in status and message; a mismatch fails the test.
- **Lockout is a lockout, not a counter.** After the threshold, the *correct*
  password is still refused.
- **Lockout is per-account.** One locked account must not affect another, or an
  attacker could deny service to everyone by failing against one email.
- **Tokens don't outlive authority.** Deactivating a user invalidates their
  still-unexpired token on the very next request.

### Mutation-tested

Both security-critical guards were verified by breaking them:

1. Made `toSafeUser` return the raw user → the two leak tests failed.
2. Gave unknown-user a distinct message → the enumeration test failed.

Restored and re-verified green after each.

### Known interaction, deliberately worked around

The per-IP limiter (10 per 15 min) trips before the per-account lockout
threshold can be reached over HTTP, because every Supertest request shares one
address. That is **correct production behaviour** — the two layers stack — so
the account-lockout tests drive the service directly, and the IP layer has its
own separate test. Don't "fix" this by loosening the limiter.

---

## Group 1 — data model

| Unit | Test file | Cases | Notes |
|---|---|---|---|
| Decimal money columns | `src/__tests__/schema.test.ts` | 3 | precision, arithmetic, runtime type |
| `onDelete` relations | `src/__tests__/schema.test.ts` | 3 | SetNull ×2, Cascade ×1 |
| Unique constraints | `src/__tests__/schema.test.ts` | 2 | customer email, order number |
| Schema defaults | `src/__tests__/schema.test.ts` | 2 | order status, user role |
| `slugify()` | `src/lib/__tests__/slug.test.ts` | 6 | pure function, upsert key |
| Health route + error envelope | `src/__tests__/health.test.ts` | 2 | pre-existing |

### What these actually guard

These do **not** test Prisma — they test the design decisions encoded in
`schema.prisma`, which a later edit could silently reverse:

- **`onDelete` direction.** Getting `SetNull` and `Cascade` backwards means
  either orphaned rows, or deleting a customer wiping their order history.
  Neither shows up until it happens in production.
- **Decimal money.** `price * qty` on a Decimal silently produces garbage. The
  tests pin the correct behaviour and assert the value is *not* a `number`, so
  if a future change swaps the column type the documented rules fail loudly.
- **Unique constraints.** Routes will translate Prisma's `P2002` into a 409;
  the constraint has to exist for that to work.
- **`User.role` default.** Guards against an edit making `OWNER` the default
  and silently over-privileging every new account.

### Mutation-tested

The `onDelete` tests were verified by deliberately breaking the schema
(`SetNull` → `Cascade` on `Order.customer`) and confirming the guarding test
failed, then restoring. A test that cannot fail proves nothing — this is worth
repeating whenever a test is meant to protect a design decision.

---

## Deliberate gaps

| Not tested | Why |
|---|---|
| `prisma/seed.ts` end-to-end | Idempotency and the password guard are worth covering, but the script calls `process.exit` and writes to shared tables — testing it properly needs refactoring into importable functions. **TODO before group 2**, since seed correctness matters once real accounts exist. |
| Every model's CRUD | Would be testing Prisma, not our code. Route tests in later groups cover the real logic. |
| Frontend | No components exist yet beyond the token reference page. |

## Coverage thresholds

Still **0** in both `vitest.config.ts` files. Raising them now would mean a
number that reflects a schema-only codebase and would need re-tuning every
group. Target once routes exist: backend 70/70/65/70, frontend 60 across.

---

## Running

```bash
pnpm test                        # everything
pnpm --filter ./backend test     # backend only
pnpm --filter ./backend test:coverage
```

**Local runs hit the real Aiven database.** Tests namespace every row they
create with a unique run id and clean up in `afterAll`, so they never touch seed
data — but they are slow (~500ms per round-trip), which is why
`testTimeout` is 30s and `fileParallelism` is off. CI uses a throwaway MySQL
service container and is much faster.
