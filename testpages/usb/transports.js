// The two transports of the USB test page. Both expose the same small interface:
//
//   kind, label
//   onData(bytes: Uint8Array)       raw IN transfer
//   onDisconnect(reason: string)    device unplugged
//   onAttach(info: string)          device (re)appeared
//   async selectDevice({ anyDevice }) -> device model (see usb-core.js) or null
//   async readRawDescriptors()      -> number[] | null (raw device + configuration descriptors)
//   async open(selection)           -> { interfaceId, alternateSetting, inEndpoint, outEndpoint, rawDescriptors? }
//        selection: { interfaceId?, alternateSetting?, inEndpoint?, outEndpoint? } (endpoint = address)
//   async send(bytes)               -> number of bytes written
//   async close()
//
// Every step logs through the `log(cls, text)` callback; errors are logged with name and message.

import { USB_IDS, hex } from '../shared/katana.js';
import { describeError, hex2, hex4, normalizeWebUsbDevice, readLength } from './usb-core.js';

const noop = () => {};

function tagged(step, e) {
  const error = new Error(`${step} failed: ${describeError(e)}`);
  error.step = step;
  error.cause = e;
  return error;
}

// ---------------------------------------------------------------------------
// WebUSB (Chrome on the phone or PC)
// ---------------------------------------------------------------------------

export class WebUsbTransport {
  static available() {
    return typeof navigator !== 'undefined' && !!navigator.usb;
  }

  constructor({ log }) {
    this.kind = 'webusb';
    this.label = 'WebUSB (browser)';
    this.log = log;
    this.device = null;
    this.model = null;
    this.claimed = null; // interface number
    this.inNumber = null;
    this.outNumber = null;
    this.reading = false;
    this.onData = noop;
    this.onDisconnect = noop;
    this.onAttach = noop;

    navigator.usb.addEventListener('disconnect', (event) => {
      if (event.device !== this.device) {
        this.log('info', `Another USB device was disconnected (${hex4(event.device.vendorId)}:${hex4(event.device.productId)}).`);
        return;
      }
      this.reading = false;
      this.claimed = null;
      this.onDisconnect('WebUSB disconnect event');
    });
    navigator.usb.addEventListener('connect', (event) => {
      const d = event.device;
      const same = this.device && d.vendorId === this.device.vendorId && d.productId === this.device.productId;
      if (same || !this.device) {
        this.device = d;
        this.model = normalizeWebUsbDevice(d);
      }
      this.onAttach(`${hex4(d.vendorId)}:${hex4(d.productId)} ${d.productName ?? ''}`);
    });
  }

  async selectDevice({ anyDevice = false } = {}) {
    const filters = anyDevice ? [] : [{ vendorId: USB_IDS.vendorId, productId: USB_IDS.productId }];
    this.log('info', `navigator.usb.requestDevice(${anyDevice ? 'no filter' : `VID ${hex4(USB_IDS.vendorId)} / PID ${hex4(USB_IDS.productId)}`}) …`);
    try {
      const known = await navigator.usb.getDevices();
      this.log('info', `Devices this page already has permission for: ${known.length === 0 ? 'none' : known.map((d) => `${hex4(d.vendorId)}:${hex4(d.productId)} ${d.productName ?? ''}`).join(', ')}`);
    } catch (e) {
      this.log('err', `getDevices failed: ${describeError(e)}`);
    }
    let device;
    try {
      device = await navigator.usb.requestDevice({ filters });
    } catch (e) {
      if (e?.name === 'NotFoundError') {
        this.log('err', `No device selected (${describeError(e)}). If the Katana is not in the list, try "Any device", check the cable/OTG setting and that the amp is on.`);
        return null;
      }
      throw tagged('requestDevice', e);
    }
    if (this.device && this.device !== device) await this.close().catch(noop);
    this.device = device;
    this.model = normalizeWebUsbDevice(device);
    return this.model;
  }

  async ensureOpen() {
    if (!this.device) throw new Error('No device selected');
    if (this.device.opened) return;
    this.log('info', 'device.open() …');
    try {
      await this.device.open();
      this.log('ok', 'device.open() succeeded.');
    } catch (e) {
      throw tagged('device.open', e);
    }
  }

