// USB-MIDI event packets (4 bytes each) as the Katana uses them on its vendor interface (protocol-notes 3):
// cable 0, CIN 4 (SysEx continues), 5/6/7 (SysEx ends with 1/2/3 bytes). The native plugin only moves raw bytes;
// packing and unpacking happen here so they can be tested.

/** Wraps one complete SysEx message (F0 … F7) into USB-MIDI packets. */
export function packetizeSysex(sysex: readonly number[], cable = 0): number[] {
  if (sysex.length < 2 || sysex[0] !== 0xf0 || sysex[sysex.length - 1] !== 0xf7) {
    throw new RangeError('Not a complete SysEx message');
  }
  if (!Number.isInteger(cable) || cable < 0 || cable > 15) throw new RangeError(`Bad cable number: ${cable}`);
  const c = cable << 4;
  const out: number[] = [];
  for (let i = 0; i < sysex.length; i += 3) {
    const [a = 0, b = 0, d = 0] = sysex.slice(i, i + 3);
    const rest = sysex.length - i;
    if (rest > 3) out.push(c | 0x4, a, b, d);
    else if (rest === 3) out.push(c | 0x7, a, b, d);
    else if (rest === 2) out.push(c | 0x6, a, b, 0);
    else out.push(c | 0x5, a, 0, 0);
  }
  return out;
}

/** Number of MIDI bytes carried by a packet, indexed by its Code Index Number. */
const CIN_LENGTH = [0, 0, 2, 3, 3, 1, 2, 3, 3, 3, 3, 3, 2, 2, 3, 1] as const;

export interface UsbMidiMessage {
  readonly cable: number;
  readonly bytes: number[];
}

/** Largest SysEx we collect before giving up on a message whose end never came (longest seen: 238 bytes). */
export const MAX_SYSEX_LENGTH = 4096;

/**
 * Stateful parser: feed it raw transfers, get complete MIDI messages back. A transfer may hold several packets,
 * a SysEx message may span transfers, and a transfer may even end in the middle of a packet. Unused bytes in a
 * short final packet are ignored (the amp does not zero them; the CIN gives the length).
 */
export class UsbMidiParser {
  private leftover: number[] = [];
  private readonly sysex = new Map<number, number[]>();
  /** Count of SysEx messages dropped because they grew beyond MAX_SYSEX_LENGTH or restarted with F0. */
  dropped = 0;

  reset(): void {
    this.leftover = [];
    this.sysex.clear();
  }

  /** Returns every message completed by this chunk, in order. */
  push(chunk: ArrayLike<number>): UsbMidiMessage[] {
    const bytes = this.leftover.concat(Array.from(chunk));
    const usable = bytes.length - (bytes.length % 4);
    this.leftover = bytes.slice(usable);
    const messages: UsbMidiMessage[] = [];

    for (let i = 0; i < usable; i += 4) {
      const header = bytes[i] ?? 0;
      const cable = header >> 4;
      const cin = header & 0x0f;
      const payload = bytes.slice(i + 1, i + 1 + (CIN_LENGTH[cin] ?? 0));
      if (payload.length === 0) continue; // padding or reserved CIN

      const running = this.sysex.get(cable);
      const isSysexStartOrMiddle = cin === 0x4;
      const isSysexEnd =
        cin === 0x6 || cin === 0x7 || (cin === 0x5 && (payload[0] === 0xf7 || running !== undefined));

      if (isSysexStartOrMiddle || isSysexEnd) {
        let buf = running;
        if (payload[0] === 0xf0) {
          if (buf !== undefined) this.dropped++; // a new SysEx started before the old one ended
          buf = [];
        } else if (buf === undefined) {
          continue; // continuation without a start: we joined mid-message, skip it
        }
        buf.push(...payload);
        if (isSysexEnd) {
          this.sysex.delete(cable);
          messages.push({ cable, bytes: buf });
        } else if (buf.length > MAX_SYSEX_LENGTH) {
          this.sysex.delete(cable);
          this.dropped++;
        } else {
          this.sysex.set(cable, buf);
        }
      } else {
        // Channel and system messages, including single-byte realtime between SysEx packets.
        messages.push({ cable, bytes: payload });
      }
    }
    return messages;
  }
}
