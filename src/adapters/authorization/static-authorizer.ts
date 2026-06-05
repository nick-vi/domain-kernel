import type { Actor, AuthorizationDecision, Permission, Role } from '@/domain/auth/auth';
import type { Authorizer } from '@/ports/authorizer';

export type RolePermissionMap = Record<string, readonly Permission[]>;

export const ALL_PERMISSIONS: readonly Permission[] = [
  'work:create',
  'work:read',
  'work:list',
  'work:query',
  'work:update',
  'work:transition',
  'work:assign',
  'decision:add',
  'comment:add',
  'history:read',
  'event:query',
  'report:read',
  'resource:create',
  'resource:read',
  'resource:list',
  'resource:reserve',
  'resource:release',
  'integration:create',
  'integration:update',
  'integration:read',
  'integration:list',
  'workflow:register',
  'workflow:list',
  'package:register',
  'package:list',
  'package:inspect',
];

export const DEFAULT_ROLE_PERMISSIONS: RolePermissionMap = {
  admin: ALL_PERMISSIONS,
  operator: [
    'work:create',
    'work:read',
    'work:list',
    'work:query',
    'work:update',
    'work:transition',
    'work:assign',
    'decision:add',
    'comment:add',
    'history:read',
    'event:query',
    'report:read',
    'resource:read',
    'resource:list',
    'resource:reserve',
    'resource:release',
    'integration:create',
    'integration:update',
    'integration:read',
    'integration:list',
    'workflow:list',
    'package:list',
    'package:inspect',
  ],
  viewer: [
    'work:read',
    'work:list',
    'work:query',
    'history:read',
    'event:query',
    'report:read',
    'resource:read',
    'resource:list',
    'integration:read',
    'integration:list',
    'workflow:list',
    'package:list',
    'package:inspect',
  ],
};

export class StaticAuthorizer implements Authorizer {
  constructor(private readonly rolePermissions: RolePermissionMap = DEFAULT_ROLE_PERMISSIONS) {}

  authorize(actor: Actor, permission: Permission): AuthorizationDecision {
    for (const role of actor.roles) {
      if (this.permissionsFor(role).has(permission)) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      code: 'permission_denied',
      reason: `Actor "${actor.id}" is missing permission "${permission}"`,
    };
  }

  private permissionsFor(role: Role): Set<Permission> {
    return new Set(this.rolePermissions[role] ?? []);
  }
}
