import type { OutboxListQuery, OutboxRepository } from '@/ports/outbox-repository';
import type { Clock } from '@/ports/clock';
import type { SleepFunction } from '@/primitives/timing';
import {
  markOutboxPublishing,
  outboxMessageIsDue,
  type OutboxMessage,
} from '@/primitives/outbox';
import { optionalPositiveIntegerOption } from '@/primitives/runtime-options';
import { compareStrings } from '@/primitives/string';
import { OutboxMessageSchema } from '@/validation/schemas';
import {
  filenameForId,
  listFilesRecursive,
  pathExists,
  readJson,
  safeJoin,
  type FileTempNames,
  withFileLock,
  writeJsonAtomic,
} from './fs-utils';

export class FsOutboxRepository implements OutboxRepository {
  private readonly root: string;

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly sleep: SleepFunction,
    private readonly tempNames: FileTempNames
  ) {
    this.root = safeJoin(dataDir, 'outbox');
  }

  async save(message: OutboxMessage): Promise<void> {
    const path = this.pathFor(message.id);
    await withFileLock(path, async () => {
      await writeJsonAtomic(path, message, this.tempNames);
    }, { clock: this.clock, sleep: this.sleep });
  }

  async getById(id: string): Promise<OutboxMessage | null> {
    const path = this.pathFor(id);
    if (!(await pathExists(path))) return null;
    return readJson<OutboxMessage>(path, OutboxMessageSchema);
  }

  async list(query: OutboxListQuery = {}): Promise<OutboxMessage[]> {
    const files = await listFilesRecursive(this.root);
    const messages = await Promise.all(
      files.map((file) => readJson<OutboxMessage>(file, OutboxMessageSchema))
    );
    return messages
      .filter((message) => query.status == null || message.status === query.status)
      .sort(
        (left, right) =>
          compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id)
      );
  }

  async claimDue(input: { now: string; limit?: number | undefined }): Promise<OutboxMessage[]> {
    const limit = optionalPositiveIntegerOption('limit', input.limit);
    const candidates = (await this.list()).filter((message) =>
      outboxMessageIsDue(message, input.now)
    );
    const due = candidates.slice(0, limit ?? candidates.length);
    const claimed: OutboxMessage[] = [];

    for (const message of due) {
      const path = this.pathFor(message.id);
      const next = await withFileLock(path, async () => {
        const current = await this.getById(message.id);
        if (current == null || !outboxMessageIsDue(current, input.now)) return null;
        const publishing = markOutboxPublishing(current, input.now);
        await writeJsonAtomic(path, publishing, this.tempNames);
        return publishing;
      }, { clock: this.clock, sleep: this.sleep });
      if (next != null) claimed.push(next);
    }

    return claimed;
  }

  private pathFor(id: string): string {
    return safeJoin(this.root, filenameForId(id));
  }
}
