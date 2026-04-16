import { prisma } from '../prisma/client';

export async function getAuditLogs(tenantId: string, page = 1, limit = 50) {
  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        actor: { select: { id: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where: { tenantId } }),
  ]);

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}
