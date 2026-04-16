# Multi-Tenant RBAC API

A SaaS-style REST API demonstrating proper multi-tenancy, role-based access control, tenant isolation, and audit logging.

Built with **Node.js + Express + TypeScript + PostgreSQL + Prisma**.

---

## What this demonstrates

- **Multi-tenancy** — Users can belong to multiple organizations (tenants). Every resource is scoped to a tenant and can never leak across tenants.
- **RBAC with role hierarchy** — Roles can inherit permissions from parent roles. A recursive SQL CTE resolves the full permission set in a single query.
- **Ownership scopes** — Users can be restricted to acting only on their own resources (`scope=own`) rather than all resources in the tenant.
- **Explicit permission checks** — Every protected route uses `requirePermission('resource:action')` middleware. There is no implicit "admin bypasses checks" anywhere.
- **Audit logging** — All privileged actions are logged with actor, tenant, resource, and metadata.
- **IDOR prevention** — Every DB query includes `tenantId` from validated middleware context, never from user-supplied input.

---

## Demo credentials

Password for all users: **`password123`**

| User | Email | Role | Scope |
|---|---|---|---|
| Alice | alice@acme.com | Owner | all |
| Charlie | charlie@acme.com | Admin | all |
| Diana | diana@acme.com | Editor | all |
| Bob | bob@acme.com | Viewer | own |

Tenant slug: **acme** — Swagger UI: **http://localhost:3000/docs**

---

## Quick start

### Prerequisites
- Node.js 20+
- PostgreSQL (local or hosted)

### Setup

```bash
# 1. Clone and install
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and set DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET

# 3. Create the database schema
npx prisma migrate dev --name init

# 4. Seed permission catalog
npm run db:seed

# 5. Start dev server
npm run dev
```

### Run tests

Unit tests (no DB required):
```bash
npm test -- tests/rbac.test.ts
```

Integration tests (requires a running PostgreSQL):
```bash
DATABASE_URL_TEST="postgresql://..." npm test
```

---

## API reference

All tenant-scoped endpoints require the `X-Tenant-ID: <uuid>` header in addition to a Bearer token.

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Login and receive tokens |
| POST | `/auth/refresh` | Rotate refresh token |

### Tenants

| Method | Path | Permission |
|--------|------|------------|
| POST | `/tenants` | — (anyone can create) |
| GET | `/tenants` | — (own memberships) |
| GET | `/tenants/:id` | `tenants:read` |
| PUT | `/tenants/:id` | `tenants:write` |
| POST | `/tenants/:id/invite` | `roles:write` |

### Users

| Method | Path | Permission |
|--------|------|------------|
| GET | `/tenants/:id/users` | `users:read` |
| GET | `/tenants/:id/users/:uid` | `users:read` |
| PUT | `/tenants/:id/users/:uid/role` | `roles:write` |
| DELETE | `/tenants/:id/users/:uid` | `users:delete` |

### Roles

| Method | Path | Permission |
|--------|------|------------|
| GET | `/tenants/:id/roles` | `roles:read` |
| POST | `/tenants/:id/roles` | `roles:write` |
| PUT | `/tenants/:id/roles/:rid` | `roles:write` |
| DELETE | `/tenants/:id/roles/:rid` | `roles:delete` |
| PUT | `/tenants/:id/roles/:rid/permissions` | `roles:write` |
| PUT | `/tenants/:id/roles/:rid/parent` | `roles:write` |
| GET | `/tenants/:id/roles/permissions` | `roles:read` |

### Posts (RBAC demo resource)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/posts` | `posts:read` |
| GET | `/posts/:id` | `posts:read` |
| POST | `/posts` | `posts:write` |
| PUT | `/posts/:id` | `posts:write` (scope-aware) |
| DELETE | `/posts/:id` | `posts:delete` (scope-aware) |

### Audit

| Method | Path | Permission |
|--------|------|------------|
| GET | `/tenants/:id/audit` | `audit:read` |

---

## Demo walkthrough

```bash
# 1. Register two users
curl -X POST localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@acme.com","password":"password123"}'

curl -X POST localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@acme.com","password":"password123"}'

# 2. Login as Alice
TOKEN=$(curl -s -X POST localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@acme.com","password":"password123"}' | jq -r .accessToken)

# 3. Create a tenant (Alice becomes Owner automatically)
TENANT=$(curl -s -X POST localhost:3000/tenants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Corp","slug":"acme"}' | jq -r .id)

# 4. List the auto-created roles (Owner > Admin > Editor > Viewer)
curl localhost:3000/tenants/$TENANT/roles \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: $TENANT" | jq '.[].name'

# 5. Invite Bob as Viewer
VIEWER_ID=$(curl -s localhost:3000/tenants/$TENANT/roles \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: $TENANT" | jq -r '.[] | select(.name=="Viewer") | .id')

curl -X POST localhost:3000/tenants/$TENANT/invite \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: $TENANT" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"bob@acme.com\",\"roleId\":\"$VIEWER_ID\"}"

# 6. Alice creates a post
BOB_TOKEN=$(curl -s -X POST localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@acme.com","password":"password123"}' | jq -r .accessToken)

POST_ID=$(curl -s -X POST localhost:3000/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: $TENANT" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","body":"World"}' | jq -r .id)

# 7. Bob (Viewer) can READ posts
curl localhost:3000/posts \
  -H "Authorization: Bearer $BOB_TOKEN" \
  -H "X-Tenant-ID: $TENANT"

# 8. Bob (Viewer) CANNOT delete — permission denied
curl -X DELETE localhost:3000/posts/$POST_ID \
  -H "Authorization: Bearer $BOB_TOKEN" \
  -H "X-Tenant-ID: $TENANT"
# → 403 Missing permission: posts:delete

# 9. Check audit log (Alice as Owner has audit:read)
curl "localhost:3000/tenants/$TENANT/audit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: $TENANT" | jq '.logs[].action'
```

---

## Project structure

```
src/
├── config/env.ts          # Zod-validated environment variables
├── prisma/client.ts        # PrismaClient singleton
├── types/                  # Shared TypeScript interfaces and error classes
├── middleware/
│   ├── authenticate.ts     # Verify JWT → req.user
│   ├── requireTenant.ts    # Validate X-Tenant-ID → req.tenantContext
│   ├── requirePermission.ts # Check permissions via RBAC service
│   └── auditLog.ts         # Append-only audit trail
├── services/
│   ├── rbac.service.ts     # Core: recursive CTE permission resolution
│   ├── auth.service.ts     # JWT + bcrypt auth
│   ├── tenants.service.ts  # Tenant CRUD + role seeding
│   ├── roles.service.ts    # Role CRUD + hierarchy + cycle detection
│   └── ...
├── controllers/            # Thin: validate → call service → respond
└── routes/                 # Express routers with explicit middleware chains
```

See [docs/architecture.md](docs/architecture.md) for design decisions and [docs/threat-model.md](docs/threat-model.md) for the failure analysis.
