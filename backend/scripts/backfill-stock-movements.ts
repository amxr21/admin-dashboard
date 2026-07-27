import { PrismaClient, StockMovementReason } from '@prisma/client';

/**
 * Give every product an opening-balance movement so the log explains its stock.
 *
 * ─── WHY THIS IS NEEDED ──────────────────────────────────────────────
 * Products created before the movement log existed have a `stock` value with
 * nothing behind it. `/inventory/:id/reconcile` correctly reports
 * `agrees: false` for all of them — the log genuinely does not account for the
 * number.
 *
 * That is accurate but useless: an alert that fires for every row on day one
 * is an alert everybody learns to ignore, and the one product that later
 * drifts for a real reason would be invisible in the noise.
 *
 * This records the difference as a single CORRECTION movement, which is the
 * same mechanism a human would use. It does NOT edit `product.stock` — the
 * number is treated as correct and the log is made to agree with it, not the
 * other way around.
 *
 * ─── IDEMPOTENT ──────────────────────────────────────────────────────
 * It writes only the DIFFERENCE between stock and the current movement sum, so
 * running it twice is a no-op. Safe to re-run after a seed.
 *
 * Not a migration: it touches data, not schema, and it is a judgement about
 * history rather than a structural change. Run it deliberately.
 *
 *   pnpm --filter ./backend exec tsx scripts/backfill-stock-movements.ts
 */

const prisma = new PrismaClient();

const NOTE = 'Opening balance — recorded when the movement log was introduced';

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, stock: true },
  });

  const sums = await prisma.stockMovement.groupBy({
    by: ['productId'],
    _sum: { delta: true },
  });

  const recorded = new Map(sums.map((row) => [row.productId, row._sum.delta ?? 0]));

  let written = 0;
  let alreadyAgreed = 0;

  for (const product of products) {
    const fromMovements = recorded.get(product.id) ?? 0;
    const difference = product.stock - fromMovements;

    if (difference === 0) {
      alreadyAgreed += 1;
      continue;
    }

    await prisma.stockMovement.create({
      data: {
        productId: product.id,
        delta: difference,
        reason: StockMovementReason.CORRECTION,
        note: NOTE,
        // No actor: nobody made this decision, it is a reconciliation of
        // history that predates the log. Attributing it to whoever ran the
        // script would be a small lie in an audit trail.
        actorId: null,
      },
    });

    written += 1;
    process.stdout.write(
      `  ${product.name}: stock ${product.stock}, log ${fromMovements} -> wrote ${difference > 0 ? '+' : ''}${difference}\n`,
    );
  }

  process.stdout.write(
    `\n${String(written)} opening balance(s) written, ${String(alreadyAgreed)} already agreed.\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `backfill failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
