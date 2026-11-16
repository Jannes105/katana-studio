// Value encodings (protocol-notes 2.5, PLAN 4.3). Each codec turns a number or string into the bytes stored at
// a parameter address and back.

export interface Codec<T> {
  /** Number of bytes on the wire. */
  readonly size: number;
  encode(value: T): number[];
  decode(bytes: readonly number[]): T;
}

function need(bytes: readonly number[], size: number, name: string): void {
  if (bytes.length !== size) throw new RangeError(`${name} needs ${size} bytes, got ${bytes.length}`);
}

function checkRange(value: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name}: ${value} is outside 0–${max}`);
  }
}

/** One byte, 0–127. */
export const u7: Codec<number> = {
  size: 1,
  encode(value) {
    checkRange(value, 0x7f, 'u7');
    return [value];
  },
  decode(bytes) {
    need(bytes, 1, 'u7');
    return (bytes[0] ?? 0) & 0x7f;
  },
};

/** `count` bytes with one nibble each, most significant first (u2x4: patch number; u4x4: delay time, …). */
function nibbles(count: number, name: string): Codec<number> {
  const max = 16 ** count - 1;
  return {
    size: count,
    encode(value) {
      checkRange(value, max, name);
      const out: number[] = [];
      for (let i = count - 1; i >= 0; i--) out.push(Math.floor(value / 16 ** i) % 16);
      return out;
    },
    decode(bytes) {
      need(bytes, count, name);
      let n = 0;
      for (const b of bytes) n = n * 16 + (b & 0x0f);
      return n;
    },
  };
}

export const u2x4 = nibbles(2, 'u2x4');
export const u4x4 = nibbles(4, 'u4x4');

/** Two bytes of 7 bits, most significant first (commands). */
export const u2x7: Codec<number> = {
  size: 2,
  encode(value) {
    checkRange(value, 128 * 128 - 1, 'u2x7');
    return [Math.floor(value / 128), value % 128];
  },
  decode(bytes) {
    need(bytes, 2, 'u2x7');
    return ((bytes[0] ?? 0) & 0x7f) * 128 + ((bytes[1] ?? 0) & 0x7f);
  },
};

export const ASCII_MIN = 32;
export const ASCII_MAX = 125;

/** Fixed-length text, characters 32–125, padded with spaces (patch name: ascii(16)). */
export function ascii(length: number): Codec<string> {
  return {
    size: length,
    encode(value) {
      if (value.length > length) throw new RangeError(`Text longer than ${length}: "${value}"`);
      const out: number[] = [];
      for (const ch of value.padEnd(length, ' ')) {
        const c = ch.charCodeAt(0);
        if (ch.length !== 1 || c < ASCII_MIN || c > ASCII_MAX)
          throw new RangeError(`Character not allowed: "${ch}"`);
        out.push(c);
      }
      return out;
    },
    decode(bytes) {
      need(bytes, length, 'ascii');
      return String.fromCharCode(...bytes).trimEnd();
    },
  };
}

export const PATCH_NAME_LENGTH = 16;
export const patchName = ascii(PATCH_NAME_LENGTH);
