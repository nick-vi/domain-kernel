import { afterEach, describe, expect, it } from 'vitest';
import { resolveDataDir } from '@/cli/context';

describe('CLI context', () => {
  const originalDomainKernelDataDir = process.env.DOMAIN_KERNEL_DATA_DIR;
  const originalDataDir = process.env.DATA_DIR;

  afterEach(() => {
    restoreEnv('DOMAIN_KERNEL_DATA_DIR', originalDomainKernelDataDir);
    restoreEnv('DATA_DIR', originalDataDir);
  });

  it('resolves data directory by explicit option, namespaced env, then default', () => {
    process.env.DOMAIN_KERNEL_DATA_DIR = '/tmp/domain-kernel';

    expect(resolveDataDir('/tmp/explicit')).toBe('/tmp/explicit');
    expect(resolveDataDir()).toBe('/tmp/domain-kernel');

    delete process.env.DOMAIN_KERNEL_DATA_DIR;
    expect(resolveDataDir()).toMatch(/\.data\/domain-kernel$/);
  });

  it('ignores generic DATA_DIR to avoid implicit environment fallbacks', () => {
    process.env.DATA_DIR = '/tmp/generic-data';

    expect(resolveDataDir()).toMatch(/\.data\/domain-kernel$/);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
