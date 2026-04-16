import { RequestHandler } from 'express';
import { getEffectiveRoles } from '../services/rbac.service';
import { can, type Role, type Asset, type Action } from '../services/policy';
import { ForbiddenError } from '../types/errors';

/**
 * requirePermission('posts:write')
 *
 * Resolves the user's effective roles and checks the policy matrix.
 * Passes isOwner=true — ownership-conditional permissions (functions in the
 * policy matrix) are evaluated optimistically here. The controller is
 * responsible for re-checking with the real isOwner value after fetching
 * the resource.
 *
 * Roles are cached on req.effectiveRoles to avoid repeat DB calls.
 */
export function requirePermission(permission: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const [asset, action] = permission.split(':') as [Asset, Action];
      const { userId } = req.user!;
      const { tenantId } = req.tenantContext!;

      if (!req.effectiveRoles) {
        req.effectiveRoles = await getEffectiveRoles(userId, tenantId);
      }

      // isOwner=true: optimistic check — "can this role do this action at all?"
      // The real ownership check happens in the controller.
      if (!can(req.effectiveRoles as Role[], action, asset, true)) {
        throw new ForbiddenError(`Missing permission: ${permission}`);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
