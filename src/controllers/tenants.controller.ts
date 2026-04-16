import { RequestHandler } from 'express';
import { z } from 'zod';
import * as tenantsService from '../services/tenants.service';
import { BadRequestError } from '../types/errors';

const CreateTenantSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
});

const UpdateTenantSchema = z.object({
  name: z.string().min(1),
});

export const createTenant: RequestHandler = async (req, res) => {
  const result = CreateTenantSchema.safeParse(req.body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);

  const tenant = await tenantsService.createTenant(
    result.data.name,
    result.data.slug,
    req.user!.userId,
  );
  res.status(201).json(tenant);
};

export const listMyTenants: RequestHandler = async (req, res) => {
  const tenants = await tenantsService.getTenantsForUser(req.user!.userId);
  res.json(tenants);
};

export const getTenant: RequestHandler = async (req, res) => {
  const tenant = await tenantsService.getTenantById(req.tenantContext!.tenantId);
  res.json(tenant);
};

export const updateTenant: RequestHandler = async (req, res) => {
  const result = UpdateTenantSchema.safeParse(req.body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);

  const tenant = await tenantsService.updateTenant(
    req.tenantContext!.tenantId,
    result.data.name,
  );
  res.json(tenant);
};
