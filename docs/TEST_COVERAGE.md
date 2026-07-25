# Test Coverage Map

What is tested, what isn't, and why. Updated per migration group.

**Last updated:** 2026-07-26 (group 1 — `feat/data-model`)
**Totals:** 3 files · 18 tests · all passing

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
