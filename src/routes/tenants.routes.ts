import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireTenant } from '../middleware/requireTenant';
import { requirePermission } from '../middleware/requirePermission';
import * as tenantsController from '../controllers/tenants.controller';
import * as usersController from '../controllers/users.controller';
import { auditLog } from '../middleware/auditLog';

export const tenantsRouter = Router();

// ─── Tenant endpoints ─────────────────────────────────────────────────────────

// Create a new tenant — any authenticated user can do this.
// The creator is auto-assigned the Owner role.
tenantsRouter.post('/', authenticate, tenantsController.createTenant);

// List all tenants the calling user is a member of.
tenantsRouter.get('/', authenticate, tenantsController.listMyTenants);

// Tenant-scoped endpoints — require X-Tenant-ID header + active membership.
tenantsRouter.get(
  '/:tenantId',
  authenticate,
  requireTenant,
  requirePermission('tenants:read'),
  tenantsController.getTenant,
);

tenantsRouter.put(
  '/:tenantId',
  authenticate,
  requireTenant,
  requirePermission('tenants:write'),
  auditLog('tenant.update', (req) => `tenant:${req.params.tenantId}`),
  tenantsController.updateTenant,
);

// ─── User management within a tenant ─────────────────────────────────────────

tenantsRouter.get(
  '/:tenantId/users',
  authenticate,
  requireTenant,
  requirePermission('users:read'),
  usersController.listUsers,
);

tenantsRouter.get(
  '/:tenantId/users/:userId',
  authenticate,
  requireTenant,
  requirePermission('users:read'),
  usersController.getUser,
);

tenantsRouter.put(
  '/:tenantId/users/:userId/role',
  authenticate,
  requireTenant,
  requirePermission('roles:write'),
  auditLog('user.role_changed', (req) => `user:${req.params.userId}`),
  usersController.updateUserRole,
);

tenantsRouter.delete(
  '/:tenantId/users/:userId',
  authenticate,
  requireTenant,
  requirePermission('users:delete'),
  auditLog('user.removed', (req) => `user:${req.params.userId}`),
  usersController.removeUser,
);
