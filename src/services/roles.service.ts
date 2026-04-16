import { prisma } from '../prisma/client';
import { NotFoundError, ConflictError, BadRequestError } from '../types/errors';

// ─── Role CRUD ────────────────────────────────────────────────────────────────

export async function listRoles(tenantId: string) {
  return prisma.role.findMany({
    where: { tenantId },
    include: {
      parentRole: { select: { id: true, name: true } },
      permissions: { include: { permission: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createRole(
  tenantId: string,
  name: string,
  description?: string,
  parentRoleId?: string,
) {
  if (parentRoleId) {
    // Verify the parent role belongs to the same tenant
    const parent = await prisma.role.findFirst({ where: { id: parentRoleId, tenantId } });
    if (!parent) throw new NotFoundError('Parent role not found in this tenant');
  }

  try {
    return await prisma.role.create({
      data: { tenantId, name, description, parentRoleId },
    });
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) {
      throw new ConflictError(`Role "${name}" already exists in this tenant`);
    }
    throw e;
  }
}

export async function updateRole(
  roleId: string,
  tenantId: string,
  data: { name?: string; description?: string },
) {
  const role = await prisma.role.findFirst({ where: { id: roleId, tenantId } });
  if (!role) throw new NotFoundError('Role not found');
  return prisma.role.update({ where: { id: roleId }, data });
}

export async function deleteRole(roleId: string, tenantId: string) {
  const role = await prisma.role.findFirst({ where: { id: roleId, tenantId } });
  if (!role) throw new NotFoundError('Role not found');

  // Check if any users are currently assigned this role
  const memberCount = await prisma.membership.count({
    where: { roleId, isActive: true },
  });
  if (memberCount > 0) {
    throw new ConflictError(
      `Cannot delete role: ${memberCount} active user(s) assigned to it. Reassign them first.`,
    );
  }

  await prisma.role.delete({ where: { id: roleId } });
}

// ─── Permission assignment ─────────────────────────────────────────────────────

export async function setRolePermissions(roleId: string, tenantId: string, permissionNames: string[]) {
  const role = await prisma.role.findFirst({ where: { id: roleId, tenantId } });
  if (!role) throw new NotFoundError('Role not found');

  // Validate all permission names exist
  const permissions = await prisma.permission.findMany({
    where: { name: { in: permissionNames } },
  });

  if (permissions.length !== permissionNames.length) {
    const found = permissions.map((p) => p.name);
    const unknown = permissionNames.filter((n) => !found.includes(n));
    throw new BadRequestError(`Unknown permissions: ${unknown.join(', ')}`);
  }

  // Replace all permissions for this role atomically
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId, permissionId: p.id })),
    }),
  ]);

  return prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: { include: { permission: true } } },
  });
}

// ─── Role hierarchy ───────────────────────────────────────────────────────────

// Set the parent role — with cycle detection.
// A cycle (A → B → A) would cause infinite recursion in the permission CTE.
export async function setParentRole(roleId: string, tenantId: string, parentRoleId: string | null) {
  const role = await prisma.role.findFirst({ where: { id: roleId, tenantId } });
  if (!role) throw new NotFoundError('Role not found');

  if (parentRoleId !== null) {
    const parent = await prisma.role.findFirst({ where: { id: parentRoleId, tenantId } });
    if (!parent) throw new NotFoundError('Parent role not found in this tenant');

    if (parentRoleId === roleId) {
      throw new BadRequestError('A role cannot be its own parent');
    }

    const hasCycle = await wouldCreateCycle(roleId, parentRoleId);
    if (hasCycle) {
      throw new BadRequestError('Setting this parent would create a circular role hierarchy');
    }
  }

  return prisma.role.update({
    where: { id: roleId },
    data: { parentRoleId },
    include: { parentRole: { select: { id: true, name: true } } },
  });
}

// Walk the ancestor chain of `proposedParentId`.
// If `roleId` appears in that chain, setting it as parent would create a cycle.
async function wouldCreateCycle(roleId: string, proposedParentId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE ancestors AS (
      SELECT id, "parentRoleId"
      FROM "Role"
      WHERE id = ${proposedParentId}

      UNION ALL

      SELECT r.id, r."parentRoleId"
      FROM "Role" r
      INNER JOIN ancestors a ON a."parentRoleId" = r.id
    )
    SELECT id FROM ancestors WHERE id = ${roleId}
  `;
  return rows.length > 0;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isUniqueConstraintError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code: string }).code === 'P2002'
  );
}

export async function listPermissions() {
  return prisma.permission.findMany({ orderBy: { name: 'asc' } });
}
