/** Prisma's implicit many-to-many tables are absent from the model DMMF. */
export const IMPLICIT_JOIN_TABLES = [
  '_CategoryToDiscount',
  '_CustomerToDiscount',
  '_DiscountToProduct',
  '_ProductToTag',
] as const;

/** Match information_schema names using the server's table-name case mode. */
export function reconcileTables(
  expected: readonly string[],
  live: readonly string[],
  caseInsensitive: boolean,
): { missing: string[]; extra: string[]; canonical: (name: string) => string } {
  const key = (name: string) => caseInsensitive ? name.toLowerCase() : name;
  const expectedByKey = new Map<string, string>();
  for (const name of expected) {
    const lookup = key(name);
    if (expectedByKey.has(lookup)) throw new Error(`Duplicate expected table: ${name}`);
    expectedByKey.set(lookup, name);
  }
  const liveByKey = new Map<string, string>();
  for (const name of live) {
    const lookup = key(name);
    if (liveByKey.has(lookup)) throw new Error(`Duplicate live table: ${name}`);
    liveByKey.set(lookup, name);
  }
  return {
    missing: [...expectedByKey].filter(([lookup]) => !liveByKey.has(lookup)).map(([, name]) => name),
    extra: [...liveByKey].filter(([lookup]) => !expectedByKey.has(lookup)).map(([, name]) => name),
    canonical(name: string): string {
      const result = expectedByKey.get(key(name));
      if (!result) throw new Error(`Unknown table in foreign key: ${name}`);
      return result;
    },
  };
}

/** Build a children-first deletion order without disabling foreign-key checks. */
export function deletionOrder(
  tables: readonly string[],
  references: readonly { child: string; parent: string }[],
): string[] {
  const tableSet = new Set(tables);
  if (tableSet.size !== tables.length) throw new Error('Duplicate application table in clear plan');

  const parentsByChild = new Map(tables.map((table) => [table, new Set<string>()]));
  const incoming = new Map(tables.map((table) => [table, 0]));

  for (const { child, parent } of references) {
    if (!tableSet.has(child) || !tableSet.has(parent)) {
      throw new Error(`Foreign key references a table outside the application schema: ${child} -> ${parent}`);
    }
    if (child === parent) {
      throw new Error(`Self-referencing table needs a reviewed deletion plan: ${child}`);
    }
    const parents = parentsByChild.get(child)!;
    if (!parents.has(parent)) {
      parents.add(parent);
      incoming.set(parent, incoming.get(parent)! + 1);
    }
  }

  const ready = tables.filter((table) => incoming.get(table) === 0).sort();
  const result: string[] = [];
  while (ready.length > 0) {
    const child = ready.shift()!;
    result.push(child);
    for (const parent of parentsByChild.get(child)!) {
      const next = incoming.get(parent)! - 1;
      incoming.set(parent, next);
      if (next === 0) {
        ready.push(parent);
        ready.sort();
      }
    }
  }

  if (result.length !== tables.length) {
    throw new Error('Application tables have a foreign-key cycle; clear plan requires manual review');
  }
  return result;
}
