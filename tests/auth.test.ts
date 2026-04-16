/**
 * Auth flow integration tests.
 *
 * Tests the full register → login → use token → refresh cycle.
 * Requires a real database (DATABASE_URL_TEST).
 */

import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma/client';

if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

const app = createApp();

describe('Auth', () => {
  const email = `auth-test-${Date.now()}@test.com`;
  const password = 'Password123!';

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  let refreshToken: string;

  test('POST /auth/register — creates user and returns tokens', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email, password });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe(email);
    // Password hash must never be returned
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test('POST /auth/register — rejects duplicate email', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email, password });

    expect(res.status).toBe(409);
  });

  test('POST /auth/login — returns tokens for valid credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    refreshToken = res.body.refreshToken as string;
  });

  test('POST /auth/login — rejects wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email, password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  test('POST /auth/refresh — issues new token pair', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    // Old token should be revoked now
    const oldToken = refreshToken;
    refreshToken = res.body.refreshToken as string;

    // Using the old refresh token again should fail (rotation)
    const reuseRes = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: oldToken });
    expect(reuseRes.status).toBe(401);
  });

  test('GET /health — works without auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
