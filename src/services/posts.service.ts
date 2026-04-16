import { prisma } from '../prisma/client';
import { NotFoundError } from '../types/errors';

/**
 * Posts service — a demo resource that shows RBAC + IDOR prevention in action.
 *
 * IDOR PREVENTION PATTERN:
 * Every query includes `tenantId` sourced from req.tenantContext (validated by
 * requireTenant middleware). Never use tenantId from the request body or URL
 * params for security-sensitive lookups.
 *
 * Example of the vulnerability:
 *   ❌ prisma.post.findUnique({ where: { id: postId } })
 *      → User can guess any UUID across ALL tenants
 *
 *   ✅ prisma.post.findFirst({ where: { id: postId, tenantId } })
 *      → Post is only returned if it belongs to the caller's tenant
 */

export async function listPosts(tenantId: string) {
  return prisma.post.findMany({
    where: { tenantId },
    include: {
      author: { select: { id: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getPost(postId: string, tenantId: string) {
  // tenantId is always included — this prevents cross-tenant ID guessing (IDOR)
  const post = await prisma.post.findFirst({
    where: { id: postId, tenantId },
    include: { author: { select: { id: true, email: true } } },
  });
  if (!post) throw new NotFoundError('Post not found');
  return post;
}

export async function createPost(
  tenantId: string,
  authorId: string,
  title: string,
  body: string,
) {
  return prisma.post.create({
    data: { tenantId, authorId, title, body },
    include: { author: { select: { id: true, email: true } } },
  });
}

export async function updatePost(
  postId: string,
  tenantId: string,
  data: { title?: string; body?: string },
) {
  // Verify post exists in this tenant before updating (prevents IDOR on update)
  const existing = await prisma.post.findFirst({ where: { id: postId, tenantId } });
  if (!existing) throw new NotFoundError('Post not found');

  return prisma.post.update({
    where: { id: postId },
    data,
    include: { author: { select: { id: true, email: true } } },
  });
}

export async function deletePost(postId: string, tenantId: string) {
  const existing = await prisma.post.findFirst({ where: { id: postId, tenantId } });
  if (!existing) throw new NotFoundError('Post not found');
  await prisma.post.delete({ where: { id: postId } });
}
