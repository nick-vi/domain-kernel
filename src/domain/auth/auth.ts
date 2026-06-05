export type Role = 'admin' | 'operator' | 'viewer' | string;

export type Permission =
  | 'work:create'
  | 'work:read'
  | 'work:list'
  | 'work:query'
  | 'work:update'
  | 'work:transition'
  | 'work:assign'
  | 'decision:add'
  | 'comment:add'
  | 'history:read'
  | 'event:query'
  | 'report:read'
  | 'resource:create'
  | 'resource:read'
  | 'resource:list'
  | 'resource:reserve'
  | 'resource:release'
  | 'integration:create'
  | 'integration:update'
  | 'integration:read'
  | 'integration:list'
  | 'workflow:register'
  | 'workflow:list'
  | 'package:register'
  | 'package:list'
  | 'package:inspect';

export type Actor = {
  id: string;
  roles: Role[];
  displayName?: string | undefined;
};

export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: string; code: string };

export function actorHasRole(actor: Actor, role: Role): boolean {
  return actor.roles.includes(role);
}
