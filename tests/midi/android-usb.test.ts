import { describe, expect, it } from 'vitest';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  AndroidUsbTransport,
  describeLayoutDifference,
  type KatanaUsbPlugin,
  type UsbEvent,
  type UsbOpenInfo,
  type UsbStatus,
} from '../../src/midi/android-usb';
import { packetizeSysex } from '../../src/midi/usb-midi';

const INFO: UsbOpenInfo = {
  interfaceId: 3,
  alternateSetting: 0,
  inEndpoint: { address: 0x84, direction: 'in', type: 'bulk', maxPacketSize: 512 },
  outEndpoint: { address: 0x03, direction: 'out', type: 'bulk', maxPacketSize: 512 },
  setInterfaceOk: true,
};
const IDENTITY_REQUEST = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];
const IDENTITY_REPLY = [
  0xf0, 0x7e, 0x10, 0x06, 0x02, 0x41, 0x07, 0x05, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0xf7,
];

/** Stands in for the native plugin. */
class FakePlugin implements KatanaUsbPlugin {
  readonly sent: number[][] = [];
  readonly handlers = new Map<string, ((e: never) => void)[]>();
  status: UsbStatus = { attached: true, hasPermission: true, open: false };
  info: UsbOpenInfo = INFO;
  failOpen: Error | undefined;
  removed = 0;

  open(): Promise<UsbOpenInfo> {
    if (this.failOpen) return Promise.reject(this.failOpen);
    this.status = { ...this.status, open: true, info: this.info };
    return Promise.resolve(this.info);
  }
  close(): Promise<void> {
    this.status = { ...this.status, open: false };
    return Promise.resolve();
  }
  send(options: { bytes: number[] }): Promise<{ written: number }> {
    this.sent.push(options.bytes);
    return Promise.resolve({ written: options.bytes.length });
  }
  getStatus(): Promise<UsbStatus> {
    return Promise.resolve(this.status);
  }
  listDevices(): Promise<{ devices: unknown[] }> {
    return Promise.resolve({ devices: [] });
  }
  addListener(event: string, listener: (e: never) => void): Promise<PluginListenerHandle> {
    const list = this.handlers.get(event) ?? [];
    list.push(listener);
    this.handlers.set(event, list);
    return Promise.resolve({
      remove: () => {
        this.removed++;
        return Promise.resolve();
      },
    });
  }
  fire(event: string, payload: unknown): void {
    for (const h of this.handlers.get(event) ?? []) (h as (e: unknown) => void)(payload);
  }
}

async function started(plugin = new FakePlugin()) {
  const transport = new AndroidUsbTransport(plugin);
  const events: UsbEvent[] = [];
  transport.onEvent((e) => events.push(e));
  await transport.start();
  return { plugin, transport, events };
}

describe('AndroidUsbTransport', () => {
  it('opens, packs SysEx into USB-MIDI packets and sends them', async () => {
    const { plugin, transport, events } = await started();
    await expect(transport.send(IDENTITY_REQUEST)).rejects.toThrow('not open');
    await transport.open();
    expect(transport.state).toBe('open');
    await transport.send(IDENTITY_REQUEST);
    expect(plugin.sent).toEqual([[0x04, 0xf0, 0x7e, 0x7f, 0x07, 0x06, 0x01, 0xf7]]);
    expect(events).toEqual([
      { kind: 'state', state: 'opening' },
      { kind: 'state', state: 'open' },
    ]);
  });

  it('unpacks incoming transfers, also split across events', async () => {
    const { plugin, transport } = await started();
    await transport.open();
    const got: (readonly number[])[] = [];
    transport.onMessage((m) => got.push(m));
    const packets = packetizeSysex(IDENTITY_REPLY);
    plugin.fire('data', { bytes: packets.slice(0, 6) });
    expect(got).toEqual([]);
    plugin.fire('data', { bytes: [...packets.slice(6), ...packetizeSysex([0xf0, 1, 0xf7])] });
    expect(got).toEqual([IDENTITY_REPLY, [0xf0, 1, 0xf7]]);
  });

  it('ignores other cables', async () => {
    const { plugin, transport } = await started();
    await transport.open();
    const got: unknown[] = [];
    transport.onMessage((m) => got.push(m));
    plugin.fire('data', { bytes: packetizeSysex([0xf0, 1, 0xf7], 1) });
    expect(got).toEqual([]);
  });

  it('detach closes and drops a half-received message', async () => {
    const { plugin, transport, events } = await started();
    await transport.open();
    const got: unknown[] = [];
    transport.onMessage((m) => got.push(m));
    plugin.fire('data', { bytes: packetizeSysex(IDENTITY_REPLY).slice(0, 8) });
    plugin.fire('detached', { wasOpen: true });
    expect(transport.state).toBe('closed');
    expect(events.slice(-2)).toEqual([
      { kind: 'state', state: 'closed' },
      { kind: 'detached', wasOpen: true },
    ]);
    plugin.fire('data', { bytes: packetizeSysex(IDENTITY_REPLY).slice(8) });
    expect(got).toEqual([]);
  });

  it('passes attach, errors and native log lines on', async () => {
    const { plugin, events } = await started();
    plugin.fire('attached', { device: {} });
    plugin.fire('error', { message: 'boom' });
    plugin.fire('log', { message: 'Plugin loaded' });
    expect(events).toEqual([
      { kind: 'attached' },
      { kind: 'error', message: 'boom' },
      { kind: 'log', message: 'Plugin loaded' },
    ]);
  });

  it('a failed open returns to closed', async () => {
    const plugin = new FakePlugin();
    plugin.failOpen = new Error('USB permission denied');
    const { transport } = await started(plugin);
    await expect(transport.open()).rejects.toThrow('permission denied');
    expect(transport.state).toBe('closed');
  });

  it('picks up a connection the native side kept open across a page reload', async () => {
    const plugin = new FakePlugin();
    plugin.status = { attached: true, hasPermission: true, open: true, info: INFO };
    const { transport } = await started(plugin);
    expect(transport.state).toBe('open');
  });

  it('warns when the plugin picked another layout than measured', async () => {
    const plugin = new FakePlugin();
    plugin.info = { ...INFO, interfaceId: 4, inEndpoint: { ...INFO.inEndpoint, address: 0x85 } };
    const { transport, events } = await started(plugin);
    await transport.open();
    expect(events.at(-1)).toEqual({
      kind: 'error',
      message: 'USB layout differs from the measured one: interface 4, IN 0x85',
    });
    expect(describeLayoutDifference(INFO)).toBe('');
  });

  it('close and dispose', async () => {
    const { plugin, transport } = await started();
    await transport.open();
    await transport.close();
    expect(transport.state).toBe('closed');
    await transport.dispose();
    expect(plugin.removed).toBe(5);
  });
});
