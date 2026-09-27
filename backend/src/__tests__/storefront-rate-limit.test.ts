import express, { type Request } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { storefrontShopperKey, publicShopperRateLimit, publicKeyFailureRateLimit } from '../middleware/rateLimit.js';

function identity(address: string, key?: string, stated?: string): Request {
  return { ip: address, apiKeyId: key, header: () => stated } as unknown as Request;
}
const originalMode = process.env.NODE_ENV;
afterEach(() => { process.env.NODE_ENV = originalMode; });

describe('storefront shopper identity', () => {
  it('ignores supplied shopper IP without a verified key', () => {
    expect(storefrontShopperKey(identity('192.0.2.1', undefined, '198.51.100.9')))
      .toBe('anonymous|192.0.2.1');
  });
  it('uses validated forwarded IP and isolates integration keys', () => {
    expect(storefrontShopperKey(identity('192.0.2.1', 'key-a', '198.51.100.9')))
      .toBe('key-a|198.51.100.9');
    expect(storefrontShopperKey(identity('192.0.2.1', 'key-b', '198.51.100.9')))
      .toBe('key-b|198.51.100.9');
  });
  it('falls back for invalid, multiple or missing shopper addresses', () => {
    for (const stated of ['garbage', '198.51.100.9, 192.0.2.1', '', undefined]) {
      expect(storefrontShopperKey(identity('192.0.2.1', 'key-a', stated)))
        .toBe('key-a|192.0.2.1');
    }
  });
  it('groups IPv6 addresses using the limiter subnet policy', () => {
    expect(storefrontShopperKey(identity('::1', 'key-a', '2001:db8:1234:5600::1')))
      .toBe(storefrontShopperKey(identity('::1', 'key-a', '2001:db8:1234:5600::2')));
  });
});

describe('storefront budgets', () => {
  it('keeps 25 shoppers independent and throttles only the exhausted shopper', async () => {
    process.env.NODE_ENV = 'production';
    const app = express();
    app.use((req, _res, next) => { req.apiKeyId = 'load-test-key'; next(); });
    app.use(publicShopperRateLimit);
    app.get('/', (_req, res) => res.sendStatus(200));
    for (let i = 1; i <= 25; i++) {
      expect((await request(app).get('/').set('X-Storefront-Client-IP', `198.51.100.${i}`)).status).toBe(200);
    }
    for (let i = 0; i < 119; i++) {
      expect((await request(app).get('/').set('X-Storefront-Client-IP', '198.51.100.1')).status).toBe(200);
    }
    expect((await request(app).get('/').set('X-Storefront-Client-IP', '198.51.100.1')).status).toBe(429);
    expect((await request(app).get('/').set('X-Storefront-Client-IP', '198.51.100.2')).status).toBe(200);
  });
  it('valid traffic never spends the invalid-key budget — even when the shopper is refused', async () => {
    // Its own address: the limiter's store is shared by every test in this
    // file, and an exhausted budget would leak into the next one.
    const address = '192.0.2.200';
    const app = express();
    app.set('trust proxy', true);
    app.use(publicKeyFailureRateLimit);
    // Stands in for authenticateStorefrontApiKey: only a verified key sets it.
    app.use((req, res, next) => {
      if (req.header('X-API-Key') !== 'valid') {
        res.sendStatus(401);
        return;
      }
      req.apiKeyId = 'verified-key';
      next();
    });
    // A verified key whose SHOPPER is refused (expired session) — a 401 that
    // must not count as key guessing.
    app.get('/', (req, res) => res.sendStatus(req.header('X-Session') === 'expired' ? 401 : 200));
    const from = () => request(app).get('/').set('X-Forwarded-For', address);

    for (let i = 0; i < 40; i++) expect((await from().set('X-API-Key', 'valid')).status).toBe(200);
    for (let i = 0; i < 40; i++) {
      expect((await from().set('X-API-Key', 'valid').set('X-Session', 'expired')).status).toBe(401);
    }
    for (let i = 0; i < 30; i++) expect((await from()).status).toBe(401);
    expect((await from()).status).toBe(429);
  });
});

/**
 * The QA failure end to end, through the real app: one storefront key, many
 * shoppers. Before, the 21st checkout of the hour was refused for EVERY
 * shopper because they all arrived from the storefront server's address.
 */
describe('checkout through the real public API', () => {
  it('limits checkout per shopper, not per storefront', async () => {
    const [{ createApp }, { prisma }, { createApiKey }, { StaffRole }] = await Promise.all([
      import('../app.js'),
      import('../db/prisma.js'),
      import('../services/api-key.service.js'),
      import('@prisma/client'),
    ]);
    const owner = await prisma.user.create({
      data: { email: `ratelimit-${Date.now()}@example.test`, name: 'Rate limit owner', role: StaffRole.OWNER, passwordHash: 'x' },
    });
    try {
      const { key } = await createApiKey(owner.id, 'Storefront', 'Rate-limit test', 'Test storefront');
      const app = createApp();
      process.env.NODE_ENV = 'production';

      const checkout = (shopper: string) =>
        request(app)
          .post('/api/v1/public/orders')
          .set('x-api-key', key)
          .set('X-Storefront-Client-IP', shopper)
          .send({});

      // An invalid body still counts: a limiter that only counted good orders
      // would let a script hammer checkout with bad ones.
      for (let i = 0; i < 20; i++) expect((await checkout('203.0.113.10')).status).toBe(400);
      expect((await checkout('203.0.113.10')).status).toBe(429);
      expect((await checkout('203.0.113.11')).status).toBe(400);
    } finally {
      process.env.NODE_ENV = originalMode;
      await prisma.apiKey.deleteMany({ where: { userId: owner.id } });
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });
});
