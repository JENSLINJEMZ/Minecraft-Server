import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

/** HTTP-surface tests that do not require a database or a live session. */
const app = createApp();

describe('HTTP surface', () => {
  it('exposes a public health check', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it.each([
    '/api/v1/server',
    '/api/v1/server/status',
    '/api/v1/alerts',
    '/api/v1/settings',
    '/api/v1/export/metrics?range=15m',
    '/api/v1/export/events',
  ])('rejects unauthenticated GET %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBeTruthy();
  });

  it('rejects agent ingest without an agent token', async () => {
    const res = await request(app).post('/api/v1/agent/heartbeat').send({});
    expect(res.status).toBe(401);
  });

  it('rejects state-changing requests without a session', async () => {
    const res = await request(app)
      .patch('/api/v1/settings')
      .send({ retentionEventsDays: 10 });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown agent token', async () => {
    const res = await request(app)
      .get('/api/v1/agent/context')
      .set('x-agent-token', 'mp_definitely_not_a_real_token');
    expect(res.status).toBe(401);
  });

  it('returns a structured 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBeTruthy();
  });
});
