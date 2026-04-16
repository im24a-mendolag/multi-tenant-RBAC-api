import { RequestHandler } from 'express';
import { z } from 'zod';
import { inviteUserToTenant } from '../services/invite.service';
import { BadRequestError } from '../types/errors';

const InviteSchema = z.object({
  email: z.email(),
  roleId: z.string().uuid(),
  scope: z.enum(['all', 'own']).default('all'),
});

export const invite: RequestHandler = async (req, res) => {
  const result = InviteSchema.safeParse(req.body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);

  const data = await inviteUserToTenant(
    req.tenantContext!.tenantId,
    result.data.email,
    result.data.roleId,
    result.data.scope,
  );

  res.status(201).json(data);
};
