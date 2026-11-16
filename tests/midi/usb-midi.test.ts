import { describe, expect, it } from 'vitest';
import { MAX_SYSEX_LENGTH, UsbMidiParser, packetizeSysex } from '../../src/midi/usb-midi';

const IDENTITY_REQUEST = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];
const hex = (b: readonly number[]) => b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const sysex = (n: number) => [0xf0, ...Array.from({ length: n }, (_, i) => i % 128), 0xf7];

describe('packetizeSysex', () => {
  it('covers all three endings', () => {
    expect(hex(packetizeSysex(IDENTITY_REQUEST))).toBe('04 F0 7E 7F 07 06 01 F7'); // ends with 3
    expect(hex(packetizeSysex([0xf0, 1, 2, 0xf7]))).toBe('04 F0 01 02 05 F7 00 00'); // ends with 1
    expect(hex(packetizeSysex([0xf0, 1, 2, 3, 0xf7]))).toBe('04 F0 01 02 06 03 F7 00'); // ends with 2
    expect(hex(packetizeSysex([0xf0, 0xf7]))).toBe('06 F0 F7 00');
  });

  it('puts the cable number in the high nibble', () => {
    expect(hex(packetizeSysex([0xf0, 1, 0xf7], 2))).toBe('27 F0 01 F7');
    expect(() => packetizeSysex([0xf0, 0xf7], 16)).toThrow(RangeError);
  });

  it('rejects anything but a complete SysEx', () => {
    expect(() => packetizeSysex([0x90, 1, 2])).toThrow(RangeError);
    expect(() => packetizeSysex([0xf0, 1])).toThrow(RangeError);
  });
});

describe('UsbMidiParser', () => {
  it('round-trips several messages in one transfer', () => {
    const a = sysex(10);
    const b = sysex(11);
    const c = sysex(12);
    const parser = new UsbMidiParser();
    const out = parser.push([...packetizeSysex(a), ...packetizeSysex(b), ...packetizeSysex(c)]);
    expect(out.map((m) => m.bytes)).toEqual([a, b, c]);
  });

  it('joins a message split across transfers, even mid-packet', () => {
    const msg = sysex(40);
    const packets = packetizeSysex(msg);
    const parser = new UsbMidiParser();
    expect(parser.push(packets.slice(0, 10))).toEqual([]);
    expect(parser.push(packets.slice(10, 21))).toEqual([]);
    expect(parser.push(packets.slice(21)).map((m) => m.bytes)).toEqual([msg]);
  });

  it('handles the longest message seen (238 bytes)', () => {
    const msg = sysex(236);
    expect(new UsbMidiParser().push(packetizeSysex(msg))[0]?.bytes).toEqual(msg);
  });

  it('ignores the stale bytes of a short final packet (the amp does not zero them)', () => {
    const parser = new UsbMidiParser();
    expect(parser.push([0x04, 0xf0, 0x01, 0x02, 0x05, 0xf7, 0x01, 0x02])).toEqual([
      { cable: 0, bytes: [0xf0, 0x01, 0x02, 0xf7] },
    ]);
  });

  it('passes padding, short messages and other cables', () => {
    const parser = new UsbMidiParser();
    expect(
      parser.push([
        0x00,
        0x00,
        0x00,
        0x00, // padding
        0x0f,
        0xfe,
        0x00,
        0x00, // active sensing
        0x1c,
        0xc0,
        0x05,
        0x00, // program change on cable 1
        0x09,
        0x90,
        0x3c,
        0x7f, // note on
      ]),
    ).toEqual([
      { cable: 0, bytes: [0xfe] },
      { cable: 1, bytes: [0xc0, 0x05] },
      { cable: 0, bytes: [0x90, 0x3c, 0x7f] },
    ]);
  });

  it('keeps a running SysEx across a single-byte realtime message', () => {
    const parser = new UsbMidiParser();
    expect(parser.push([0x04, 0xf0, 0x01, 0x02, 0x0f, 0xf8, 0x00, 0x00, 0x05, 0xf7, 0x00, 0x00])).toEqual([
      { cable: 0, bytes: [0xf8] },
      { cable: 0, bytes: [0xf0, 0x01, 0x02, 0xf7] },
    ]);
  });

  it('skips a continuation without a start (joined mid-message)', () => {
    const parser = new UsbMidiParser();
    expect(parser.push([0x04, 0x01, 0x02, 0x03, 0x07, 0x04, 0x05, 0xf7])).toEqual([]);
    expect(parser.push(packetizeSysex([0xf0, 9, 0xf7])).map((m) => m.bytes)).toEqual([[0xf0, 9, 0xf7]]);
  });

  it('drops an unfinished SysEx when a new one starts', () => {
    const parser = new UsbMidiParser();
    const out = parser.push([0x04, 0xf0, 0x01, 0x02, ...packetizeSysex([0xf0, 7, 0xf7])]);
    expect(out.map((m) => m.bytes)).toEqual([[0xf0, 7, 0xf7]]);
    expect(parser.dropped).toBe(1);
  });

  it('drops a runaway SysEx', () => {
    const parser = new UsbMidiParser();
    const packets = packetizeSysex(sysex(MAX_SYSEX_LENGTH + 10)).slice(0, -4); // never ends
    expect(parser.push(packets)).toEqual([]);
    expect(parser.dropped).toBe(1);
  });

  it('reset forgets partial data', () => {
    const parser = new UsbMidiParser();
    parser.push([0x04, 0xf0, 0x01]);
    parser.reset();
    expect(parser.push(packetizeSysex([0xf0, 5, 0xf7])).map((m) => m.bytes)).toEqual([[0xf0, 5, 0xf7]]);
  });
});
