import { RequestUser, TenantContext, PermissionScope } from './index';

// Augment the Express Request type so TypeScript knows about our custom properties.
// These are set by middleware before reaching route handlers.
declare global {
  namespace Express {
    interface Request {
      // Set by authenticate middleware
      user?: RequestUser;

      // Set by requireTenant middleware
      tenantContext?: TenantContext;

      // Resolved and cached by requirePermission middleware.
      // Caching on req avoids repeated DB calls within the same request.
      effectivePermissions?: Set<string>;

      // Set by requirePermissionOrOwn — tells the controller whether
      // to enforce ownership checks ('own') or allow any resource ('all').
      permissionScope?: PermissionScope;
    }
  }
}
