export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Multi-Tenant RBAC API',
    version: '1.0.0',
    description: 'SaaS-style API with tenant isolation, role hierarchy, permission enforcement, and audit logging.',
  },
  servers: [{ url: 'http://localhost:3000' }],

  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token from /auth/login',
      },
    },
    parameters: {
      TenantID: {
        name: 'X-Tenant-ID',
        in: 'header',
        required: true,
        schema: { type: 'string', format: 'uuid' },
        description: 'The tenant you are acting within. Must match an active membership.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
        example: { error: 'Missing permission: posts:delete' },
      },
      Tokens: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
        },
      },
      Tenant: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          slug: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Role: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string' },
          parentRoleId: { type: 'string', format: 'uuid', nullable: true },
          permissions: {
            type: 'array',
            items: {
              type: 'object',
              properties: { permission: { type: 'object', properties: { name: { type: 'string' } } } },
            },
          },
        },
      },
      Post: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          body: { type: 'string' },
          tenantId: { type: 'string', format: 'uuid' },
          author: {
            type: 'object',
            properties: { id: { type: 'string' }, email: { type: 'string' } },
          },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },

  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        responses: { '200': { description: 'API is running' } },
      },
    },

    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'User created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Tokens' } } } },
          '409': { description: 'Email already in use', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login and receive tokens',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Login successful', content: { 'application/json': { schema: { $ref: '#/components/schemas/Tokens' } } } },
          '401': { description: 'Invalid email or password', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate refresh token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'New token pair issued', content: { 'application/json': { schema: { $ref: '#/components/schemas/Tokens' } } } },
          '401': { description: 'Invalid or revoked refresh token' },
        },
      },
    },

    '/tenants': {
      post: {
        tags: ['Tenants'],
        summary: 'Create a tenant (caller becomes Owner)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'slug'],
                properties: {
                  name: { type: 'string' },
                  slug: { type: 'string', description: 'Lowercase letters, numbers, hyphens only' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Tenant created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Tenant' } } } },
          '409': { description: 'Slug already taken' },
        },
      },
      get: {
        tags: ['Tenants'],
        summary: 'List tenants the caller belongs to',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Array of tenants', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Tenant' } } } } },
        },
      },
    },

    '/tenants/{tenantId}': {
      get: {
        tags: ['Tenants'],
        summary: 'Get tenant details',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        responses: {
          '200': { description: 'Tenant', content: { 'application/json': { schema: { $ref: '#/components/schemas/Tenant' } } } },
          '403': { description: 'Not a member / missing permission' },
        },
      },
      put: {
        tags: ['Tenants'],
        summary: 'Update tenant name — requires tenants:write',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } },
        },
        responses: { '200': { description: 'Updated tenant' }, '403': { description: 'Forbidden' } },
      },
    },

    '/tenants/{tenantId}/invite': {
      post: {
        tags: ['Tenants'],
        summary: 'Invite a user to the tenant — requires roles:write',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'roleId'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  roleId: { type: 'string', format: 'uuid' },
                  scope: { type: 'string', enum: ['all', 'own'], default: 'all' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'User invited' }, '403': { description: 'Forbidden' } },
      },
    },

    '/tenants/{tenantId}/users': {
      get: {
        tags: ['Users'],
        summary: 'List users in tenant — requires users:read',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        responses: { '200': { description: 'Array of members' }, '403': { description: 'Forbidden' } },
      },
    },

    '/tenants/{tenantId}/users/{userId}/role': {
      put: {
        tags: ['Users'],
        summary: 'Change a user\'s role — requires roles:write',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['roleId'],
                properties: {
                  roleId: { type: 'string', format: 'uuid' },
                  scope: { type: 'string', enum: ['all', 'own'], default: 'all' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Role updated' }, '403': { description: 'Forbidden' } },
      },
    },

    '/tenants/{tenantId}/users/{userId}': {
      delete: {
        tags: ['Users'],
        summary: 'Remove user from tenant — requires users:delete',
        description: 'Soft-removes the user (sets membership.isActive = false). Takes effect immediately — the user\'s JWT is still valid but they are locked out of this tenant.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        responses: { '204': { description: 'User removed' }, '403': { description: 'Forbidden' } },
      },
    },

    '/tenants/{tenantId}/roles': {
      get: {
        tags: ['Roles'],
        summary: 'List roles in tenant — requires roles:read',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        responses: { '200': { description: 'Array of roles with permissions and parent', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Role' } } } } } },
      },
      post: {
        tags: ['Roles'],
        summary: 'Create a role — requires roles:write',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  parentRoleId: { type: 'string', format: 'uuid', description: 'Role this one inherits permissions from' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Role created' }, '409': { description: 'Name already taken in this tenant' } },
      },
    },

    '/tenants/{tenantId}/roles/permissions': {
      get: {
        tags: ['Roles'],
        summary: 'List all valid permission strings',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        responses: { '200': { description: 'Global permission catalog' } },
      },
    },

    '/tenants/{tenantId}/roles/{roleId}/permissions': {
      put: {
        tags: ['Roles'],
        summary: 'Replace permissions on a role — requires roles:write',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'roleId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['permissions'],
                properties: { permissions: { type: 'array', items: { type: 'string' }, example: ['posts:read', 'posts:write'] } },
              },
            },
          },
        },
        responses: { '200': { description: 'Permissions updated' } },
      },
    },

    '/tenants/{tenantId}/roles/{roleId}/parent': {
      put: {
        tags: ['Roles'],
        summary: 'Set parent role (hierarchy) — requires roles:write',
        description: 'Cycle detection runs before applying. Setting parentRoleId to null removes inheritance.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'roleId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['parentRoleId'],
                properties: { parentRoleId: { type: 'string', format: 'uuid', nullable: true } },
              },
            },
          },
        },
        responses: { '200': { description: 'Parent updated' }, '400': { description: 'Would create a cycle' } },
      },
    },

    '/posts': {
      get: {
        tags: ['Posts'],
        summary: 'List posts in tenant — requires posts:read',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/TenantID' }],
        responses: { '200': { description: 'Array of posts', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Post' } } } } }, '403': { description: 'Missing posts:read permission' } },
      },
      post: {
        tags: ['Posts'],
        summary: 'Create a post — requires posts:write',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/TenantID' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'body'],
                properties: { title: { type: 'string' }, body: { type: 'string' } },
              },
            },
          },
        },
        responses: { '201': { description: 'Post created' }, '403': { description: 'Missing posts:write permission' } },
      },
    },

    '/posts/{postId}': {
      get: {
        tags: ['Posts'],
        summary: 'Get a single post — requires posts:read',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        responses: { '200': { description: 'Post' }, '404': { description: 'Not found (or belongs to another tenant — IDOR prevention)' } },
      },
      put: {
        tags: ['Posts'],
        summary: 'Update a post — requires posts:write (scope-aware)',
        description: 'If the user\'s membership has scope=own, they can only edit their own posts.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { title: { type: 'string' }, body: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated post' }, '403': { description: 'Missing permission or scope=own on another user\'s post' } },
      },
      delete: {
        tags: ['Posts'],
        summary: 'Delete a post — requires posts:delete (scope-aware)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
        ],
        responses: { '204': { description: 'Deleted' }, '403': { description: 'Missing permission or scope=own on another user\'s post' } },
      },
    },

    '/tenants/{tenantId}/audit': {
      get: {
        tags: ['Audit'],
        summary: 'View audit log — requires audit:read',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } },
          { $ref: '#/components/parameters/TenantID' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
        ],
        responses: {
          '200': {
            description: 'Paginated audit log',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    logs: { type: 'array', items: { type: 'object' } },
                    pagination: { type: 'object', properties: { page: { type: 'integer' }, total: { type: 'integer' }, pages: { type: 'integer' } } },
                  },
                },
              },
            },
          },
          '403': { description: 'Missing audit:read permission' },
        },
      },
    },
  },
};
