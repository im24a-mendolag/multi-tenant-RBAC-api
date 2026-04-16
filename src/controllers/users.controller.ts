import { RequestHandler } from 'express';
import { z } from 'zod';
import * as usersService from '../services/users.service';
import { BadRequestError } from '../types/errors';

const UpdateRoleSchema = z.object({
  roleId: z.string().uuid(),
  scope: z.enum(['all', 'own']).default('all'),
});

export const listUsers: RequestHandler = async (req, res) => {
  const users = await usersService.listTenantUsers(req.tenantContext!.tenantId);
  res.json(users);
};

export const getUser: RequestHandler = async (req, res) => {
  const user = await usersService.getTenantUser(
    req.params.userId as string,
    req.tenantContext!.tenantId,
  );
  res.json(user);
};

export const updateUserRole: RequestHandler = async (req, res) => {
  const result = UpdateRoleSchema.safeParse(req.body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);

  const membership = await usersService.updateUserRole(
    req.params.userId as string,
    req.tenantContext!.tenantId,
    result.data.roleId,
    result.data.scope,
  );
  res.json(membership);
};

export const removeUser: RequestHandler = async (req, res) => {
  await usersService.removeUserFromTenant(
    req.params.userId as string,
    req.tenantContext!.tenantId,
  );
  res.status(204).send();
};
