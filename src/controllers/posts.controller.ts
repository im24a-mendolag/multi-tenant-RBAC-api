import { RequestHandler } from 'express';
import { z } from 'zod';
import * as postsService from '../services/posts.service';
import { assertOwnership } from '../services/rbac.service';
import { BadRequestError } from '../types/errors';

const CreatePostSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

const UpdatePostSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

export const listPosts: RequestHandler = async (req, res) => {
  const posts = await postsService.listPosts(req.tenantContext!.tenantId);
  res.json(posts);
};

export const getPost: RequestHandler = async (req, res) => {
  const post = await postsService.getPost(req.params.postId as string, req.tenantContext!.tenantId);
  res.json(post);
};

export const createPost: RequestHandler = async (req, res) => {
  const result = CreatePostSchema.safeParse(req.body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);

  const post = await postsService.createPost(
    req.tenantContext!.tenantId,
    req.user!.userId,
    result.data.title,
    result.data.body,
  );
  res.status(201).json(post);
};

export const updatePost: RequestHandler = async (req, res) => {
  const result = UpdatePostSchema.safeParse(req.body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);

  // Fetch first to get the authorId for ownership check.
  // tenantId from req.tenantContext prevents cross-tenant access (IDOR prevention).
  const postId = req.params.postId as string;
  const post = await postsService.getPost(postId, req.tenantContext!.tenantId);

  // assertOwnership checks req.permissionScope — if 'own', the caller must be the author.
  // If 'all', any user with posts:write can edit any post in the tenant.
  assertOwnership(req, post.author.id);

  const updated = await postsService.updatePost(postId, req.tenantContext!.tenantId, result.data);
  res.json(updated);
};

export const deletePost: RequestHandler = async (req, res) => {
  const postId = req.params.postId as string;
  const post = await postsService.getPost(postId, req.tenantContext!.tenantId);
  assertOwnership(req, post.author.id);
  await postsService.deletePost(postId, req.tenantContext!.tenantId);
  res.status(204).send();
};
