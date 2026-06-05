import type { JsonObject, JsonPrimitive, JsonValue } from './json-value';

export const ProcessStatus = Object.freeze({
  Running: 'running',
  Waiting: 'waiting',
  Completed: 'completed',
  Failed: 'failed',
  Compensating: 'compensating',
  Compensated: 'compensated',
  Cancelled: 'cancelled',
} as const);

export type ProcessStatus = (typeof ProcessStatus)[keyof typeof ProcessStatus];

export const ProcessStepStatus = Object.freeze({
  Pending: 'pending',
  Running: 'running',
  Waiting: 'waiting',
  Completed: 'completed',
  Failed: 'failed',
  Compensated: 'compensated',
  Skipped: 'skipped',
} as const);

export type ProcessStepStatus = (typeof ProcessStepStatus)[keyof typeof ProcessStepStatus];

export const ProcessTimeoutStatus = Object.freeze({
  Scheduled: 'scheduled',
  Fired: 'fired',
  Cancelled: 'cancelled',
} as const);

export type ProcessTimeoutStatus =
  (typeof ProcessTimeoutStatus)[keyof typeof ProcessTimeoutStatus];

export type ProcessJsonPrimitive = JsonPrimitive;
export type ProcessJsonValue = JsonValue;
export type ProcessJsonObject = JsonObject;

export type ProcessStep = {
  name: string;
  status: ProcessStepStatus;
  attempts: number;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  failedAt?: string | undefined;
  error?: string | undefined;
  compensation?: string | undefined;
};

export type ProcessTimeout = {
  id: string;
  name: string;
  status: ProcessTimeoutStatus;
  dueAt: string;
  createdAt: string;
  firedAt?: string | undefined;
  cancelledAt?: string | undefined;
};

export type ProcessInstance<TState extends ProcessJsonObject = ProcessJsonObject> = {
  id: string;
  type: string;
  status: ProcessStatus;
  state: TState;
  steps: ProcessStep[];
  timeouts: ProcessTimeout[];
  startedAt: string;
  updatedAt: string;
  waitingFor?: string | undefined;
  completedAt?: string | undefined;
  failedAt?: string | undefined;
  cancelledAt?: string | undefined;
  compensatedAt?: string | undefined;
  error?: string | undefined;
};

export class ProcessManagerError extends Error {
  override readonly name = 'ProcessManagerError';
}

export function createProcess<TState extends ProcessJsonObject>(input: {
  id: string;
  type: string;
  state: TState;
  now: string;
}): ProcessInstance<TState> {
  return {
    id: input.id,
    type: input.type,
    status: ProcessStatus.Running,
    state: structuredClone(input.state),
    steps: [],
    timeouts: [],
    startedAt: input.now,
    updatedAt: input.now,
  };
}

export function updateProcessState<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { state: TState; now: string }
): ProcessInstance<TState> {
  assertProcessOpen(process);
  return {
    ...process,
    state: structuredClone(input.state),
    updatedAt: input.now,
  };
}

export function startProcessStep<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { name: string; now: string }
): ProcessInstance<TState> {
  assertProcessOpen(process);
  const existing = process.steps.find((step) => step.name === input.name);
  const nextStep: ProcessStep = {
    name: input.name,
    status: ProcessStepStatus.Running,
    attempts: (existing?.attempts ?? 0) + 1,
    startedAt: input.now,
    ...(existing?.compensation != null ? { compensation: existing.compensation } : {}),
  };

  return replaceStep(process, nextStep, input.now, ProcessStatus.Running);
}

export function waitForProcess<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { signal: string; now: string }
): ProcessInstance<TState> {
  assertProcessOpen(process);
  return {
    ...process,
    status: ProcessStatus.Waiting,
    waitingFor: input.signal,
    updatedAt: input.now,
  };
}

export function resumeProcess<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { now: string }
): ProcessInstance<TState> {
  if (process.status !== ProcessStatus.Waiting) {
    throw new ProcessManagerError(`Process "${process.id}" is not waiting`);
  }

  const { waitingFor: _waitingFor, ...rest } = process;
  return {
    ...rest,
    status: ProcessStatus.Running,
    updatedAt: input.now,
  };
}

export function completeProcessStep<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { name: string; now: string }
): ProcessInstance<TState> {
  assertProcessOpen(process);
  const step = requireStep(process, input.name);
  return replaceStep(
    process,
    {
      ...step,
      status: ProcessStepStatus.Completed,
      completedAt: input.now,
    },
    input.now,
    ProcessStatus.Running
  );
}

