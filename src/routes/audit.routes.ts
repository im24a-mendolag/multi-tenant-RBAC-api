import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireTenant } from '../middleware/requireTenant';
import { requirePermission } from '../middleware/requirePermission';
import { listAuditLogs } from '../controllers/audit.controller';

export const auditRouter = Router();

auditRouter.get(
  '/',
  authenticate,
  requireTenant,
  requirePermission('audit:read'),
  listAuditLogs,
);
