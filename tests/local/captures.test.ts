/// <reference types="node" />
// Checks against the real captures in captures/ (private, git-ignored). Runs only where that folder exists,
// i.e. on the owner's PC, never in CI. CI runs the same checks on the sanitized excerpts in tests/fixtures/.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { parseCapture } from '../../src/mock/capture';
import {
  expectCompleteRangeReplies,
  expectQueueCompletes,
  expectValidMessages,
} from '../helpers/capture-checks';

const DIR = join(__dirname, '..', '..', 'captures');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
const load = (file: string) => parseCapture(readFileSync(join(DIR, file), 'utf8'));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe.skipIf(files.length === 0)('real captures (local only)', () => {
  it.each(files)('%s: every incoming message parses with a valid checksum', (file) => {
    expectValidMessages(load(file));
  });

  it.each(files)('%s: each range request is answered with exactly the blocks of the block table', (file) => {
    expectCompleteRangeReplies(load(file), file);
  });

  it.each(files)('%s: the queue completes each recorded range request', async (file) => {
    await expectQueueCompletes(load(file));
  });
});
