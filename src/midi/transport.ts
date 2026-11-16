// Transport interface (PLAN 4.2): moves complete MIDI messages to and from the amp. Implementations: Android USB
// (packs messages into USB-MIDI packets, see usb-midi.ts), Web MIDI (PC development) and the mock amp.

/** One complete MIDI message as bytes, e.g. a SysEx from F0 to F7. */
export type MidiMessage = readonly number[];

export type MessageListener = (message: MidiMessage) => void;

export interface Transport {
  /** Sends one complete message. Resolves once it is handed to the device; rejects if it cannot be sent. */
  send(message: MidiMessage): Promise<void>;
  /** Registers a listener for every complete incoming message. Returns a function that removes it. */
  onMessage(listener: MessageListener): () => void;
}
