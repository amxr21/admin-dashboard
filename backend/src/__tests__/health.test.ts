import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

/**
 * One real integration test so CI has something true to run against the CI
 * MySQL service, rather than an empty suite masquerading as coverage.
 */

type ErrorEnvelope = {
  error: { code: string; message: string; requestId: string };
};

describe('GET /api/v1/health', () => {
  it('reports ok when the database is reachable', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok', db: 'ok' } });
  });

  it('returns the shared error envelope for an unknown route', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/nope');
    const body = res.body as ErrorEnvelope;

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBeTruthy();
  });
});
