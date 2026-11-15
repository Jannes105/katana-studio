import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADDR, storedPatchAddress, toLinear } from '../shared/katana.js';
import { compareRelative, diffSnapshots, markReported, snapshotFromBlocks } from './snapshot.js';

const block = (address, data) => ({ address, linearAddress: toLinear(address), data });

test('snapshot maps block address to bytes; a later block wins', () => {
  const snap = snapshotFromBlocks([block([0x20, 0, 0x06, 0], [1, 2]), block([0x20, 0, 0x06, 0], [3, 4])]);
  assert.equal(snap.size, 1);
  assert.deepEqual(snap.get(toLinear([0x20, 0, 0x06, 0])), [3, 4]);
});

test('diff lists changed bytes with their own address', () => {
  const a = snapshotFromBlocks([block([0x20, 0, 0x06, 0], [50, 60, 70]), block([0x20, 0, 0x58, 0], [1, 30, 40])]);
  const b = snapshotFromBlocks([block([0x20, 0, 0x06, 0], [55, 60, 70]), block([0x20, 0, 0x58, 0], [1, 30, 45])]);
  const diff = diffSnapshots(a, b);
  assert.deepEqual(diff.changes.map((c) => [c.address, c.oldValue, c.newValue]), [
    [[0x20, 0, 0x06, 0], 50, 55],
    [[0x20, 0, 0x58, 2], 40, 45],
  ]);
  assert.deepEqual(diff.onlyInA, []);
  assert.deepEqual(diff.onlyInB, []);
});

test('byte addresses inside a block carry at 7 bits', () => {
  const a = snapshotFromBlocks([block([0x20, 0, 0x10, 0x7e], [0, 0, 0, 0])]);
  const b = snapshotFromBlocks([block([0x20, 0, 0x10, 0x7e], [0, 0, 9, 0])]);
  assert.deepEqual(diffSnapshots(a, b).changes[0].address, [0x20, 0, 0x11, 0x00]);
});

test('identical snapshots give no changes; missing blocks and length changes are reported', () => {
  const a = snapshotFromBlocks([block([0x20, 0, 0, 0], [1, 2]), block([0x20, 0, 1, 0], [1])]);
  assert.deepEqual(diffSnapshots(a, a).changes, []);
  const b = snapshotFromBlocks([block([0x20, 0, 0, 0], [1, 2, 3]), block([0x20, 0, 2, 0], [1])]);
  const diff = diffSnapshots(a, b);
  assert.deepEqual(diff.changes, []);
  assert.deepEqual(diff.onlyInA, [[0x20, 0, 1, 0]]);
  assert.deepEqual(diff.onlyInB, [[0x20, 0, 2, 0]]);
  assert.deepEqual(diff.lengthChanged, [{ address: [0x20, 0, 0, 0], oldLength: 2, newLength: 3 }]);
});

test('markReported: a change counts as reported if the last unsolicited DT1 carried the new value', () => {
  const a = snapshotFromBlocks([block([0x20, 0, 0x06, 0], [50, 60])]);
  const b = snapshotFromBlocks([block([0x20, 0, 0x06, 0], [55, 65])]);
  const { changes } = diffSnapshots(a, b);
  const gain = toLinear([0x20, 0, 0x06, 0]);
  assert.deepEqual(markReported(changes, []).map((c) => c.reported), [false, false]);
  // gain reported twice (52, then 55), volume never
  assert.deepEqual(
    markReported(changes, [{ linearAddress: gain, data: [52] }, { linearAddress: gain, data: [55] }]).map((c) => c.reported),
    [true, false]);
  // a block message covering both bytes, volume with a stale value
  assert.deepEqual(
    markReported(changes, [{ linearAddress: gain, data: [55, 64] }]).map((c) => c.reported),
    [true, false]);
});

test('compareRelative: current patch against a stored slot by offset', () => {
  const slot = storedPatchAddress(8);
  const at = (base, offset, data) => ({ linearAddress: toLinear(base) + offset, data });
  const current = [at(ADDR.currentPatch, 0, [65, 66]), at(ADDR.currentPatch, 0x58 * 128, [1, 30, 40])];
  const same = [at(slot, 0x58 * 128, [1, 30, 40]), at(slot, 0, [65, 66])]; // order does not matter
  const equal = compareRelative(current, ADDR.currentPatch, same, slot);
  assert.equal(equal.blocksCompared, 2);
  assert.equal(equal.equalBlocks, 2);
  assert.deepEqual(equal.differing, []);

  const other = [at(slot, 0, [65, 66]), at(slot, 0x58 * 128, [1, 31, 40]), at(slot, 0x5a * 128, [0])];
  const diff = compareRelative(current, ADDR.currentPatch, other, slot);
  assert.equal(diff.equalBlocks, 1);
  assert.deepEqual(diff.differing, [{ offset: [0, 0, 0x58, 0], a: [1, 30, 40], b: [1, 31, 40] }]);
  assert.deepEqual(diff.missingInA, [[0, 0, 0x5a, 0]]);
  assert.deepEqual(diff.missingInB, []);
});
