/**
 * RBAC Service — the core permission resolution engine.
 *
 * This is the most important file in the codebase. It answers two questions:
 *   1. What permissions does a user have in a given tenant? (getEffectivePermissions)
 *   2. Can they act on any resource, or only their own? (getUserScope)
 *
 * HOW ROLE HIERARCHY WORKS
 * ─────────────────────────
 * Roles form a tree via the `parentRoleId` field:
 *
 *   Owner (tenants:write, users:delete, roles:delete)
 *     └── Admin (users:write, roles:read)
 *           └── Editor (posts:write, posts:delete)
 *                 └── Viewer (posts:read, tenants:read)
 *
 * A user assigned the "Editor" role inherits Viewer's permissions too.
 * We resolve this with a single PostgreSQL recursive CTE — no app-level loops,
 * no N+1 queries, works for any depth.
 *
 * WHY NOT CACHE PERMISSIONS IN THE JWT?
 * ────────────────────────────────────────
 * If permissions were in the JWT, a role change would be invisible until the
 * token expires (up to 1 hour). By resolving fresh from the DB on every request,
 * role changes and membership deactivations take effect immediately.
 * We cache only within a single request (on req.effectivePermissions) to avoid
 * redundant DB calls when multiple middlewares check permissions.
 */

import { Request } from 'express';
import { prisma } from '../prisma/client';
import { ForbiddenError } from '../types/errors';
import type { PermissionScope } from '../types/index';

// ─── Permission resolution ────────────────────────────────────────────────────

/**
 * Resolve the complete set of permissions a user has in a tenant,
 * including permissions inherited through the role hierarchy.
 *
 * Uses a recursive CTE to walk the role tree in a single SQL query:
 *   - Base case: roles directly assigned to the user via active memberships
 *   - Recursive step: for each role, find its parent role and include it too
 *   - Final step: collect all distinct permissions from all resolved roles
 */
export async function getEffectivePermissions(
  userId: string,
  tenantId: string,
): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    WITH RECURSIVE role_hierarchy AS (

      -- BASE CASE: start with roles directly assigned to this user in this tenant.
      -- We only consider active memberships so removed users get nothing.
      SELECT r.id, r."parentRoleId"
      FROM "Membership" m
      JOIN "Role" r ON r.id = m."roleId"
      WHERE m."userId"   = ${userId}
        AND m."tenantId" = ${tenantId}
        AND m."isActive" = TRUE

      UNION

      -- RECURSIVE STEP: for each role in role_hierarchy, find its parent.
      -- We keep climbing until there is no more parent (parentRoleId IS NULL).
      SELECT r.id, r."parentRoleId"
      FROM "Role" r
      INNER JOIN role_hierarchy rh ON rh."parentRoleId" = r.id
    )

    -- Collect all distinct permission names from every role in the resolved tree.
    SELECT DISTINCT p.name
    FROM role_hierarchy rh
    JOIN "RolePermission" rp ON rp."roleId"       = rh.id
    JOIN "Permission"    p  ON p.id              = rp."permissionId"
  `;

  return new Set(rows.map((r: { name: string }) => r.name));
}

// ─── Scope resolution ─────────────────────────────────────────────────────────

/**
 * After confirming a user has a permission, determine the scope:
 *   - 'all'  → user can act on any resource in the tenant
 *   - 'own'  → user can only act on resources they own (authorId === userId)
 *
 * If ANY active membership grants scope='all' for this permission, 'all' wins.
 * 'own' is returned only when every matching membership has scope='own'.
 */
export async function getUserScope(
  userId: string,
  tenantId: string,
  permission: string,
): Promise<PermissionScope> {
  // Must use the same recursive CTE as getEffectivePermissions.
  // The non-recursive version only checks the directly-assigned role, so inherited
  // permissions (e.g. Owner inheriting posts:read from Viewer) return no rows and
  // incorrectly fall through to the 'own' default.
  // By propagating m.scope through every level of the hierarchy, we always return
  // the scope that came from the user's actual membership row.
  const rows = await prisma.$queryRaw<{ scope: string }[]>`
    WITH RECURSIVE role_hierarchy AS (

      -- Base: directly assigned roles, carry the membership scope forward
      SELECT r.id, r."parentRoleId", m.scope
      FROM "Membership" m
      JOIN "Role" r ON r.id = m."roleId"
      WHERE m."userId"   = ${userId}
        AND m."tenantId" = ${tenantId}
        AND m."isActive" = TRUE

      UNION

      -- Recursive: parent roles inherit the same scope from the base membership
      SELECT r.id, r."parentRoleId", rh.scope
      FROM "Role" r
      INNER JOIN role_hierarchy rh ON rh."parentRoleId" = r.id
    )

    SELECT DISTINCT rh.scope
    FROM role_hierarchy rh
    JOIN "RolePermission" rp ON rp."roleId" = rh.id
    JOIN "Permission"    p  ON p.id        = rp."permissionId"
    WHERE p.name = ${permission}
  `;

  // If any membership grants 'all', the effective scope is 'all'
  if (rows.some((r: { scope: string }) => r.scope === 'all')) return 'all';
  return 'own';
}

// ─── Ownership enforcement ────────────────────────────────────────────────────

/**
 * Call this inside controllers AFTER requirePermissionOrOwn middleware.
 *
 * If the user's scope is 'own', they may only touch resources they created.
 * If the resource belongs to someone else, throw ForbiddenError.
 *
 * Example:
 *   const post = await prisma.post.findFirst({ where: { id, tenantId } });
 *   assertOwnership(req, post.authorId);  // throws 403 if not their post
 */
export function assertOwnership(req: Request, resourceOwnerId: string): void {
  if (req.permissionScope === 'own' && req.user!.userId !== resourceOwnerId) {
    throw new ForbiddenError('You can only modify your own resources');
  }
}

// ─── Membership check ─────────────────────────────────────────────────────────

/**
 * Verify a user is an active member of a tenant.
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
