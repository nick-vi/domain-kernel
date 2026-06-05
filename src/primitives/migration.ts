import { Err, Ok, type Result } from './result';
import { compareStrings } from './string';

export type Version = {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string | undefined;
  build?: string | undefined;
};

export type MigrationStep<TKind extends string = string> = {
  id: string;
  kind: TKind;
  fromVersion: string;
  toVersion: string;
  description?: string | undefined;
};

export class VersionError extends Error {
  override readonly name = 'VersionError';

  constructor(
    readonly code: 'invalid_version' | 'invalid_migration_path',
    message: string,
    readonly input?: unknown
  ) {
    super(message);
  }
}

export function parseVersion(input: string): Result<Version, VersionError> {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
      input
    );
  if (match == null) {
    return Err(new VersionError('invalid_version', `Invalid semantic version: ${input}`, input));
  }

  return Ok({
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] != null ? { prerelease: match[4] } : {}),
    ...(match[5] != null ? { build: match[5] } : {}),
  });
}

export function compareVersions(left: string, right: string): Result<-1 | 0 | 1, VersionError> {
  const parsedLeft = parseVersion(left);
  if (!parsedLeft.ok) return parsedLeft.asErr<-1 | 0 | 1>();
  const parsedRight = parseVersion(right);
  if (!parsedRight.ok) return parsedRight.asErr<-1 | 0 | 1>();

  const core = compareCore(parsedLeft.value, parsedRight.value);
  if (core !== 0) return Ok(core);

  return Ok(comparePrerelease(parsedLeft.value.prerelease, parsedRight.value.prerelease));
}

export function formatVersion(version: Version): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  const prerelease = version.prerelease != null ? `-${version.prerelease}` : '';
  const build = version.build != null ? `+${version.build}` : '';
  return `${core}${prerelease}${build}`;
}

export function planMigrations<TKind extends string>(
  steps: readonly MigrationStep<TKind>[],
  input: { fromVersion: string; toVersion: string }
): Result<MigrationStep<TKind>[], VersionError> {
  const ordered = [...steps].sort((left, right) =>
    compareVersions(left.fromVersion, right.fromVersion).unwrapOr(0)
  );
  const plan: MigrationStep<TKind>[] = [];
  const visited = new Set<string>();
  let current = input.fromVersion;

  while (current !== input.toVersion) {
    if (visited.has(current)) {
      return Err(
        new VersionError(
          'invalid_migration_path',
          `Migration path from ${input.fromVersion} to ${input.toVersion} contains a cycle`,
          input
        )
      );
    }
    visited.add(current);

    const next = ordered.find((step) => step.fromVersion === current);
    if (next == null) {
      return Err(
        new VersionError(
          'invalid_migration_path',
          `No migration step from ${current} to ${input.toVersion}`,
          input
        )
      );
    }
    plan.push(next);
    current = next.toVersion;
  }

  return Ok(plan);
}

function compareCore(left: Version, right: Version): -1 | 0 | 1 {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }
  return 0;
}

function comparePrerelease(left: string | undefined, right: string | undefined): -1 | 0 | 1 {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  const leftParts = left.split('.');
  const rightParts = right.split('.');
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index++) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart == null) return -1;
    if (rightPart == null) return 1;
    const compared = comparePrereleasePart(leftPart, rightPart);
    if (compared !== 0) return compared;
  }
  return 0;
}

function comparePrereleasePart(left: string, right: string): -1 | 0 | 1 {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (leftNumber < rightNumber) return -1;
    if (leftNumber > rightNumber) return 1;
    return 0;
  }
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  const compared = compareStrings(left, right);
  if (compared < 0) return -1;
  if (compared > 0) return 1;
  return 0;
}
