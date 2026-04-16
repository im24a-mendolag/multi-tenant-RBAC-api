import { prisma } from '../prisma/client';
import { ConflictError, NotFoundError, BadRequestError } from '../types/errors';

// ─── Tenant CRUD ──────────────────────────────────────────────────────────────

export async function createTenant(name: string, slug: string, creatorUserId: string) {
  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new BadRequestError('Slug must contain only lowercase letters, numbers, and hyphens');
  }

  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) throw new ConflictError(`Slug "${slug}" is already taken`);

  // Create the tenant and the built-in Owner role in a single transaction.
  // The creator is automatically assigned the Owner role so every tenant
  // always has at least one admin member.
  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name, slug } });

    // Seed the four standard roles for this tenant.
    // Hierarchy: Owner → Admin → Editor → Viewer
    const viewer = await tx.role.create({
      data: { tenantId: tenant.id, name: 'Viewer', description: 'Read-only access' },
    });
    const editor = await tx.role.create({
      data: {
        tenantId: tenant.id,
        name: 'Editor',
        description: 'Can create and edit content',
        parentRoleId: viewer.id,
      },
    });
    const admin = await tx.role.create({
      data: {
        tenantId: tenant.id,
        name: 'Admin',
        description: 'Manages users and roles',
        parentRoleId: editor.id,
      },
    });
    const owner = await tx.role.create({
      data: {
        tenantId: tenant.id,
        name: 'Owner',
        description: 'Full control over the tenant',
        parentRoleId: admin.id,
      },
    });

    // Make the creator an Owner
    await tx.membership.create({
      data: { userId: creatorUserId, tenantId: tenant.id, roleId: owner.id },
    });

    return tenant;
  });

  return result;
}

export async function getTenantById(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant not found');
  return tenant;
}

export async function updateTenant(tenantId: string, name: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant not found');
  return prisma.tenant.update({ where: { id: tenantId }, data: { name } });
}

// Returns all tenants the calling user is an active member of.
export async function getTenantsForUser(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId, isActive: true },
    include: { tenant: true },
  });
  return memberships.map((m) => m.tenant);
}
