# Threat Model & Failure Analysis

This document describes the failure cases this system is designed to prevent, how each attack would work in a naive implementation, and the specific defense applied here.

---

## Failure Case 1: Wrong-tenant access

**Attack:** Alice is a member of Tenant A. She sets the `X-Tenant-ID` header to Tenant B's ID in her request.

**Naive system:** The route reads tenantId from the header and uses it directly in queries — no validation of membership.

**Defense here:** `requireTenant` middleware queries `Membership` table on every request:
```typescript
const isMember = await checkActiveMembership(req.user.userId, tenantId);
if (!isMember) throw new ForbiddenError('You are not an active member of this tenant');
```
The header is a selector, not a trust boundary. The DB check is the real gate.

---

## Failure Case 2: Removed user still accessing data

**Attack:** Bob is removed from Tenant A by an admin. He still holds a valid JWT (1h TTL). He continues to access Tenant A's data until his token expires.

**Naive system:** Only checks the JWT on every request. Revocation requires waiting for token expiry.

**Defense here:** `Membership.isActive` is checked on every request via `requireTenant`. Setting it to `false` locks the user out immediately, regardless of JWT TTL. The JWT is verified at the crypto level, but authorization is always checked against the current DB state.

---

## Failure Case 3: Role changes not taking effect

**Attack:** Charlie is an Editor. An admin downgrades him to Viewer (removing `posts:write`). Charlie continues to write posts because his token still says "Editor".

**Naive system:** Embeds permissions or role names in the JWT. Role changes don't take effect until token expiry.

**Defense here:** Permissions are **never** stored in the JWT. Every request calls `getEffectivePermissions(userId, tenantId)` which runs the recursive CTE against the current DB state. Role changes take effect on the very next request.

---

## Failure Case 4: Leaked resources through unscoped queries

**Attack:** A developer writes `prisma.post.findUnique({ where: { id: postId } })` without a tenant filter. A user can read any post in the system by guessing UUIDs.

**Naive system:** Resource lookup by ID without tenant scoping. Cross-tenant data is accessible if the ID is known (or guessed — UUIDs have some entropy but aren't secret).

**Defense here:** Every query on a tenant-scoped table includes `AND tenantId = req.tenantContext.tenantId`. The tenantId always comes from middleware-validated context, never from request params or body. A guessed UUID from another tenant returns 404.

This is **IDOR (Insecure Direct Object Reference)** prevention — the object reference (UUID) alone is not sufficient to access the resource.

---

## Failure Case 5: Implicit admin behaviour hidden in business logic

**Attack:** A developer adds `if (user.role === 'Admin') { skipPermissionCheck() }`. The check is buried in service code, invisible to route-level audits, and breaks when roles are renamed.

**Naive system:** Role names checked directly in business logic. Adding a new admin role or renaming an existing one silently breaks the check.

**Defense here:** No role name checks exist anywhere in the codebase. All authorization is through explicit `requirePermission('resource:action')` middleware. The permission string is stable — role names can change, hierarchy can change, but the permission string is a code constant.

Audit question: "What can access this route?" → read the route file. The middleware chain is the complete security spec.

---

## Failure Case 6: Compromised refresh token database

**Attack:** The `refresh_tokens` table is leaked in a DB breach. An attacker uses the raw tokens to impersonate users.

**Naive system:** Stores raw refresh tokens in the DB. A breach immediately grants full account access.

**Defense here:** Only `SHA-256(rawToken)` is stored. The raw token exists only in the HTTP response. A DB breach yields only hashes — the attacker cannot reverse SHA-256 to get a usable token.

---

## Failure Case 7: Role hierarchy infinite loop

**Attack:** An admin creates a circular role hierarchy (Role A → Role B → Role A). The next time any user's permissions are resolved, the recursive CTE loops forever.

**Naive system:** No validation when setting `parentRoleId`. The DB query hangs or crashes.

**Defense here:** `roles.service.ts` runs `wouldCreateCycle(roleId, proposedParentId)` before any `parentRoleId` update. This CTE walks the ancestor chain and rejects the update if the role being modified appears in it. Cycles are impossible to create through the API.

---

## Failure Case 8: Privilege escalation via role assignment

**Attack:** Eve has `roles:write` permission. She assigns herself the Owner role to gain `tenants:write` and `users:delete`.

**Note:** This is intentional behaviour — `roles:write` means the user can manage role assignments. In a real system you would add a constraint that a user cannot assign a role with more permissions than they themselves have ("privilege escalation prevention"). This is left as a known limitation; the audit log provides a record of all role assignments for retrospective review.

---

## Residual risks / known limitations

| Risk | Status |
|------|--------|
| Privilege escalation via role assignment | Not prevented — audit log provides oversight |
| No email verification for invited users | Pre-registered accounts use temp passwords; real implementation needs magic links |
| Rate limiting only on `/auth/*` routes | Write endpoints are not rate-limited |
| No CORS configuration | Needs to be added before frontend integration |
| Refresh token family tracking | Compromised token detection (detecting reuse of already-rotated tokens) is not implemented |
