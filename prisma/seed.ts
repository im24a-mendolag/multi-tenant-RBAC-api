import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// All valid permission strings in the system.
// Format: "resource:action"
// These are code-level constants — not user-defined — so they live here, not in user-facing APIs.
const PERMISSIONS = [
  'users:read',
  'users:write',
  'users:delete',
  'roles:read',
  'roles:write',
  'roles:delete',
  'posts:read',
  'posts:write',
  'posts:delete',
  'tenants:read',
  'tenants:write',
  'audit:read',
];

// Demo users — one per role so every permission boundary can be demonstrated.
const DEMO_USERS = [
  { email: 'alice@acme.com', password: 'password123' },   // Owner
  { email: 'charlie@acme.com', password: 'password123' }, // Admin
  { email: 'diana@acme.com', password: 'password123' },   // Editor
  { email: 'bob@acme.com', password: 'password123' },     // Viewer
];

async function main() {
  // ── Permissions ──────────────────────────────────────────────────────────────
  console.log('Seeding permissions...');
  for (const name of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`✅ Seeded ${PERMISSIONS.length} permissions`);

  // ── Demo users ────────────────────────────────────────────────────────────────
  console.log('Seeding demo users...');
  const users: Record<string, { id: string; email: string }> = {};
  for (const { email, password } of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash },
    });
    users[email] = user;
  }
  console.log(`✅ Seeded ${DEMO_USERS.length} demo users`);

  // ── Demo tenant ───────────────────────────────────────────────────────────────
  // Only create if it doesn't already exist (e.g. was created via the API).
  console.log('Seeding demo tenant...');
  let tenant = await prisma.tenant.findUnique({ where: { slug: 'acme' } });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: 'Acme Corp', slug: 'acme' },
    });

    // Hierarchy: Owner → Admin → Editor → Viewer
    // Each role only stores its *own* permissions.
    // The recursive CTE in rbac.service.ts collects inherited permissions at query time.
    const viewer = await prisma.role.create({
      data: { tenantId: tenant.id, name: 'Viewer', description: 'Read-only access' },
    });
    const editor = await prisma.role.create({
      data: { tenantId: tenant.id, name: 'Editor', description: 'Can create and edit content', parentRoleId: viewer.id },
    });
    const admin = await prisma.role.create({
      data: { tenantId: tenant.id, name: 'Admin', description: 'Manages users and roles', parentRoleId: editor.id },
    });
    const owner = await prisma.role.create({
      data: { tenantId: tenant.id, name: 'Owner', description: 'Full control over the tenant', parentRoleId: admin.id },
    });

    const allPerms = await prisma.permission.findMany();
    const permByName = new Map(allPerms.map((p) => [p.name, p.id]));

    const rolePermissions: [string, string[]][] = [
      [viewer.id, ['posts:read', 'tenants:read']],
      [editor.id, ['posts:write', 'posts:delete']],
      [admin.id,  ['users:read', 'users:write', 'roles:read', 'roles:write', 'audit:read']],
      [owner.id,  ['users:delete', 'roles:delete', 'tenants:write']],
    ];

    for (const [roleId, perms] of rolePermissions) {
      for (const permName of perms) {
        const permId = permByName.get(permName);
        if (permId) {
          await prisma.rolePermission.create({ data: { roleId, permissionId: permId } });
        }
      }
    }

    // Assign Alice as Owner when we create the tenant fresh.
    await prisma.membership.create({
      data: { userId: users['alice@acme.com'].id, tenantId: tenant.id, roleId: owner.id, scope: 'all' },
    });

    console.log('✅ Created demo tenant "acme" with role hierarchy');
  } else {
    console.log('ℹ️  Tenant "acme" already exists — skipping creation');
  }

  // Bob, Charlie, and Diana are intentionally NOT pre-assigned memberships here.
  // The Postman collection demonstrates the invite flow by adding them at runtime.
  // Only Alice is seeded as Owner so there is always at least one admin in the tenant.
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
