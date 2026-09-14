import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';

import { deletionOrder, IMPLICIT_JOIN_TABLES, reconcileTables } from '../lib/data-clear-plan.js';

describe('data clear plan', () => {
  it('matches MySQL case-folded table names only when its server mode allows that', () => {
    const expected = ['orders', '_ProductToTag'];
    const live = ['orders', '_producttotag'];
    const folded = reconcileTables(expected, live, true);
    expect(folded.missing).toEqual([]);
    expect(folded.extra).toEqual([]);
    expect(folded.canonical('_producttotag')).toBe('_ProductToTag');
    const exact = reconcileTables(expected, live, false);
    expect(exact.missing).toEqual(['_ProductToTag']);
    expect(exact.extra).toEqual(['_producttotag']);
  });

  it('accounts for every implicit join table created by migrations', () => {
    const created = readdirSync('prisma/migrations', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const sql = readFileSync(`prisma/migrations/${entry.name}/migration.sql`, 'utf8');
        return [...sql.matchAll(/CREATE TABLE `(_[A-Za-z0-9]+To[A-Za-z0-9]+)`/g)]
          .map((match) => match[1]!);
      })
      .sort();
    expect([...IMPLICIT_JOIN_TABLES].sort()).toEqual(created);
  });

  it('deletes children before parents, including a shared parent', () => {
    const order = deletionOrder(
      ['users', 'orders', 'order_items', 'payments'],
      [
        { child: 'orders', parent: 'users' },
        { child: 'order_items', parent: 'orders' },
        { child: 'payments', parent: 'orders' },
      ],
    );
    expect(order.indexOf('order_items')).toBeLessThan(order.indexOf('orders'));
    expect(order.indexOf('payments')).toBeLessThan(order.indexOf('orders'));
    expect(order.indexOf('orders')).toBeLessThan(order.indexOf('users'));
  });

  it('refuses unknown references and cycles rather than weakening constraints', () => {
    expect(() => deletionOrder(['users'], [{ child: 'sessions', parent: 'users' }])).toThrow(/outside/);
    expect(() => deletionOrder(['users'], [{ child: 'users', parent: 'users' }])).toThrow(/Self-referencing/);
    expect(() => deletionOrder(['a', 'b'], [
      { child: 'a', parent: 'b' }, { child: 'b', parent: 'a' },
    ])).toThrow(/cycle/);
  });

  it('can order every model in the current Prisma schema', () => {
    const models = Prisma.dmmf.datamodel.models;
    const tableByModel = new Map(models.map((model) => [model.name, model.dbName ?? model.name]));
    const tables = [...tableByModel.values(), ...IMPLICIT_JOIN_TABLES];
    const references = models.flatMap((model) => model.fields.flatMap((field) =>
      field.kind === 'object' && field.relationFromFields?.length && model.name !== field.type
        ? [{ child: tableByModel.get(model.name)!, parent: tableByModel.get(field.type)! }]
        : [],
    ));
    const selfRelations = models.flatMap((model) => model.fields.filter((field) =>
      field.kind === 'object' && field.relationFromFields?.length && model.name === field.type,
    ));
    expect(selfRelations.every((field) => field.relationFromFields?.every((name) =>
      models.some((model) => model.fields.some((candidate) => candidate.name === name && !candidate.isRequired)),
    ))).toBe(true);
    expect(deletionOrder(tables, references)).toHaveLength(tables.length);
  });
});
