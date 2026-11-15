// Snapshots of a memory range (map block address -> bytes) and their comparison.
// Used for "which address does this amp knob change, and does the amp report it by itself".

import { fromLinear, toLinear } from '../shared/katana.js';

// blocks: [{ linearAddress, data }] as delivered by RequestManager. A later block with the same
// address replaces an earlier one. Returns Map<linear block address, number[]>.
export function snapshotFromBlocks(blocks) {
  const map = new Map();
  for (const block of blocks) map.set(block.linearAddress, Array.from(block.data));
  return map;
}

// Byte-wise comparison of two snapshots.
// changes: [{ linearAddress, address, oldValue, newValue }] for every byte that differs.
// onlyInA / onlyInB: block addresses (4 bytes) present in just one snapshot.
// lengthChanged: blocks whose length differs (their common part is still compared).
export function diffSnapshots(a, b) {
  const changes = [];
  const onlyInA = [];
  const onlyInB = [];
  const lengthChanged = [];
  const blockAddresses = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);

  for (const base of blockAddresses) {
    const oldData = a.get(base);
    const newData = b.get(base);
    if (!newData) { onlyInA.push(fromLinear(base)); continue; }
    if (!oldData) { onlyInB.push(fromLinear(base)); continue; }
    if (oldData.length !== newData.length) {
      lengthChanged.push({ address: fromLinear(base), oldLength: oldData.length, newLength: newData.length });
    }
    const common = Math.min(oldData.length, newData.length);
    for (let i = 0; i < common; i++) {
      if (oldData[i] !== newData[i]) {
        changes.push({
          linearAddress: base + i,
          address: fromLinear(base + i),
          oldValue: oldData[i],
          newValue: newData[i],
        });
      }
    }
  }
  return { changes, onlyInA, onlyInB, lengthChanged };
}

// Marks for every change whether the amp reported it by itself.
// unsolicited: [{ linearAddress, data }] of the unsolicited DT1 received between the snapshots,
// in order of arrival. reported = the last unsolicited DT1 covering that byte carried the new value.
export function markReported(changes, unsolicited) {
  return changes.map((change) => {
    let reported = false;
    for (const msg of unsolicited) {
      const i = change.linearAddress - msg.linearAddress;
      if (i >= 0 && i < msg.data.length) reported = msg.data[i] === change.newValue;
    }
    return { ...change, reported };
  });
}

// Compares two patch reads at different base addresses block by block (by offset from the base),
// e.g. the current patch against a stored slot.
// Returns { blocksCompared, equalBlocks, differing: [{ offset, a, b }], missingInA, missingInB }
// with offsets as 4 bytes in 7-bit notation.
export function compareRelative(blocksA, baseA, blocksB, baseB) {
  const relative = (blocks, base) => {
    const baseLinear = toLinear(base);
    const map = new Map();
    for (const block of blocks) map.set(block.linearAddress - baseLinear, Array.from(block.data));
    return map;
  };
  const a = relative(blocksA, baseA);
  const b = relative(blocksB, baseB);
  const result = { blocksCompared: 0, equalBlocks: 0, differing: [], missingInA: [], missingInB: [] };

  const offsets = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);
  for (const offset of offsets) {
    const da = a.get(offset);
    const db = b.get(offset);
    if (!da) { result.missingInA.push(fromLinear(offset)); continue; }
    if (!db) { result.missingInB.push(fromLinear(offset)); continue; }
    result.blocksCompared++;
    const equal = da.length === db.length && da.every((v, i) => v === db[i]);
    if (equal) result.equalBlocks++;
    else result.differing.push({ offset: fromLinear(offset), a: da, b: db });
  }
  return result;
}