  async getDescriptor(value, length) {
    const result = await this.device.controlTransferIn(
      { requestType: 'standard', recipient: 'device', request: 0x06, value, index: 0 },
      length,
    );
    if (result.status !== 'ok') throw new Error(`control transfer status "${result.status}"`);
    if (!result.data) return [];
    return Array.from(new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength));
  }

  // Device descriptor plus every configuration descriptor, concatenated.
  async readRawDescriptors() {
    await this.ensureOpen();
    const raw = [];
    try {
      const dev = await this.getDescriptor(0x0100, 18);
      this.log('info', `GET_DESCRIPTOR(device): ${dev.length} bytes`);
      raw.push(...dev);
    } catch (e) {
      this.log('err', `GET_DESCRIPTOR(device) failed: ${describeError(e)}`);
    }
    const count = Math.max(1, this.device.configurations?.length ?? 1);
    for (let index = 0; index < count; index++) {
      try {
        const head = await this.getDescriptor(0x0200 | index, 9);
        if (head.length < 4) throw new Error(`short reply (${head.length} bytes): ${hex(head)}`);
        const total = head[2] | (head[3] << 8);
        this.log('info', `GET_DESCRIPTOR(configuration ${index}): header ${hex(head)}, wTotalLength=${total}`);
        const full = await this.getDescriptor(0x0200 | index, Math.max(total, 9));
        if (full.length !== total) this.log('err', `Configuration ${index}: got ${full.length} bytes, wTotalLength says ${total}.`);
        raw.push(...full);
      } catch (e) {
        this.log('err', `GET_DESCRIPTOR(configuration ${index}) failed: ${describeError(e)}`);
      }
    }
    return raw.length > 0 ? raw : null;
  }

  async open(selection) {
    const device = this.device;
    await this.ensureOpen();
    const { interfaceId, alternateSetting, inEndpoint, outEndpoint } = selection;
    const entry = this.model.interfaces.find((i) => i.id === interfaceId && i.alternateSetting === alternateSetting);
    const inEp = entry?.endpoints.find((ep) => ep.address === inEndpoint);
    const outEp = entry?.endpoints.find((ep) => ep.address === outEndpoint);
    if (!entry || !inEp || !outEp) throw new Error('Selected interface/endpoints not found in the device descriptors');

    const wantedConfig = this.model.configurations[0]?.value ?? 1;
    if (!device.configuration || device.configuration.configurationValue !== wantedConfig) {
      this.log('info', `selectConfiguration(${wantedConfig}) … (active: ${device.configuration?.configurationValue ?? 'none'})`);
      try {
        await device.selectConfiguration(wantedConfig);
        this.log('ok', 'selectConfiguration succeeded.');
      } catch (e) {
        throw tagged('selectConfiguration', e);
      }
    } else {
      this.log('info', `Configuration ${wantedConfig} is already active.`);
    }

    this.log('info', `claimInterface(${interfaceId}) …`);
    try {
      await device.claimInterface(interfaceId);
      this.claimed = interfaceId;
      this.log('ok', `claimInterface(${interfaceId}) succeeded.`);
    } catch (e) {
      throw tagged('claimInterface', e);
    }

    const altCount = this.model.interfaces.filter((i) => i.id === interfaceId).length;
    if (alternateSetting !== 0 || altCount > 1) {
      this.log('info', `selectAlternateInterface(${interfaceId}, ${alternateSetting}) …`);
      try {
        await device.selectAlternateInterface(interfaceId, alternateSetting);
        this.log('ok', 'selectAlternateInterface succeeded.');
      } catch (e) {
        throw tagged('selectAlternateInterface', e);
      }
    } else {
      this.log('info', 'Interface has only alternate setting 0; selectAlternateInterface skipped.');
    }

    this.inNumber = inEp.number;
    this.outNumber = outEp.number;
    this.startReadLoop(inEp);
    return { interfaceId, alternateSetting, inEndpoint: inEp, outEndpoint: outEp };
  }

  startReadLoop(inEp) {
    const device = this.device;
    const length = readLength(inEp.maxPacketSize);
    this.reading = true;
    this.log('info', `Read loop started: transferIn(endpoint #${inEp.number}, ${length} bytes), ${inEp.type}.`);
    (async () => {
      let failures = 0;
      while (this.reading && this.device === device) {
        try {
          const result = await device.transferIn(inEp.number, length);
          if (result.status === 'stall') {
            this.log('err', 'transferIn: endpoint stalled, clearing halt.');
            await device.clearHalt('in', inEp.number);
            continue;
          }
          if (result.status !== 'ok') this.log('err', `transferIn status "${result.status}"`);
          if (result.data && result.data.byteLength > 0) {
            this.onData(new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength));
          }
          failures = 0;
        } catch (e) {
          if (!this.reading || this.device !== device) break; // closed or unplugged on purpose
          failures++;
          this.log('err', `transferIn failed (${failures}/3): ${describeError(e)}`);
          if (failures >= 3) {
            this.log('err', 'Read loop stopped after 3 failures in a row. Close and open again.');
            this.reading = false;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      this.log('info', 'Read loop ended.');
    })();
  }

  async send(bytes) {
    if (!this.device || this.outNumber === null) throw new Error('Not open');
    const result = await this.device.transferOut(this.outNumber, Uint8Array.from(bytes));
    if (result.status !== 'ok') throw new Error(`transferOut status "${result.status}" (${result.bytesWritten} bytes written)`);
    return result.bytesWritten;
  }

  async close() {
    this.reading = false;
    const device = this.device;
    if (!device) return;
    if (this.claimed !== null) {
      try {
        if (device.opened) await device.releaseInterface(this.claimed);
      } catch (e) {
        this.log('info', `releaseInterface: ${describeError(e)}`);
      }
      this.claimed = null;
    }
    this.inNumber = null;
    this.outNumber = null;
    try {
      if (device.opened) await device.close();
    } catch (e) {
      this.log('info', `device.close: ${describeError(e)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Native (Capacitor plugin "KatanaUsb" inside the test APK)
// ---------------------------------------------------------------------------

export function findNativePlugin() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
  if (!cap?.isNativePlatform?.()) return null;
  let plugin = cap.Plugins?.KatanaUsb ?? null;
  if (!plugin && typeof cap.registerPlugin === 'function') {
    try {
      plugin = cap.registerPlugin('KatanaUsb');
    } catch {
      plugin = null;
    }
  }
  return plugin;
}

export class NativeTransport {
  constructor({ log, plugin }) {
    this.kind = 'native';
    this.label = 'Native (Android USB host API, KatanaUsb plugin)';
    this.log = log;
    this.plugin = plugin;
    this.model = null;
    this.onData = noop;
    this.onDisconnect = noop;
    this.onAttach = noop;

    const listen = (name, handler) => {
      try {
        const handle = plugin.addListener(name, (event) => {
          try {
            handler(event ?? {});
          } catch (e) {
            this.log('err', `Handler for native event "${name}" failed: ${describeError(e)}`);
          }
        });
        if (handle && typeof handle.catch === 'function') {
          handle.catch((e) => this.log('err', `addListener("${name}") failed: ${describeError(e)}`));
        }
      } catch (e) {
        this.log('err', `addListener("${name}") failed: ${describeError(e)}`);
      }
    };
    listen('data', (event) => this.onData(Uint8Array.from(event.bytes ?? [])));
    listen('attached', (event) => {
      const d = event.device;
      this.onAttach(d ? `${hex4(d.vendorId)}:${hex4(d.productId)} ${d.productName ?? ''} (${d.deviceName ?? ''})` : 'device');
    });
    listen('detached', () => this.onDisconnect('native "detached" event'));
    listen('error', (event) => this.log('err', `Plugin error: ${event.message ?? JSON.stringify(event)}`));
    listen('log', (event) => this.log('info', `[plugin] ${event.message ?? JSON.stringify(event)}`));
  }

  async selectDevice({ anyDevice = false } = {}) {
    this.log('info', 'KatanaUsb.listDevices() …');
    let devices;
    try {
      devices = (await this.plugin.listDevices())?.devices ?? [];
    } catch (e) {
      throw tagged('listDevices', e);
    }
    this.log('info', `${devices.length} USB device(s) attached.`);
    for (const d of devices) {
      this.log('info', `  ${d.deviceName}: ${hex4(d.vendorId)}:${hex4(d.productId)} "${d.manufacturerName ?? ''}" "${d.productName ?? ''}"`
        + ` class=${hex2(d.deviceClass)}/${hex2(d.deviceSubclass)}/${hex2(d.deviceProtocol)} permission=${d.hasPermission}`);
    }
    const katana = devices.find((d) => d.vendorId === USB_IDS.vendorId && d.productId === USB_IDS.productId);
    const chosen = katana ?? (anyDevice ? devices[0] : null);
    if (!chosen) {
      this.log('err', devices.length === 0
        ? 'No USB device attached. Check the cable, the OTG setting and that the amp is on.'
        : `No device with VID ${hex4(USB_IDS.vendorId)} / PID ${hex4(USB_IDS.productId)}. Use "Any device" to take the first one in the list.`);
      this.model = null;
      return null;
    }
    this.model = {
      vendorId: chosen.vendorId,
      productId: chosen.productId,
      deviceClass: chosen.deviceClass,
      deviceSubclass: chosen.deviceSubclass,
      deviceProtocol: chosen.deviceProtocol,
      manufacturerName: chosen.manufacturerName ?? '',
      productName: chosen.productName ?? '',
      serialNumber: '',
      usbVersion: '',
      deviceName: chosen.deviceName ?? '',
      hasPermission: chosen.hasPermission,
      activeConfiguration: null,
      configurations: [],
      interfaces: (chosen.interfaces ?? []).map((itf) => ({ ...itf, endpoints: itf.endpoints ?? [] })),
    };
    return this.model;
  }

  // Raw descriptors only come back from open() on this transport.
  async readRawDescriptors() {
    return null;
  }

  async open(selection) {
    if (!this.model) throw new Error('No device selected');
    const options = { vendorId: this.model.vendorId, productId: this.model.productId };
    for (const key of ['interfaceId', 'alternateSetting', 'inEndpoint', 'outEndpoint']) {
      if (selection[key] !== undefined && selection[key] !== null) options[key] = selection[key];
    }
    this.log('info', `KatanaUsb.open(${JSON.stringify(options)}) …`);
    let result;
    try {
      result = await this.plugin.open(options);
    } catch (e) {
      throw tagged('open', e);
    }
    return {
      interfaceId: result?.interfaceId,
      alternateSetting: result?.alternateSetting,
      inEndpoint: result?.inEndpoint ?? null,
      outEndpoint: result?.outEndpoint ?? null,
      rawDescriptors: result?.rawDescriptors ?? null,
      setInterfaceOk: result?.setInterfaceOk,
    };
  }

  async send(bytes) {
    const result = await this.plugin.send({ bytes: Array.from(bytes) });
    return result?.written ?? null;
  }

  async close() {
    await this.plugin.close();
  }
}
