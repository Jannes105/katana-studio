// The mock amp as a pluggable device (DeviceTransport), so the app runs unchanged in the browser on the PC.

import type {
  DeviceEvent,
  DeviceState,
  DeviceTransport,
  MessageListener,
  MidiMessage,
} from '../midi/transport';
import { MockAmp } from './mock-amp';

export class MockDevice implements DeviceTransport {
  readonly name = 'Mock amp';
  private stateValue: DeviceState = 'closed';
  private attachedValue = true;
  private readonly listeners = new Set<MessageListener>();
  private readonly eventListeners = new Set<(e: DeviceEvent) => void>();

  constructor(readonly amp: MockAmp = new MockAmp()) {
    amp.onMessage((m) => {
      if (this.stateValue !== 'open') return;
      for (const l of this.listeners) l(m);
    });
  }

  get state(): DeviceState {
    return this.stateValue;
  }

  start(): Promise<void> {
    this.emit({ kind: 'log', message: 'Mock amp ready (no real device)' });
    return Promise.resolve();
  }

  isAttached(): Promise<boolean> {
    return Promise.resolve(this.attachedValue);
  }

  open(): Promise<unknown> {
    if (!this.attachedValue) return Promise.reject(new Error('No KATANA attached'));
    this.setState('open');
    return Promise.resolve({});
  }

  close(): Promise<void> {
    this.setState('closed');
    return Promise.resolve();
  }

  send(message: MidiMessage): Promise<void> {
    if (this.stateValue !== 'open') return Promise.reject(new Error('Mock amp is not open'));
    return this.amp.send(message);
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: (e: DeviceEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Simulates pulling the cable. */
  unplug(): void {
    const wasOpen = this.stateValue === 'open';
    this.attachedValue = false;
    this.setState('closed');
    this.emit({ kind: 'detached', wasOpen });
  }

  /** Simulates plugging the cable in; the amp comes back with editor mode off, like after a power cycle. */
  plug(): void {
    this.attachedValue = true;
    this.amp.powerCycle();
    this.emit({ kind: 'attached' });
  }

  private setState(state: DeviceState): void {
    if (state === this.stateValue) return;
    this.stateValue = state;
    this.emit({ kind: 'state', state });
  }

  private emit(e: DeviceEvent): void {
    for (const l of this.eventListeners) l(e);
  }
}
