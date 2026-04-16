/**
 * RBAC Service — database queries that support the permission engine.
 *
 * What lives here:
 *   - getEffectiveRoles  — resolves which roles a user holds (including inherited)
 *   - checkActiveMembership — used by requireTenant to validate access
 *
 * What lives in policy.ts:
 *   - The permission matrix (what each role can do)
 *   - can()  — checks a role set against the matrix
 *
 * WHY NOT CACHE PERMISSIONS IN THE JWT?
 * ────────────────────────────────────────
 * If permissions were in the JWT, a role change would be invisible until the
 * token expires (up to 1 hour). By resolving fresh from the DB on every request,
 * role changes and membership deactivations take effect immediately.
 * We cache only within a single request (on req.effectiveRoles) to avoid
 * redundant DB calls when multiple middlewares check permissions.
 */

import { prisma } from '../prisma/client';
import { resolveRoles } from './policy';

// ─── Role resolution ──────────────────────────────────────────────────────────

/**
 * Return every role name the user holds in a tenant, including inherited ones.
 *
 * Uses a recursive CTE to walk the role tree in a single SQL query:
 *   - Base case: roles directly assigned to the user via active memberships
 *   - Recursive step: for each role, find its parent role and include it too
 *
 * Example: a user assigned "Editor" gets back ['Editor', 'Viewer'] because
 * Editor's parentRoleId points to Viewer.
 */
export async function getEffectiveRoles(
  userId: string,
  tenantId: string,
): Promise<string[]> {
  // Fetch the role directly assigned to this user in this tenant.
  // Hierarchy (e.g. Editor also gets Viewer) is resolved in code via
  // resolveRoles() — no recursive SQL needed.
  const membership = await prisma.membership.findFirst({
    where: { userId, tenantId, isActive: true },
    include: { role: { select: { name: true } } },
  });

  if (!membership) return [];
  return resolveRoles(membership.role.name);
}

// ─── Membership check ─────────────────────────────────────────────────────────

/**
 * Verify a user is an active member of a tenant.
 * Returns false if no active membership exists.
 * Used by requireTenant middleware.
 */
export async function checkActiveMembership(
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const membership = await prisma.membership.findFirst({
    where: { userId, tenantId, isActive: true },
  });
  return membership !== null;
}

