import { RequestHandler } from 'express';
import { checkActiveMembership } from '../services/rbac.service';
import { BadRequestError, ForbiddenError } from '../types/errors';

/**
 * requireTenant middleware
 *
 * Reads the X-Tenant-ID header and validates that:
 *   1. The header is present.
 *   2. The authenticated user has an ACTIVE membership in that tenant.
 *
 * Setting membership.isActive = false immediately blocks the user from that
 * tenant even if they still hold a valid JWT. This solves the "removed user
 * still accessing data" failure case.
 *
 * On success, attaches { tenantId } to req.tenantContext.
 *
 * IMPORTANT: req.tenantContext is the only safe source of tenantId for
 * subsequent DB queries. Never use tenantId from req.params or req.body
 * in security-sensitive queries — that would open IDOR vulnerabilities.
 */
export const requireTenant: RequestHandler = async (req, _res, next) => {
  try {
    const tenantId = req.headers['x-tenant-id'] as string | undefined;

    if (!tenantId) {
      throw new BadRequestError('X-Tenant-ID header is required');
    }

    // Validate UUID format to avoid hitting the DB with garbage values
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(tenantId)) {
      throw new BadRequestError('X-Tenant-ID must be a valid UUID');
    }

    const isMember = await checkActiveMembership(req.user!.userId, tenantId);
    if (!isMember) {
      throw new ForbiddenError('You are not an active member of this tenant');
    }

    req.tenantContext = { tenantId };
    next();
  } catch (err) {
    next(err);
  }
};
