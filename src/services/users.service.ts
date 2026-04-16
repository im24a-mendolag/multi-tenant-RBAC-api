import { prisma } from '../prisma/client';
import { NotFoundError, BadRequestError } from '../types/errors';

// ─── Users within a tenant ────────────────────────────────────────────────────

export async function listTenantUsers(tenantId: string) {
  const memberships = await prisma.membership.findMany({
    where: { tenantId, isActive: true },
    include: {
      user: { select: { id: true, email: true, isActive: true, createdAt: true } },
      role: { select: { id: true, name: true } },
    },
  });

  return memberships.map((m) => ({
    userId: m.userId,
    email: m.user.email,
    isActive: m.user.isActive,
    role: m.role,
    scope: m.scope,
    memberSince: m.createdAt,
  }));
}

export async function getTenantUser(userId: string, tenantId: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId, tenantId, isActive: true },
    include: {
      user: { select: { id: true, email: true, isActive: true, createdAt: true } },
      role: { select: { id: true, name: true } },
    },
  });
  if (!membership) throw new NotFoundError('User not found in this tenant');
  return {
    userId: membership.userId,
    email: membership.user.email,
    role: membership.role,
    scope: membership.scope,
    memberSince: membership.createdAt,
  };
}

// Change a user's role within a tenant.
export async function updateUserRole(
  userId: string,
  tenantId: string,
  newRoleId: string,
  scope: 'all' | 'own' = 'all',
) {
  // Verify the role belongs to this tenant
  const role = await prisma.role.findFirst({ where: { id: newRoleId, tenantId } });
  if (!role) throw new NotFoundError('Role not found in this tenant');

  const membership = await prisma.membership.findFirst({
    where: { userId, tenantId, isActive: true },
  });
  if (!membership) throw new NotFoundError('User is not a member of this tenant');

  // Validate scope value
  if (scope !== 'all' && scope !== 'own') {
    throw new BadRequestError('scope must be "all" or "own"');
  }

  return prisma.membership.update({
    where: { id: membership.id },
    data: { roleId: newRoleId, scope },
    include: { role: { select: { id: true, name: true } } },
  });
}

// Soft-remove: set isActive = false rather than deleting.
// This preserves the membership row so audit logs remain intact.
export async function removeUserFromTenant(userId: string, tenantId: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId, tenantId, isActive: true },
  });
  if (!membership) throw new NotFoundError('User is not an active member of this tenant');

  await prisma.membership.update({
    where: { id: membership.id },
    data: { isActive: false },
  });
}
