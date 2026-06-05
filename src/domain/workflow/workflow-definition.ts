import {
  InvalidTransitionError,
  InvalidWorkflowDefinitionError,
} from '@/domain/errors/domain-error';
import { Err, Ok, type Result } from '@/primitives/result';

export type StateName = string;
export type TransitionAction = string;

export type TransitionDefinition = {
  action: TransitionAction;
  from: StateName;
  to: StateName;
  requires?: string[] | undefined;
};

export type WorkflowDefinition = {
  type: string;
  initialState?: StateName | undefined;
  states: StateName[];
  transitions: TransitionDefinition[];
  closedStates?: StateName[] | undefined;
};

export type NormalizedWorkflowDefinition = {
  type: string;
  initialState: StateName;
  states: StateName[];
  transitions: TransitionDefinition[];
  closedStates: StateName[];
};

export function normalizeWorkflowDefinition(
  definition: WorkflowDefinition
): NormalizedWorkflowDefinition {
  validateWorkflowDefinition(definition);

  const outgoing = new Set(definition.transitions.map((transition) => transition.from));
  const terminalStates = definition.states.filter((state) => !outgoing.has(state));

  return {
    type: definition.type,
    initialState: definition.initialState ?? definition.states[0]!,
    states: [...definition.states],
    transitions: definition.transitions.map((transition) => ({
      ...transition,
      ...(transition.requires != null ? { requires: [...transition.requires] } : {}),
    })),
    closedStates:
      definition.closedStates != null && definition.closedStates.length > 0
        ? [...definition.closedStates]
        : terminalStates,
  };
}

export function safeNormalizeWorkflowDefinition(
  definition: WorkflowDefinition
): Result<NormalizedWorkflowDefinition, InvalidWorkflowDefinitionError> {
  try {
    return Ok(normalizeWorkflowDefinition(definition));
  } catch (error) {
    if (error instanceof InvalidWorkflowDefinitionError) {
      return Err(error);
    }
    throw error;
  }
}

export function validateWorkflowDefinition(definition: WorkflowDefinition): void {
  if (definition.type.trim().length === 0) {
    throw new InvalidWorkflowDefinitionError('Workflow type must not be empty');
  }

  if (definition.states.length === 0) {
    throw new InvalidWorkflowDefinitionError('Workflow must define at least one state', {
      type: definition.type,
    });
  }

  const states = new Set<string>();
  for (const state of definition.states) {
    if (state.trim().length === 0) {
      throw new InvalidWorkflowDefinitionError('Workflow state must not be empty', {
        type: definition.type,
      });
    }
    if (states.has(state)) {
      throw new InvalidWorkflowDefinitionError(`Duplicate workflow state "${state}"`, {
        type: definition.type,
        state,
      });
    }
    states.add(state);
  }

  const initialState = definition.initialState ?? definition.states[0]!;
  if (!states.has(initialState)) {
    throw new InvalidWorkflowDefinitionError(
      `Initial state "${initialState}" is not declared in workflow states`,
      { type: definition.type, initialState }
    );
  }

  const closedStates = definition.closedStates ?? [];
  for (const closedState of closedStates) {
    if (!states.has(closedState)) {
      throw new InvalidWorkflowDefinitionError(
        `Closed state "${closedState}" is not declared in workflow states`,
        { type: definition.type, closedState }
      );
    }
  }

  const transitionKeys = new Set<string>();
  for (const transition of definition.transitions) {
    if (transition.action.trim().length === 0) {
      throw new InvalidWorkflowDefinitionError('Transition action must not be empty', {
        type: definition.type,
      });
    }
    if (!states.has(transition.from)) {
      throw new InvalidWorkflowDefinitionError(
        `Transition "${transition.action}" starts from undeclared state "${transition.from}"`,
        { type: definition.type, transition }
      );
    }
    if (!states.has(transition.to)) {
      throw new InvalidWorkflowDefinitionError(
        `Transition "${transition.action}" ends at undeclared state "${transition.to}"`,
        { type: definition.type, transition }
      );
    }

    const key = `${transition.from}:${transition.action}`;
    if (transitionKeys.has(key)) {
      throw new InvalidWorkflowDefinitionError(
        `Duplicate transition "${transition.action}" from "${transition.from}"`,
        { type: definition.type, transition }
      );
    }
    transitionKeys.add(key);

    const requiredFields = transition.requires ?? [];
    const seenRequiredFields = new Set<string>();
    for (const requiredField of requiredFields) {
      if (requiredField.trim().length === 0) {
        throw new InvalidWorkflowDefinitionError(
          `Transition "${transition.action}" has an empty required field`,
          { type: definition.type, transition }
        );
      }
      if (seenRequiredFields.has(requiredField)) {
        throw new InvalidWorkflowDefinitionError(
          `Transition "${transition.action}" repeats required field "${requiredField}"`,
          { type: definition.type, transition, requiredField }
        );
      }
      seenRequiredFields.add(requiredField);
    }
  }
}

export function findTransition(
  workflow: NormalizedWorkflowDefinition,
  from: StateName,
  action: TransitionAction
): TransitionDefinition {
  const transition = workflow.transitions.find(
    (candidate) => candidate.from === from && candidate.action === action
  );

  if (transition == null) {
    throw new InvalidTransitionError(
      `Action "${action}" is not valid from state "${from}" for type "${workflow.type}"`,
      { type: workflow.type, from, action }
    );
  }

  return transition;
}

export function isClosedState(workflow: NormalizedWorkflowDefinition, state: StateName): boolean {
  return workflow.closedStates.includes(state);
}
