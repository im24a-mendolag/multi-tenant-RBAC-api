import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireTenant } from '../middleware/requireTenant';
import { requirePermission } from '../middleware/requirePermission';
import { auditLog } from '../middleware/auditLog';
import * as rolesController from '../controllers/roles.controller';

export const rolesRouter = Router();

// List all valid permission strings — useful when building role assignment UIs.
rolesRouter.get(
  '/permissions',
  authenticate,
  requireTenant,
  requirePermission('roles:read'),
  rolesController.listPermissions,
);

rolesRouter.get(
  '/',
  authenticate,
  requireTenant,
  requirePermission('roles:read'),
  rolesController.listRoles,
);

rolesRouter.post(
  '/',
  authenticate,
  requireTenant,
  requirePermission('roles:write'),
  auditLog('role.created', (req) => `tenant:${req.tenantContext?.tenantId}`),
  rolesController.createRole,
);

rolesRouter.put(
  '/:roleId',
  authenticate,
  requireTenant,
  requirePermission('roles:write'),
  auditLog('role.updated', (req) => `role:${req.params.roleId}`),
  rolesController.updateRole,
);

rolesRouter.delete(
  '/:roleId',
  authenticate,
  requireTenant,
  requirePermission('roles:delete'),
  auditLog('role.deleted', (req) => `role:${req.params.roleId}`),
  rolesController.deleteRole,
);

// Replace the full set of permissions assigned to a role.
rolesRouter.put(
  '/:roleId/permissions',
  authenticate,
  requireTenant,
  requirePermission('roles:write'),
  auditLog('role.permissions_updated', (req) => `role:${req.params.roleId}`),
  rolesController.setPermissions,
);

// Set or clear the parent role (hierarchy management).
rolesRouter.put(
  '/:roleId/parent',
  authenticate,
  requireTenant,
  requirePermission('roles:write'),
  auditLog('role.parent_changed', (req) => `role:${req.params.roleId}`),
  rolesController.setParent,
);
