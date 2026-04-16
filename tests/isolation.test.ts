/**
 * Cross-tenant isolation tests.
 *
 * These tests verify the most critical security property of the system:
 * a user who belongs to Tenant A cannot access Tenant B's data, even with
 * a valid JWT.
 *
 * Run against a real test DB (DATABASE_URL_TEST).
 * Each test is fully self-contained and tears down its own data.
 *
 * Failure cases demonstrated:
 *   1. Wrong-tenant access via X-Tenant-ID header
 *   2. IDOR — guessing a resource ID from another tenant
 *   3. Removed user still accessing after membership deactivation
 */

import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma/client';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

// Override DATABASE_URL for tests if DATABASE_URL_TEST is set
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

const app = createApp();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash('password123', 10);
  return prisma.user.create({ data: { email, passwordHash } });
}

async function loginAs(email: string): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .send({ email, password: 'password123' });
  return res.body.accessToken as string;
}

async function createTenantWithOwner(ownerEmail: string) {
  const token = await loginAs(ownerEmail);
  const slug = `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await request(app)
    .post('/tenants')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Test Tenant', slug });
  return { tenant: res.body as { id: string }, token };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Cross-tenant isolation', () => {
  let userAEmail: string;
  let userBEmail: string;
  let tenantA: { id: string };
  let tenantB: { id: string };
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const suffix = Date.now();
    userAEmail = `alice-${suffix}@test.com`;
    userBEmail = `bob-${suffix}@test.com`;

    await createUser(userAEmail);
    await createUser(userBEmail);

    const resultA = await createTenantWithOwner(userAEmail);
    tenantA = resultA.tenant;
    tokenA = resultA.token;

    const resultB = await createTenantWithOwner(userBEmail);
    tenantB = resultB.tenant;
    tokenB = resultB.token;
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await prisma.user.deleteMany({ where: { email: { in: [userAEmail, userBEmail] } } });
    await prisma.$disconnect();
  });

  test('User A cannot access Tenant B by setting X-Tenant-ID to Tenant B', async () => {
    // User A has a valid JWT, but is not a member of Tenant B.
    // requireTenant middleware must reject this.
    const res = await request(app)
      .get('/posts')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Tenant-ID', tenantB.id);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not an active member/i);
  });

  test('User B cannot access Tenant A by setting X-Tenant-ID to Tenant A', async () => {
    const res = await request(app)
      .get('/posts')
      .set('Authorization', `Bearer ${tokenB}`)
      .set('X-Tenant-ID', tenantA.id);

    expect(res.status).toBe(403);
  });

  test('IDOR prevention — user cannot read a post from another tenant by guessing its ID', async () => {
    // Create a post in Tenant A
    const createRes = await request(app)
      .post('/posts')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Tenant-ID', tenantA.id)
      .send({ title: 'Secret Post', body: 'Tenant A private content' });

    expect(createRes.status).toBe(201);
    const postId = (createRes.body as { id: string }).id;

    // User B tries to access the same post ID via Tenant B — must get 404
    const readRes = await request(app)
      .get(`/posts/${postId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .set('X-Tenant-ID', tenantB.id);

    // Even though the postId exists globally, it doesn't exist in Tenant B's scope
    expect(readRes.status).toBe(404);
  });

  test('Removed user cannot access tenant after membership deactivation', async () => {
    // Register a third user and add them to Tenant A
    const suffix = Date.now();
    const charlieEmail = `charlie-${suffix}@test.com`;
    await createUser(charlieEmail);
    const charlieToken = await loginAs(charlieEmail);

    // Get Tenant A's Viewer role
    const rolesRes = await request(app)
      .get(`/tenants/${tenantA.id}/roles`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Tenant-ID', tenantA.id);

    const viewerRole = (rolesRes.body as { name: string; id: string }[]).find(r => r.name === 'Viewer');
    expect(viewerRole).toBeDefined();

    // Invite Charlie to Tenant A as Viewer
    await request(app)
      .post(`/tenants/${tenantA.id}/invite`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Tenant-ID', tenantA.id)
      .send({ email: charlieEmail, roleId: viewerRole!.id });

    // Charlie can access Tenant A
    const beforeRes = await request(app)
      .get('/posts')
      .set('Authorization', `Bearer ${charlieToken}`)
      .set('X-Tenant-ID', tenantA.id);
    expect(beforeRes.status).toBe(200);

    // Get Charlie's user ID
    const usersRes = await request(app)
      .get(`/tenants/${tenantA.id}/users`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Tenant-ID', tenantA.id);

    const charlieUser = (usersRes.body as { email: string; userId: string }[]).find(
      (u) => u.email === charlieEmail,
    );
    expect(charlieUser).toBeDefined();

    // Admin removes Charlie
    await request(app)
      .delete(`/tenants/${tenantA.id}/users/${charlieUser!.userId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Tenant-ID', tenantA.id);

    // Charlie's JWT is still valid, but membership is deactivated — must get 403
    const afterRes = await request(app)
      .get('/posts')
      .set('Authorization', `Bearer ${charlieToken}`)
      .set('X-Tenant-ID', tenantA.id);
    expect(afterRes.status).toBe(403);

    // Clean up Charlie
    await prisma.user.deleteMany({ where: { email: charlieEmail } });
  });
});
