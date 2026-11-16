// Android USB transport (PLAN 4.2): talks to the native KatanaUsb plugin (android/…/usb/KatanaUsbPlugin.kt).
// The plugin only moves raw bytes; SysEx is packed into USB-MIDI packets and unpacked here (usb-midi.ts).
// This file and the storage file helpers are the only places in the core that may use Capacitor (PLAN 4.1).

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { MessageListener, MidiMessage, Transport } from './transport';
import { UsbMidiParser, packetizeSysex } from './usb-midi';

/** Measured on the phone (protocol-notes 3); the plugin picks automatically, these only serve as a check. */
export const EXPECTED_USB = {
  interfaceId: 3,
  alternateSetting: 0,
  inAddress: 0x84,
  outAddress: 0x03,
} as const;
const CABLE = 0;

export interface UsbEndpointInfo {
  readonly address: number;
  readonly direction: 'in' | 'out';
  readonly type: string;
  readonly maxPacketSize: number;
}

export interface UsbOpenInfo {
  readonly interfaceId: number;
  readonly alternateSetting: number;
  readonly inEndpoint: UsbEndpointInfo;
  readonly outEndpoint: UsbEndpointInfo;
  readonly setInterfaceOk: boolean;
}

export interface UsbStatus {
  readonly attached: boolean;
  readonly hasPermission: boolean;
  readonly open: boolean;
  readonly info?: UsbOpenInfo;
}

/** The native plugin's interface, as implemented in KatanaUsbPlugin.kt. */
export interface KatanaUsbPlugin {
  open(): Promise<UsbOpenInfo>;
  close(): Promise<void>;
  send(options: { bytes: number[] }): Promise<{ written: number }>;
  getStatus(): Promise<UsbStatus>;
  listDevices(): Promise<{ devices: unknown[] }>;
  addListener(event: 'data', listener: (e: { bytes: number[] }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'attached', listener: (e: { device: unknown }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'detached', listener: (e: { wasOpen: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(
    event: 'error' | 'log',
    listener: (e: { message: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export type UsbConnectionState = 'closed' | 'opening' | 'open';

export type UsbEvent =
  | { kind: 'state'; state: UsbConnectionState }
  | { kind: 'attached' }
  | { kind: 'detached'; wasOpen: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'log'; message: string };

export function nativeKatanaUsb(): KatanaUsbPlugin {
  return registerPlugin<KatanaUsbPlugin>('KatanaUsb');
}

/**
 * Transport over the native plugin. `start()` subscribes to the plugin's events; `open()` claims the amp. The
 * caller (state layer) decides when to open, e.g. on an "attached" event or at app start when the amp is
 * already plugged in (`status()`).
 */
export class AndroidUsbTransport implements Transport {
  private readonly listeners = new Set<MessageListener>();
  private readonly eventListeners = new Set<(e: UsbEvent) => void>();
  private readonly parser = new UsbMidiParser();
  private readonly handles: PluginListenerHandle[] = [];
  private stateValue: UsbConnectionState = 'closed';

  constructor(private readonly plugin: KatanaUsbPlugin = nativeKatanaUsb()) {}

  get state(): UsbConnectionState {
    return this.stateValue;
  }

  /** Subscribes to the plugin's events. Call once before anything else. */
  async start(): Promise<void> {
    const p = this.plugin;
    this.handles.push(
      await p.addListener('data', (e) => this.onData(e.bytes)),
      await p.addListener('attached', () => this.emit({ kind: 'attached' })),
      await p.addListener('detached', (e) => this.onDetached(e.wasOpen)),
      await p.addListener('error', (e) => this.emit({ kind: 'error', message: e.message })),
      await p.addListener('log', (e) => this.emit({ kind: 'log', message: e.message })),
    );
    // The page may have reloaded while the native side kept the device open.
    const status = await p.getStatus();
    if (status.open) {
      this.parser.reset();
      this.setState('open');
    }
  }

  /** Native status: attached, permission, open. */
  status(): Promise<UsbStatus> {
    return this.plugin.getStatus();
  }

  /** Claims the amp (asks for permission once if needed). Resolves with what the plugin picked. */
  async open(): Promise<UsbOpenInfo> {
    this.setState('opening');
    try {
      const info = await this.plugin.open();
      this.parser.reset();
      this.setState('open');
      const differs = describeLayoutDifference(info);
      if (differs)
        this.emit({ kind: 'error', message: `USB layout differs from the measured one: ${differs}` });
      return info;
    } catch (error) {
      this.setState('closed');
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.plugin.close();
    this.parser.reset();
    this.setState('closed');
  }

  /** Removes the plugin listeners (the app is shutting down). */
  async dispose(): Promise<void> {
    await Promise.all(this.handles.splice(0).map((h) => h.remove()));
    this.listeners.clear();
    this.eventListeners.clear();
  }

  // ---- Transport ----

  async send(message: MidiMessage): Promise<void> {
    if (this.stateValue !== 'open') throw new Error('USB is not open');
    await this.plugin.send({ bytes: packetizeSysex(message, CABLE) });
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Connection state, attach/detach, errors and native log lines (for the log screen). */
  onEvent(listener: (e: UsbEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // ---- internals ----

  private onData(bytes: readonly number[]): void {
    for (const m of this.parser.push(bytes)) {
      if (m.cable !== CABLE) continue;
      for (const l of this.listeners) l(m.bytes);
    }
  }

  private onDetached(wasOpen: boolean): void {
    this.parser.reset();
    this.setState('closed');
    this.emit({ kind: 'detached', wasOpen });
  }

  private setState(state: UsbConnectionState): void {
    if (state === this.stateValue) return;
    this.stateValue = state;
    this.emit({ kind: 'state', state });
  }

  private emit(e: UsbEvent): void {
    for (const l of this.eventListeners) l(e);
  }
}

/** Empty string if the plugin picked the measured layout, otherwise what differs. */
export function describeLayoutDifference(info: UsbOpenInfo): string {
  const diffs: string[] = [];
  const hex = (n: number) => `0x${n.toString(16).padStart(2, '0').toUpperCase()}`;
  if (info.interfaceId !== EXPECTED_USB.interfaceId) diffs.push(`interface ${info.interfaceId}`);
  if (info.alternateSetting !== EXPECTED_USB.alternateSetting) diffs.push(`alt ${info.alternateSetting}`);
  if (info.inEndpoint.address !== EXPECTED_USB.inAddress) diffs.push(`IN ${hex(info.inEndpoint.address)}`);
  if (info.outEndpoint.address !== EXPECTED_USB.outAddress)
    diffs.push(`OUT ${hex(info.outEndpoint.address)}`);
  return diffs.join(', ');
}