export function failProcessStep<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { name: string; error: string; now: string }
): ProcessInstance<TState> {
  assertProcessOpen(process);
  const step = requireStep(process, input.name);
  return replaceStep(
    process,
    {
      ...step,
      status: ProcessStepStatus.Failed,
      failedAt: input.now,
      error: input.error,
    },
    input.now,
    ProcessStatus.Failed,
    { failedAt: input.now, error: input.error }
  );
}

export function scheduleProcessTimeout<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { id: string; name: string; dueAt: string; now: string }
): ProcessInstance<TState> {
  assertProcessOpen(process);
  if (process.timeouts.some((timeout) => timeout.id === input.id)) {
    throw new ProcessManagerError(`Process timeout "${input.id}" already exists`);
  }

  return {
    ...process,
    timeouts: [
      ...process.timeouts,
      {
        id: input.id,
        name: input.name,
        status: ProcessTimeoutStatus.Scheduled,
        dueAt: input.dueAt,
        createdAt: input.now,
      },
    ],
    updatedAt: input.now,
  };
}

export function fireProcessTimeout<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { id: string; now: string }
): ProcessInstance<TState> {
  assertProcessOpen(process);
  return replaceTimeout(process, input.id, ProcessTimeoutStatus.Fired, input.now);
}

export function cancelProcessTimeout<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { id: string; now: string }
): ProcessInstance<TState> {
  assertProcessOpen(process);
  return replaceTimeout(process, input.id, ProcessTimeoutStatus.Cancelled, input.now);
}

export function completeProcess<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { now: string }
): ProcessInstance<TState> {
  assertProcessOpen(process);
  const { waitingFor: _waitingFor, error: _error, failedAt: _failedAt, ...rest } = process;
  return {
    ...rest,
    status: ProcessStatus.Completed,
    completedAt: input.now,
    updatedAt: input.now,
  };
}

export function failProcess<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { error: string; now: string }
): ProcessInstance<TState> {
  assertProcessOpen(process);
  return {
    ...process,
    status: ProcessStatus.Failed,
    failedAt: input.now,
    error: input.error,
    updatedAt: input.now,
  };
}

export function startCompensation<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { now: string }
): ProcessInstance<TState> {
  if (process.status !== ProcessStatus.Failed) {
    throw new ProcessManagerError(`Process "${process.id}" must be failed before compensation`);
  }

  return {
    ...process,
    status: ProcessStatus.Compensating,
    updatedAt: input.now,
  };
}

export function completeCompensation<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { now: string }
): ProcessInstance<TState> {
  if (process.status !== ProcessStatus.Compensating) {
    throw new ProcessManagerError(`Process "${process.id}" is not compensating`);
  }

  return {
    ...process,
    status: ProcessStatus.Compensated,
    compensatedAt: input.now,
    updatedAt: input.now,
  };
}

export function cancelProcess<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  input: { now: string }
): ProcessInstance<TState> {
  assertProcessOpen(process);
  const { waitingFor: _waitingFor, ...rest } = process;
  return {
    ...rest,
    status: ProcessStatus.Cancelled,
    cancelledAt: input.now,
    updatedAt: input.now,
  };
}

function replaceStep<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  step: ProcessStep,
  now: string,
  status: ProcessStatus,
  extra: Partial<ProcessInstance<TState>> = {}
): ProcessInstance<TState> {
  const steps = process.steps.some((candidate) => candidate.name === step.name)
    ? process.steps.map((candidate) => (candidate.name === step.name ? step : candidate))
    : [...process.steps, step];

  return {
    ...process,
    ...extra,
    status,
    steps,
    updatedAt: now,
  };
}

function replaceTimeout<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  id: string,
  status: ProcessTimeoutStatus,
  now: string
): ProcessInstance<TState> {
  const timeout = process.timeouts.find((candidate) => candidate.id === id);
  if (timeout == null) {
    throw new ProcessManagerError(`Process timeout "${id}" does not exist`);
  }

  return {
    ...process,
    timeouts: process.timeouts.map((candidate) =>
      candidate.id === id
        ? {
            ...candidate,
            status,
            ...(status === ProcessTimeoutStatus.Fired ? { firedAt: now } : {}),
            ...(status === ProcessTimeoutStatus.Cancelled ? { cancelledAt: now } : {}),
          }
        : candidate
    ),
    updatedAt: now,
  };
}

function requireStep<TState extends ProcessJsonObject>(
  process: ProcessInstance<TState>,
  name: string
): ProcessStep {
  const step = process.steps.find((candidate) => candidate.name === name);
  if (step == null) {
    throw new ProcessManagerError(`Process step "${name}" does not exist`);
  }
  return step;
}

function assertProcessOpen(process: ProcessInstance): void {
  if (process.status !== ProcessStatus.Running && process.status !== ProcessStatus.Waiting) {
    throw new ProcessManagerError(`Process "${process.id}" is ${process.status}`);
  }
}
