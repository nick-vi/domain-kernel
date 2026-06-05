import { resolve } from 'node:path';
import { ValidationError } from '@/domain/errors/domain-error';
import type { Role } from '@/domain/auth/auth';

export type ConfigSource = 'option' | 'env' | 'default';

export type ResolvedConfigValue<T> = {
  value: T;
  source: ConfigSource;
};

export type KernelConfigOptions = {
  env: Record<string, string | undefined>;
  dataDir?: string | undefined;
  actor?: string | undefined;
  logs?: string | undefined;
  trace?: boolean | undefined;
};

export type KernelConfig = {
  dataDir: ResolvedConfigValue<string>;
  actorId: ResolvedConfigValue<string>;
  actorRoles: ResolvedConfigValue<Role[]>;
  logs: ResolvedConfigValue<'none' | 'console' | 'json'>;
  trace: ResolvedConfigValue<boolean>;
};

const DEFAULT_DATA_DIR = '.data/domain-kernel';
const DEFAULT_ACTOR_ID = 'local-admin';
const DEFAULT_LOGS = 'none';

export function resolveKernelConfig(options: KernelConfigOptions): KernelConfig {
  const env = options.env;
  const dataDir = resolveString({
    option: options.dataDir,
    env: env.DOMAIN_KERNEL_DATA_DIR,
    defaultValue: DEFAULT_DATA_DIR,
  });
  const actorId = resolveString({
    option: options.actor,
    env: env.DOMAIN_KERNEL_ACTOR,
    defaultValue: DEFAULT_ACTOR_ID,
  });

  return {
    dataDir: {
      ...dataDir,
      value: resolve(dataDir.value),
    },
    actorId,
    actorRoles: resolveActorRoles(actorId.value, env.DOMAIN_KERNEL_ACTOR_ROLES),
    logs: resolveLogs(options.logs),
    trace: {
      value: options.trace === true,
      source: options.trace === true ? 'option' : 'default',
    },
  };
}

function resolveString(input: {
  option?: string | undefined;
  env?: string | undefined;
  defaultValue: string;
}): ResolvedConfigValue<string> {
  if (input.option != null) return { value: input.option, source: 'option' };
  if (input.env != null) return { value: input.env, source: 'env' };
  return { value: input.defaultValue, source: 'default' };
}

function resolveLogs(value: string | undefined): ResolvedConfigValue<'none' | 'console' | 'json'> {
  const logs = value ?? DEFAULT_LOGS;
  if (logs !== 'none' && logs !== 'console' && logs !== 'json') {
    throw new ValidationError('Invalid log mode', {
      logs,
      allowed: ['none', 'console', 'json'],
    });
  }

  return {
    value: logs,
    source: value == null ? 'default' : 'option',
  };
}

function resolveActorRoles(
  actorId: string,
  rolesFromEnv: string | undefined
): ResolvedConfigValue<Role[]> {
  const roles = rolesFromEnv
    ?.split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0) as Role[] | undefined;

  if (roles != null && roles.length > 0) {
    return { value: roles, source: 'env' };
  }

  return { value: inferLocalRoles(actorId), source: 'default' };
}

function inferLocalRoles(actorId: string): Role[] {
  if (actorId === 'local-admin' || actorId === 'admin') return ['admin'];
  if (actorId === 'operator') return ['operator'];
  if (actorId === 'viewer') return ['viewer'];
  return ['viewer'];
}
