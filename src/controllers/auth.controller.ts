import { RequestHandler } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service';
import { BadRequestError } from '../types/errors';

const RegisterSchema = z.object({
  email: z.email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const register: RequestHandler = async (req, res) => {
  const result = RegisterSchema.safeParse(req.body);
  if (!result.success) {
    throw new BadRequestError(result.error.issues[0].message);
  }
  const { email, password } = result.data;
  const data = await authService.register(email, password);
  res.status(201).json(data);
};

export const login: RequestHandler = async (req, res) => {
  const result = LoginSchema.safeParse(req.body);
  if (!result.success) {
    throw new BadRequestError(result.error.issues[0].message);
  }
  const { email, password } = result.data;
  const data = await authService.login(email, password);
  res.json(data);
};

export const refresh: RequestHandler = async (req, res) => {
  const { refreshToken } = await authService.validateRefreshTokenInput(req.body);
  const data = await authService.refresh(refreshToken);
  res.json(data);
};
