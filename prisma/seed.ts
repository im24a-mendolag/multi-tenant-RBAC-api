import 'dotenv/config';
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

async function main() {
  console.log('Seeding permissions...');

  for (const name of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log(`✅ Seeded ${PERMISSIONS.length} permissions`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
