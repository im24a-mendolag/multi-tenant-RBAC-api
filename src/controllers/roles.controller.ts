import { RequestHandler } from 'express';
import { z } from 'zod';
import * as rolesService from '../services/roles.service';
import { BadRequestError } from '../types/errors';

const CreateRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parentRoleId: z.string().uuid().optional(),
});

const UpdateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

const SetPermissionsSchema = z.object({
  permissions: z.array(z.string()).min(1),
});

const SetParentSchema = z.object({
  parentRoleId: z.string().uuid().nullable(),
});

export const listRoles: RequestHandler = async (req, res) => {
  const roles = await rolesService.listRoles(req.tenantContext!.tenantId);
  res.json(roles);
};

export const createRole: RequestHandler = async (req, res) => {
  const result = CreateRoleSchema.safeParse(req.body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);

  const role = await rolesService.createRole(
    req.tenantContext!.tenantId,
    result.data.name,
    result.data.description,
    result.data.parentRoleId,
  );
  res.status(201).json(role);
};

export const updateRole: RequestHandler = async (req, res) => {
  const result = UpdateRoleSchema.safeParse(req.body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);

  const role = await rolesService.updateRole(
    req.params.roleId as string,
    req.tenantContext!.tenantId,
    result.data,
  );
  res.json(role);
};

export const deleteRole: RequestHandler = async (req, res) => {
  await rolesService.deleteRole(req.params.roleId as string, req.tenantContext!.tenantId);
  res.status(204).send();
};

export const setPermissions: RequestHandler = async (req, res) => {
  const result = SetPermissionsSchema.safeParse(req.body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);

  const role = await rolesService.setRolePermissions(
    req.params.roleId as string,
    req.tenantContext!.tenantId,
    result.data.permissions,
  );
  res.json(role);
};

export const setParent: RequestHandler = async (req, res) => {
  const result = SetParentSchema.safeParse(req.body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);

  const role = await rolesService.setParentRole(
    req.params.roleId as string,
    req.tenantContext!.tenantId,
    result.data.parentRoleId,
  );
  res.json(role);
};

export const listPermissions: RequestHandler = async (_req, res) => {
  const perms = await rolesService.listPermissions();
  res.json(perms);
};
