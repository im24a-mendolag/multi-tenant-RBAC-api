// Shared interfaces used across services and middleware.

// Attached to req.user by the authenticate middleware after JWT verification.
export interface RequestUser {
  userId: string;
  email: string;
}

// Attached to req.tenantContext by the requireTenant middleware.
// tenantId is validated against DB membership — never trust user input directly.
export interface TenantContext {
  tenantId: string;
}

// Token payloads
export interface AccessTokenPayload {
  sub: string;   // userId
  email: string;
}

export interface RefreshTokenPayload {
  sub: string;   // userId
  jti: string;   // unique token ID
}

