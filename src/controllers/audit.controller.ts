import { RequestHandler } from 'express';
import { getAuditLogs } from '../services/audit.service';

export const listAuditLogs: RequestHandler = async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  const result = await getAuditLogs(req.tenantContext!.tenantId, page, limit);
  res.json(result);
};
