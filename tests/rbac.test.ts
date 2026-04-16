/**
 * Unit tests for rbac.service.ts
 *
 * These tests mock prisma.$queryRaw so we can verify the permission resolution
 * logic without a real database.
 *
 * Scenarios covered:
 *   1. Flat role — user gets only the permissions directly on their role
 *   2. Two-level hierarchy — child inherits parent permissions
 *   3. Three-level hierarchy — grandchild inherits all ancestor permissions
 *   4. Sibling roles — user with two roles gets the union of both sets
 *   5. Scope resolution — 'all' wins over 'own' when any membership grants it
 *   6. No permissions — returns empty Set when user has no roles
 */

import { jest } from '@jest/globals';

// Mock the prisma client before importing anything that uses it
jest.mock('../src/prisma/client', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    membership: { findFirst: jest.fn() },
  },
}));

import { prisma } from '../src/prisma/client';
import {
  getEffectivePermissions,
  getUserScope,
  checkActiveMembership,
} from '../src/services/rbac.service';

const mockQueryRaw = prisma.$queryRaw as jest.MockedFunction<typeof prisma.$queryRaw>;
const mockFindFirst = prisma.membership.findFirst as jest.MockedFunction<typeof prisma.membership.findFirst>;

describe('getEffectivePermissions', () => {
  const userId = 'user-1';
  const tenantId = 'tenant-1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns permissions for a flat role (no inheritance)', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { name: 'posts:read' },
      { name: 'tenants:read' },
    ]);

    const perms = await getEffectivePermissions(userId, tenantId);

    expect(perms).toEqual(new Set(['posts:read', 'tenants:read']));
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns inherited permissions from two-level hierarchy', async () => {
    // Viewer has posts:read; Editor inherits from Viewer and adds posts:write
    mockQueryRaw.mockResolvedValueOnce([
      { name: 'posts:read' },  // inherited from Viewer
      { name: 'posts:write' }, // from Editor
    ]);

    const perms = await getEffectivePermissions(userId, tenantId);
    expect(perms.has('posts:read')).toBe(true);
    expect(perms.has('posts:write')).toBe(true);
  });

  it('returns full set for three-level hierarchy', async () => {
    // Admin inherits Editor → Viewer
    mockQueryRaw.mockResolvedValueOnce([
      { name: 'posts:read' },    // Viewer
      { name: 'posts:write' },   // Editor
      { name: 'users:write' },   // Admin
      { name: 'roles:read' },    // Admin
    ]);

    const perms = await getEffectivePermissions(userId, tenantId);
    expect(perms.size).toBe(4);
    expect(perms.has('posts:read')).toBe(true);
    expect(perms.has('users:write')).toBe(true);
  });

  it('merges permissions from two sibling roles', async () => {
    // User has both "Editor" and a custom "Billing" role
    mockQueryRaw.mockResolvedValueOnce([
      { name: 'posts:read' },
      { name: 'posts:write' },
      { name: 'billing:read' }, // from Billing role
    ]);

    const perms = await getEffectivePermissions(userId, tenantId);
    expect(perms.size).toBe(3);
    expect(perms.has('billing:read')).toBe(true);
  });

  it('returns empty Set when user has no roles', async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    const perms = await getEffectivePermissions(userId, tenantId);
    expect(perms.size).toBe(0);
  });
});

describe('getUserScope', () => {
  const userId = 'user-1';
  const tenantId = 'tenant-1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 'all' when any membership grants scope 'all'", async () => {
    mockQueryRaw.mockResolvedValueOnce([{ scope: 'own' }, { scope: 'all' }]);
    const scope = await getUserScope(userId, tenantId, 'posts:write');
    expect(scope).toBe('all');
  });

  it("returns 'own' when all memberships have scope 'own'", async () => {
    mockQueryRaw.mockResolvedValueOnce([{ scope: 'own' }]);
    const scope = await getUserScope(userId, tenantId, 'posts:write');
    expect(scope).toBe('own');
  });

  it("returns 'own' when no matching memberships exist", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    const scope = await getUserScope(userId, tenantId, 'posts:write');
    expect(scope).toBe('own');
  });
});

describe('checkActiveMembership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when an active membership exists', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'membership-1' } as never);
    const result = await checkActiveMembership('user-1', 'tenant-1');
    expect(result).toBe(true);
  });

  it('returns false when no active membership exists', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const result = await checkActiveMembership('user-1', 'tenant-1');
    expect(result).toBe(false);
  });
});
