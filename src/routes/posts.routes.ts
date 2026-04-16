import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireTenant } from '../middleware/requireTenant';
import { requirePermission } from '../middleware/requirePermission';
import { auditLog } from '../middleware/auditLog';
import * as postsController from '../controllers/posts.controller';

export const postsRouter = Router();

/**
 * All posts routes require:
 *   1. authenticate  — valid JWT
 *   2. requireTenant — X-Tenant-ID header + active membership
 *   3. requirePermission / requirePermissionOrOwn — explicit permission check
 *
 * This middleware chain is the entire security boundary.
 * There is no implicit "admin always wins" logic anywhere in the controllers.
 */

postsRouter.get(
  '/',
  authenticate,
  requireTenant,
  requirePermission('posts:read'),
  postsController.listPosts,
);

postsRouter.get(
  '/:postId',
  authenticate,
  requireTenant,
  requirePermission('posts:read'),
  postsController.getPost,
);

postsRouter.post(
  '/',
  authenticate,
  requireTenant,
  requirePermission('posts:write'),
  postsController.createPost,
);

postsRouter.put(
  '/:postId',
  authenticate,
  requireTenant,
  requirePermission('posts:write'),
  auditLog('post.updated', (req) => `post:${req.params.postId}`),
  postsController.updatePost,
);

postsRouter.delete(
  '/:postId',
  authenticate,
  requireTenant,
  requirePermission('posts:delete'),
  auditLog('post.deleted', (req) => `post:${req.params.postId}`),
  postsController.deletePost,
);
