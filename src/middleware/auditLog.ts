import { RequestHandler, Request } from 'express';
import { prisma } from '../prisma/client';

/**
 * auditLog(action, getResource?)
 *
 * Factory middleware that logs a privileged action to the audit_logs table
 * AFTER the response is sent (via res.on('finish')).
 *
 * Firing post-response means:
 *   - The audit log never blocks or slows down the request
 *   - We only log SUCCESSFUL actions (statusCode < 400)
 *   - Even if the log write fails, the user's operation succeeded
 *
 * Usage:
 *   router.delete('/posts/:id',
 *     authenticate, requireTenant, requirePermissionOrOwn('posts:delete'),
 *     auditLog('post.delete', req => `post:${req.params.id}`),
 *     postsController.remove
 *   )
 */
export function auditLog(
  action: string,
  getResource?: (req: Request) => string,
): RequestHandler {
  return (req, res, next) => {
    res.on('finish', () => {
      // Only log successful privileged actions
      if (res.statusCode >= 400) return;

      const tenantId = req.tenantContext?.tenantId ?? null;
      const actorId = req.user?.userId ?? null;
      const resource = getResource?.(req) ?? null;

      prisma.auditLog
        .create({
          data: {
            tenantId,
            actorId,
            action,
            resource,
            metadata: {
              method: req.method,
              path: req.path,
              ip: req.ip,
              userAgent: req.headers['user-agent'],
            },
          },
        })
        .catch((err) => {
          // Silently log errors — audit failure must never break the app
          console.error('[audit] Failed to write audit log:', err);
        });
    });

    next();
  };
}
