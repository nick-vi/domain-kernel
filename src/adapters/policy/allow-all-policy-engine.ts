import type { PolicyContext, PolicyDecision } from '@/domain/policy/policy';
import type { PolicyEngine } from '@/ports/policy-engine';

export class AllowAllPolicyEngine implements PolicyEngine {
  async evaluate(_context: PolicyContext): Promise<PolicyDecision> {
    return { allowed: true };
  }
}
