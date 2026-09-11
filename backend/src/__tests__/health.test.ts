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

describe('JSON request boundary', () => {
  it('returns a request-correlated 400 JSON envelope for malformed JSON', async () => {
    const res = await request(createApp())
      .post('/api/v1/pos/checkout')
      .set('Content-Type', 'application/json')
      .send('{"lines":');
    const body = res.body as ErrorEnvelope;

    expect(res.status).toBe(400);
    expect(res.type).toBe('application/json');
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('Request body must be valid JSON');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns a request-correlated 413 JSON envelope for oversized JSON', async () => {
    const res = await request(createApp())
      .post('/api/v1/pos/checkout')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ note: 'x'.repeat(1_048_577) }));
    const body = res.body as ErrorEnvelope;

    expect(res.status).toBe(413);
    expect(res.type).toBe('application/json');
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });
});

/**
 * Browser chrome requests these from every origin it loads. Left unhandled
 * they reach the 404 handler and emit a WARN per request — noise that trains
 * everyone to ignore the log, which is how a real 404 goes unnoticed.
 */
describe('browser-noise routes', () => {
  it('answers /favicon.ico with 204 and no body', async () => {
    const res = await request(createApp()).get('/favicon.ico');

    expect(res.status).toBe(204);
    expect(res.text).toBeFalsy();
  });

  it('answers /robots.txt by disallowing everything', async () => {
    // An admin API has nothing a crawler should index.
    const res = await request(createApp()).get('/robots.txt');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Disallow: /');
  });

  it('still 404s a genuinely unknown path', async () => {
    // The quieting is scoped to known browser noise — it must not turn into a
    // blanket "swallow anything unmatched".
    const res = await request(createApp()).get('/not-a-real-path');

    expect(res.status).toBe(404);
    expect((res.body as ErrorEnvelope).error.code).toBe('NOT_FOUND');
  });
});
