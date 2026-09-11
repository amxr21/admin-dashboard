import { describe, expect, it } from 'vitest';

import { getRelatedRecordHref } from '../related-record-links';

describe('related record destinations', () => {
  it('builds stable encoded routes for permitted records', () => {
    expect(getRelatedRecordHref('CASHIER', 'order', 'order/one')).toBe(
      '/admin/orders/order%2Fone',
    );
    expect(getRelatedRecordHref('SUPPORT', 'return', 'r 1')).toBe(
      '/admin/returns?detail=r%201',
    );
  });

  it('withholds destinations outside the current role grant', () => {
    expect(getRelatedRecordHref('CASHIER', 'staffActivity', 'u1')).toBeNull();
    expect(getRelatedRecordHref('OWNER', 'staffActivity', 'u1')).toBe(
      '/admin/audit?actorId=u1',
    );
  });
});
