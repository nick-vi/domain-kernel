import type { Actor, AuthorizationDecision, Permission } from '@/domain/auth/auth';

export interface Authorizer {
  authorize(actor: Actor, permission: Permission): AuthorizationDecision;
}
