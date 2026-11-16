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

export type DeviceState = 'closed' | 'opening' | 'open';

export type DeviceEvent =
  | { kind: 'state'; state: DeviceState }
  | { kind: 'attached' }
  | { kind: 'detached'; wasOpen: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'log'; message: string };

/** A transport to a device that can be plugged in and out (USB on the phone, the mock in the browser). */
export interface DeviceTransport extends Transport {
  /** Short name for the log and the status line ("USB", "Mock amp"). */
  readonly name: string;
  readonly state: DeviceState;
  /** Subscribes to the device's events. Call once before anything else. */
  start(): Promise<void>;
  /** Whether the amp is plugged in right now. */
  isAttached(): Promise<boolean>;
  /** Claims the amp (may ask the user for permission once). */
  open(): Promise<unknown>;
  close(): Promise<void>;
  onEvent(listener: (e: DeviceEvent) => void): () => void;
}
