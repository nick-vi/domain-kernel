import type { PolicyContext, PolicyDecision } from '@/domain/policy/policy';
import type { PolicyEngine } from '@/ports/policy-engine';

export class CompositePolicyEngine implements PolicyEngine {
  constructor(private readonly engines: readonly PolicyEngine[]) {}

  async evaluate(context: PolicyContext): Promise<PolicyDecision> {
    for (const engine of this.engines) {
      const decision = await engine.evaluate(context);
      if (!decision.allowed) return decision;
    }

    return { allowed: true };
  }
}
