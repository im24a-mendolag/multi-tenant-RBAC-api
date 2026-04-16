import bcrypt from 'bcryptjs';
import { prisma } from '../prisma/client';
import { NotFoundError, ConflictError } from '../types/errors';

/**
 * Invite a user to a tenant by email.
 *
 * Flow:
 *   1. Look up the user by email.
 *      - If they already have an account, use it.
 *      - If not, create a pre-registered account with a temporary password.
 *        In a real system this would trigger an invitation email.
 *   2. Verify the roleId belongs to the specified tenant.
 *   3. Create a Membership row linking user → tenant → role.
 *
 * The invited user can then log in (using the temporary password if newly created)
 * and immediately access the tenant with the assigned role.
 */
export async function inviteUserToTenant(
  tenantId: string,
  email: string,
  roleId: string,
) {
  // Verify role belongs to this tenant
  const role = await prisma.role.findFirst({ where: { id: roleId, tenantId } });
  if (!role) throw new NotFoundError('Role not found in this tenant');

  // Find or create user
  let user = await prisma.user.findUnique({ where: { email } });
  let isNewUser = false;

  if (!user) {
    // Pre-register with a temporary random password.
    // A real implementation would send an invitation email with a magic link.
    const tempPassword = `temp-${crypto.randomUUID()}`;
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    user = await prisma.user.create({ data: { email, passwordHash } });
    isNewUser = true;
  }

  // Check if user is already an active member with this role
  const existingMembership = await prisma.membership.findFirst({
    where: { userId: user.id, tenantId, isActive: true },
  });

  if (existingMembership) {
    throw new ConflictError('User is already an active member of this tenant');
  }

  // Re-activate a previously deactivated membership if one exists
  const inactiveMembership = await prisma.membership.findFirst({
    where: { userId: user.id, tenantId, roleId, isActive: false },
  });

  if (inactiveMembership) {
    const membership = await prisma.membership.update({
      where: { id: inactiveMembership.id },
      data: { isActive: true },
      include: { role: { select: { id: true, name: true } } },
    });
    return { user: { id: user.id, email: user.email }, membership, isNewUser };
  }

  const membership = await prisma.membership.create({
    data: { userId: user.id, tenantId, roleId },
    include: { role: { select: { id: true, name: true } } },
  });

  return { user: { id: user.id, email: user.email }, membership, isNewUser };
}
