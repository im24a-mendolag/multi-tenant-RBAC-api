# Architecture Decisions

## Why X-Tenant-ID header instead of tenant in the JWT?

A user can belong to many tenants. If the tenant was embedded in the JWT, switching tenants would require issuing a new token — or one token per tenant. Instead:

- The JWT identifies **who you are** (userId, email)
- The `X-Tenant-ID` header identifies **which organization you're acting as**
- The `requireTenant` middleware validates that the combination is valid in the DB on **every request**

This means the header is a *selector*, not a *trust boundary*. The DB check is the real gate.

## Why not cache permissions in the JWT?

If we put `["posts:read", "posts:write"]` inside the JWT, a role change would be invisible until the token expired (up to 1 hour). Any user whose role was revoked would continue to have those permissions until expiry.

By resolving permissions fresh from the DB on every request via `getEffectivePermissions`, role changes and membership deactivations take effect **immediately**.

The only caching we do is within a single request (on `req.effectivePermissions`) to avoid redundant DB calls if multiple middleware checks run in the same request.

## Why a recursive CTE instead of application-level recursion?

Role hierarchy traversal could be done in JavaScript: fetch the user's role, check if it has a parent, fetch the parent's permissions, and so on. This is simple but creates N+1 query patterns and breaks down at scale.

The recursive CTE in `rbac.service.ts` resolves the full permission tree — regardless of depth — in a **single SQL query**. PostgreSQL's `WITH RECURSIVE` stops automatically when no new rows are added, preventing infinite loops even if the hierarchy has unexpected cycles (which our cycle-detection code also prevents at write time).

## Why store permissions as global strings instead of per-tenant?

Permission names like `posts:read` are **code-level constants** — they're tied to specific route handlers, not to user configuration. Allowing tenants to define custom permissions would mean a permission could exist in the DB that no route handler checks for, silently granting access to nothing while looking legitimate.

Keeping permissions global and seeded at startup (via `prisma/seed.ts`) means:
- The permission catalog is an authoritative list of what the system can enforce
- Adding a new protected action always requires a code change + seed update
- Auditors can see all possible permissions without querying tenant data

## Why soft-delete for memberships?

When a user is removed from a tenant (`DELETE /tenants/:id/users/:uid`), we set `Membership.isActive = false` rather than deleting the row. This:

1. Preserves audit log foreign key references (the membership row still exists)
2. Allows re-invitation later without creating a duplicate
3. Provides a complete record of who was ever a member

Audit log rows use `ON DELETE SET NULL` for both `tenantId` and `actorId`, so even if a tenant or user is fully deleted, the audit record remains with `NULL` references.

## Why `requirePermissionOrOwn` instead of checking scope in the service?

Ownership enforcement (`scope=own`) must happen at the **request level**, not inside the service, because:

1. The service doesn't know about the HTTP request context
2. Multiple routes might share the same service function but have different scope requirements
3. It makes the security boundary explicit and visible in the route definition

The pattern is:
```
route → requirePermissionOrOwn → controller → service
                  ↓
         sets req.permissionScope
                  ↓
        controller calls assertOwnership(req, resource.authorId)
```

## Middleware composition pattern

Every protected route follows the same explicit chain:
```
authenticate → requireTenant → requirePermission/requirePermissionOrOwn → controller → [auditLog]
```

There is **no implicit admin bypass** in any controller. The middleware is the security boundary. If a route doesn't have `requirePermission`, it's intentionally unprotected (e.g., `POST /tenants`, `POST /auth/register`).

This makes the security model easy to audit: you can read any route file and immediately know exactly what checks are enforced.

## Why raw `$queryRaw` for RBAC instead of Prisma Client?

Prisma's query API cannot express recursive CTEs. The recursive permission resolution query is the single exception to using Prisma Client everywhere else. Using `$queryRaw` here is appropriate because:

1. The query is isolated in `rbac.service.ts` — easy to find and review
2. Prisma's template literal tag (`prisma.$queryRaw\`...\``) automatically parameterizes all values — no SQL injection risk
3. The raw SQL is actually **clearer** for this use case — the recursive CTE logic is more readable as SQL than it would be as JavaScript traversal code

## IDOR prevention pattern

Every query against a tenant-scoped table includes `AND tenantId = <value from req.tenantContext>`. The `tenantId` in `req.tenantContext` was set by `requireTenant` after validating the user's membership.

This means even if an attacker guesses a valid resource UUID from another tenant, every query will silently return `null` (converted to 404) rather than leaking the resource.

```typescript
// Every lookup looks like this:
prisma.post.findFirst({ where: { id: postId, tenantId: req.tenantContext.tenantId } })
//                                                         ↑ always from middleware, never from input
```
