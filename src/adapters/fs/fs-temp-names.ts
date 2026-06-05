import { randomUUID } from 'node:crypto';
import type { FileTempNames } from './fs-utils';

export class RandomFileTempNames implements FileTempNames {
  nextTempName(): string {
    return randomUUID();
  }
}
