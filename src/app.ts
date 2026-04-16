import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import { swaggerDocument } from './swagger';
import { authRouter } from './routes/auth.routes';
import { tenantsRouter } from './routes/tenants.routes';
import { postsRouter } from './routes/posts.routes';
import { rolesRouter } from './routes/roles.routes';
import { auditRouter } from './routes/audit.routes';
import { authenticate } from './middleware/authenticate';
import { requireTenant } from './middleware/requireTenant';
import { requirePermission } from './middleware/requirePermission';
import { auditLog } from './middleware/auditLog';
import { invite } from './controllers/invite.controller';
import { AppError } from './types/errors';

export function createApp() {
  const app = express();

  app.use(express.json());

  // ─── Routes ─────────────────────────────────────────────────────────────────

  app.use('/auth', authRouter);
  app.use('/tenants', tenantsRouter);
  app.use('/posts', postsRouter);

  // Roles routes are nested under /tenants/:tenantId in the URL but handled
  // separately to keep each router file focused.
  app.use('/tenants/:tenantId/roles', (req, _res, next) => {
    // Copy tenantId from URL param into headers so requireTenant middleware can find it.
    // This bridges the URL-param style (/tenants/:id/roles) with the header-based
    // tenant context used everywhere else.
    if (!req.headers['x-tenant-id']) {
      req.headers['x-tenant-id'] = req.params.tenantId;
    }
    next();
  }, rolesRouter);

  // Invite endpoint
  app.post(
    '/tenants/:tenantId/invite',
    (req, _res, next) => {
      if (!req.headers['x-tenant-id']) req.headers['x-tenant-id'] = req.params.tenantId;
      next();
    },
    authenticate,
    requireTenant,
    requirePermission('roles:write'),
    auditLog('user.invited', (req) => `tenant:${req.params.tenantId}`),
    invite,
  );

  // Audit log endpoint
  app.use('/tenants/:tenantId/audit', (req, _res, next) => {
    if (!req.headers['x-tenant-id']) req.headers['x-tenant-id'] = req.params.tenantId;
    next();
  }, auditRouter);

  // ─── "Who am I?" endpoint ────────────────────────────────────────────────────
  // Returns the calling user's resolved permissions for the current tenant.
  // Useful for understanding what a role can do without reading the code.
  app.get(
    '/me/permissions',
    authenticate,
    requireTenant,
    async (req, res) => {
      const { getEffectiveRoles } = await import('./services/rbac.service');
      const { can } = await import('./services/policy');
      const { userId } = req.user!;
      const { tenantId } = req.tenantContext!;

      const roles = await getEffectiveRoles(userId, tenantId);

      const ALL: [string, string][] = [
        ['posts', 'read'],   ['posts', 'write'],   ['posts', 'delete'],
        ['users', 'read'],   ['users', 'write'],   ['users', 'delete'],
        ['roles', 'read'],   ['roles', 'write'],   ['roles', 'delete'],
        ['tenants', 'read'], ['tenants', 'write'],
        ['audit', 'read'],
      ];

      // Filter to only permissions the user holds (optimistic: isOwner=true).
      // Ownership-conditional entries (e.g. posts:write for Viewer) are marked ownerOnly=true.
      const permissions = ALL
        .filter(([asset, action]) => can(roles as any, action as any, asset as any, true))
        .map(([asset, action]) => {
          const unconditional = can(roles as any, action as any, asset as any, false);
          return { permission: `${asset}:${action}`, ownerOnly: !unconditional };
        });

      res.json({ userId, tenantId, permissions });
    }
  );

  // ─── Swagger UI ──────────────────────────────────────────────────────────────
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

  // ─── Health check ────────────────────────────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ─── Global error handler ────────────────────────────────────────────────────
  // Catches all errors thrown by route handlers and middleware.
  // AppError subclasses produce structured JSON with the right status code.
  // Unknown errors become 500s with the stack hidden in production.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }

    console.error('[unhandled error]', err);
    res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : (err instanceof Error ? err.message : String(err)),
    });
  });

  return app;
}
