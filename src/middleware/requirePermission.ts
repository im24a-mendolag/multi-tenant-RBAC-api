import { RequestHandler } from 'express';
import { getEffectivePermissions, getUserScope } from '../services/rbac.service';
import { ForbiddenError } from '../types/errors';

/**
 * requirePermission(permission)
 *
 * Factory that returns middleware checking whether the authenticated user
 * has the given permission in the current tenant.
 *
 * Permission strings follow the "resource:action" pattern, e.g.:
 *   'posts:read', 'posts:write', 'users:delete', 'roles:write'
 *
 * Permissions are resolved by walking the full role hierarchy via a
 * recursive CTE (see rbac.service.ts). The resolved Set is cached on
 * req.effectivePermissions so subsequent permission checks in the same
 * request don't hit the DB again.
 *
 * Usage:
 *   router.get('/posts', authenticate, requireTenant, requirePermission('posts:read'), handler)
 */
export function requirePermission(permission: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const { userId } = req.user!;
      const { tenantId } = req.tenantContext!;

      // Resolve and cache effective permissions for this request
      if (!req.effectivePermissions) {
        req.effectivePermissions = await getEffectivePermissions(userId, tenantId);
      }

      if (!req.effectivePermissions.has(permission)) {
        throw new ForbiddenError(`Missing permission: ${permission}`);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * requirePermissionOrOwn(permission)
 *
 * Like requirePermission, but also determines the user's scope for this permission:
 *   - 'all'  → user can act on any resource → req.permissionScope = 'all'
 *   - 'own'  → user can only act on their own resources → req.permissionScope = 'own'
 *
 * Controllers must then call assertOwnership(req, resource.authorId) to enforce
 * the scope. If scope is 'own' and the resource belongs to someone else, it throws 403.
 *
 * Usage:
 *   router.put('/posts/:id', authenticate, requireTenant, requirePermissionOrOwn('posts:write'), handler)
 *
 *   // Inside handler:
 *   const post = await prisma.post.findFirst({ where: { id, tenantId } });
 *   assertOwnership(req, post.authorId);
 */
export function requirePermissionOrOwn(permission: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const { userId } = req.user!;
      const { tenantId } = req.tenantContext!;

      if (!req.effectivePermissions) {
        req.effectivePermissions = await getEffectivePermissions(userId, tenantId);
      }

      if (!req.effectivePermissions.has(permission)) {
        throw new ForbiddenError(`Missing permission: ${permission}`);
      }

      // Determine scope — stored on req for the controller to use
      req.permissionScope = await getUserScope(userId, tenantId, permission);

      next();
    } catch (err) {
      next(err);
    }
  };
}
