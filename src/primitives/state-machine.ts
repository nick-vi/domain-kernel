import { Err, Ok, type Result } from './result';

export type StateTransitionGuard<TContext = unknown> = (input: {
  from: string;
  event: string;
  context: TContext;
}) => boolean;

export type StateTransitionEffect<TContext = unknown> = (input: {
  from: string;
  to: string;
  event: string;
  context: TContext;
}) => void;

export type StateTransition<TContext = unknown> = {
  from: string | readonly string[];
  event: string;
  to: string;
  guard?: StateTransitionGuard<TContext> | undefined;
  effect?: StateTransitionEffect<TContext> | undefined;
};

export type StateMachineDefinition<TContext = unknown> = {
  states: readonly string[];
  initial: string;
  final?: readonly string[] | undefined;
  transitions: readonly StateTransition<TContext>[];
};

export type StateTransitionResult = {
  from: string;
  to: string;
  event: string;
  changed: boolean;
  final: boolean;
};

export class StateMachineError extends Error {
  override readonly name = 'StateMachineError';

  constructor(
    readonly code: 'invalid_definition' | 'unknown_state' | 'transition_not_allowed' | 'guard_rejected',
    message: string
  ) {
    super(message);
  }
}

export class StateMachine<TContext = unknown> {
  private readonly states: Set<string>;
  private readonly finalStates: Set<string>;

  constructor(private readonly definition: StateMachineDefinition<TContext>) {
    this.states = new Set(definition.states);
    this.finalStates = new Set(definition.final ?? []);
    const validation = this.validateDefinition();
    if (!validation.ok) throw validation.error;
  }

  get initial(): string {
    return this.definition.initial;
  }

  isFinal(state: string): boolean {
    return this.finalStates.has(state);
  }

  canTransition(from: string, event: string, context: TContext): boolean {
    return this.findTransition(from, event, context).ok;
  }

  transition(from: string, event: string, context: TContext): Result<StateTransitionResult, StateMachineError> {
    if (!this.states.has(from)) {
      return Err(new StateMachineError('unknown_state', `Unknown state: ${from}`));
    }

    const transition = this.findTransition(from, event, context);
    if (!transition.ok) return transition.asErr<StateTransitionResult>();

    transition.value.effect?.({
      from,
      to: transition.value.to,
      event,
      context,
    });

    return Ok({
      from,
      to: transition.value.to,
      event,
      changed: from !== transition.value.to,
      final: this.isFinal(transition.value.to),
    });
  }

  private findTransition(
    from: string,
    event: string,
    context: TContext
  ): Result<StateTransition<TContext>, StateMachineError> {
    const matches = this.definition.transitions.filter(
      (transition) => transition.event === event && stateMatches(transition.from, from)
    );

    if (matches.length === 0) {
      return Err(
        new StateMachineError(
          'transition_not_allowed',
          `Transition "${event}" is not allowed from state "${from}"`
        )
      );
    }

    const accepted = matches.find((transition) => transition.guard?.({ from, event, context }) ?? true);
    if (accepted == null) {
      return Err(new StateMachineError('guard_rejected', `Transition "${event}" guard rejected`));
    }

    return Ok(accepted);
  }

  private validateDefinition(): Result<void, StateMachineError> {
    if (this.states.size === 0) {
      return Err(new StateMachineError('invalid_definition', 'State machine requires at least one state'));
    }
    if (!this.states.has(this.definition.initial)) {
      return Err(new StateMachineError('invalid_definition', 'Initial state must be declared'));
    }
    for (const final of this.finalStates) {
      if (!this.states.has(final)) {
        return Err(new StateMachineError('invalid_definition', `Final state "${final}" is not declared`));
      }
    }
    for (const transition of this.definition.transitions) {
      const fromStates = Array.isArray(transition.from) ? transition.from : [transition.from];
      for (const from of fromStates) {
        if (!this.states.has(from)) {
          return Err(new StateMachineError('invalid_definition', `Transition from state "${from}" is not declared`));
        }
      }
      if (!this.states.has(transition.to)) {
        return Err(new StateMachineError('invalid_definition', `Transition to state "${transition.to}" is not declared`));
      }
    }
    return Ok(undefined);
  }
}

export function createStateMachine<TContext = unknown>(
  definition: StateMachineDefinition<TContext>
): Result<StateMachine<TContext>, StateMachineError> {
  try {
    return Ok(new StateMachine(definition));
  } catch (error) {
    return Err(
      error instanceof StateMachineError
        ? error
        : new StateMachineError('invalid_definition', error instanceof Error ? error.message : String(error))
    );
  }
}

function stateMatches(candidate: string | readonly string[], state: string): boolean {
  return Array.isArray(candidate) ? candidate.includes(state) : candidate === state;
}
