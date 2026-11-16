// Address math for the Katana Gen 3 (protocol-notes 2.4, 2.6, 2.7).
//
// On the wire, addresses and sizes are four 7-bit digits: after 7F comes 01 00. Inside the app every address
// and size is a plain linear number; conversion happens only when a message is built or parsed.

/** A linear address: b0*128^3 + b1*128^2 + b2*128 + b3. */
export type Address = number;

const MAX_LINEAR = 128 ** 4;

function check7Bit(b: number): void {
  if (!Number.isInteger(b) || b < 0 || b > 0x7f) throw new RangeError(`Not a 7-bit byte: ${b}`);
}

/** Four 7-bit digits (as on the wire) to a linear number. */
export function toLinear(bytes: readonly number[]): number {
  if (bytes.length !== 4) throw new RangeError(`Address/size needs 4 bytes, got ${bytes.length}`);
  let n = 0;
  for (const b of bytes) {
    check7Bit(b);
    n = n * 128 + b;
  }
  return n;
}

/** A linear number to four 7-bit digits. */
export function fromLinear(n: number): [number, number, number, number] {
  if (!Number.isInteger(n) || n < 0 || n >= MAX_LINEAR) throw new RangeError(`Out of range: ${n}`);
  return [Math.floor(n / 128 ** 3) % 128, Math.floor(n / 128 ** 2) % 128, Math.floor(n / 128) % 128, n % 128];
}

/** Readable shorthand: `addr(0x20, 0x00, 0x58, 0x01)` is the address written as `20 00 58 01`. */
export function addr(b0: number, b1: number, b2: number, b3: number): Address {
  return toLinear([b0, b1, b2, b3]);
}

/** Formats an address or size the way the notes write it, e.g. `20 00 58 01`. */
export function formatAddress(a: Address): string {
  return fromLinear(a)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

// ---- Memory map (protocol-notes 2.6, 2.9) ----

export const ADDR = {
  /** Current patch index 0–9, two nibbles. */
  patchNumber: addr(0x00, 0x00, 0x00, 0x00),
  system: addr(0x10, 0x00, 0x00, 0x00),
  /** Current patch (edit buffer). */
  currentPatch: addr(0x20, 0x00, 0x00, 0x00),
  /** PATCH(1): stored slot of index 0 (Panel). */
  storedPatchBase: addr(0x20, 0x10, 0x00, 0x00),
  editorLevel: addr(0x7f, 0x00, 0x00, 0x00),
  editorMode: addr(0x7f, 0x00, 0x00, 0x01),
  patchSelect: addr(0x7f, 0x00, 0x01, 0x00),
  patchWrite: addr(0x7f, 0x00, 0x01, 0x04),
  /** First of the five status bytes (colour of BOOSTER, MOD, FX, DELAY, REVERB; 3 = off). */
  effectStatus: addr(0x7f, 0x01, 0x01, 0x01),
} as const;

export const SIZE = {
  /** Range size that covers one whole patch. */
  patch: addr(0x00, 0x02, 0x00, 0x00),
  /** Distance between two stored slots. */
  storedPatchStride: addr(0x00, 0x10, 0x00, 0x00),
  /** Range size that covers SYSTEM. */
  system: addr(0x00, 0x00, 0x2a, 0x00),
} as const;

// ---- Patch slots (protocol-notes 2.7) ----

/** Patch index 0–9: 0 = Panel, 1–4 = A1–A4, 5–8 = B1–B4, 9 = PREVIEW (never written). */
export type PatchIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const PATCH_SLOT_NAMES = ['Panel', 'A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'PREVIEW'] as const;

export const PANEL_INDEX = 0;
export const PREVIEW_INDEX = 9;

export function isPatchIndex(n: number): n is PatchIndex {
  return Number.isInteger(n) && n >= 0 && n <= 9;
}

/**
 * Address of the stored patch for a patch index: index n lives in PATCH(n+1).
 * Confirmed on the amp for 0–8 (protocol-notes 2.7). The only place in the code with this mapping.
 */
export function storedPatchAddress(index: number): Address {
  if (!isPatchIndex(index)) throw new RangeError(`Bad patch index: ${index}`);
  return ADDR.storedPatchBase + index * SIZE.storedPatchStride;
}

/** The patch index whose stored slot contains this address, or undefined if it is not in a stored slot. */
export function storedPatchIndexOf(a: Address): PatchIndex | undefined {
  const rel = a - ADDR.storedPatchBase;
  if (rel < 0) return undefined;
  const index = Math.floor(rel / SIZE.storedPatchStride);
  return isPatchIndex(index) ? index : undefined;
}
