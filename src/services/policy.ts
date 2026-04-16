/**
 * RBAC Policy — the complete, human-readable source of truth for access control.
 *
 * Two things live here:
 *   1. HIERARCHY — which roles inherit from which
 *   2. policy    — what each role is allowed to do, expressed as booleans or
 *                  ownership functions: ({ isOwner }) => isOwner
 *
 * Role assignments (who has what role in which tenant) still live in the DB.
 * Everything else is code.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type Role = 'Owner' | 'Admin' | 'Editor' | 'Viewer';

export type Asset  = 'posts' | 'users' | 'roles' | 'tenants' | 'audit';
export type Action = 'read' | 'write' | 'delete';

// A permission is either a flat boolean or a function that checks context.
// The context currently only carries isOwner, but can be extended.
type Permission = boolean | ((ctx: { isOwner: boolean }) => boolean);

// ── Role hierarchy ────────────────────────────────────────────────────────────
//
// Each entry lists the role itself followed by every role it inherits from.
// Owner inherits everything — Viewer inherits nothing.

export const HIERARCHY: Record<Role, Role[]> = {
  Viewer:  ['Viewer'],
  Editor:  ['Editor', 'Viewer'],
  Admin:   ['Admin',  'Editor', 'Viewer'],
  Owner:   ['Owner',  'Admin',  'Editor', 'Viewer'],
};

/**
 * Expand a directly-assigned role into the full list of roles it holds.
 * @example resolveRoles('Editor') → ['Editor', 'Viewer']
 */
export function resolveRoles(assignedRole: string): Role[] {
  return HIERARCHY[assignedRole as Role] ?? [assignedRole as Role];
}

// ── Policy matrix ─────────────────────────────────────────────────────────────
//
// Each role only declares its *own* permissions.
// Inherited permissions flow in automatically via resolveRoles().
//
//   true                        → always allowed
//   false / missing             → never allowed
//   ({ isOwner }) => isOwner    → allowed only on own resources

const policy: Record<Role, Partial<Record<Asset, Partial<Record<Action, Permission>>>>> = {
  Viewer: {
    posts: {
      read:   true,                        // can read any post
      write:  ({ isOwner }) => isOwner,    // can only edit own posts
      delete: ({ isOwner }) => isOwner,    // can only delete own posts
    },
    tenants: { read: true },
  },

  Editor: {
    posts: {
      write:  true,   // can edit any post
      delete: true,   // can delete any post
    },
  },

  Admin: {
    users:  { read: true, write: true },
    roles:  { read: true, write: true },
    audit:  { read: true },
  },

  Owner: {
    users:   { delete: true },
    roles:   { delete: true },
    tenants: { write: true },
  },
};

// ── Engine ────────────────────────────────────────────────────────────────────

/**
 * Check whether a resolved role list grants a specific action on an asset.
 *
 * @param roles   All roles the user holds (use resolveRoles to include inherited).
 * @param action  The action being attempted ('read', 'write', 'delete').
 * @param asset   The resource type ('posts', 'users', etc.).
 * @param isOwner True if the resource belongs to the requesting user.
 *                Pass true at middleware level (no resource yet);
 *                re-check with the real value in the controller.
 *
 * @example
 *   // Middleware — optimistic check (no resource available yet)
 *   can(roles, 'write', 'posts', true)
 *
 *   // Controller — real check after fetching the resource
 *   can(roles, 'write', 'posts', post.authorId === userId)
 */
export function can(
  roles: Role[],
  action: Action,
  asset: Asset,
  isOwner = false,
): boolean {
  for (const role of roles) {
    const permission = policy[role]?.[asset]?.[action];
    if (permission === undefined || permission === false) continue;
    if (permission === true) return true;
    if (permission({ isOwner })) return true;
  }
  return false;
}
