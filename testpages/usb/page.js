// UI glue for the USB test page. Protocol logic lives in usb-core.js and ../shared/katana.js,
// the two transports (WebUSB, native plugin) in transports.js.

import {
  ADDR,
  MODEL_CODE_KATANA_100,
  PATCH_NAME_LENGTH,
  PATCH_OFFSET,
  PATCH_SLOT_NAMES,
  SIZE,
  USB_IDS,
  addOffset,
  decodeAscii,
  decodeNibbles,
  hex,
  parseHex,
  toLinear,
} from '../shared/katana.js';
import {
  EXPECTED_IDENTITY_PREFIX,
  GuardedValue,
  KatanaLink,
  analyzeRangeRead,
  checkIdentity,
  describeError,
  describeInterfaces,
  hex2,
  hex4,
  parseRawDescriptors,
  pickInterface,
  usableEndpoints,
} from './usb-core.js';
import { NativeTransport, WebUsbTransport, findNativePlugin } from './transports.js';

const $ = (id) => document.getElementById(id);
const now = () => performance.now();

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

const MAX_DOM_LINES = 3000;
const logLines = [];

function timestamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function log(text, cls = 'info') {
  const full = `[${timestamp()}] ${text}`;
  logLines.push(full);
  const box = $('log');
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = full;
  box.appendChild(line);
  while (box.childElementCount > MAX_DOM_LINES) box.firstElementChild.remove();
  if (stick) box.scrollTop = box.scrollHeight;
}
// Core modules log as (cls, text).
const coreLog = (cls, text) => log(text, cls);
window.katanaReportError = (text) => log(text, 'err');

function logHexDump(bytes, indent = '  ') {
  for (let i = 0; i < bytes.length; i += 16) {
    log(`${indent}${i.toString(16).padStart(4, '0').toUpperCase()}: ${hex(bytes.slice(i, i + 16))}`);
  }
}

function setStatus(id, text, cls = 'info') {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${cls}`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  transport: null,
  model: null, // selected device in the common model
  pick: null, // result of pickInterface
  open: false,
  identity: null, // result of checkIdentity for the last reply
  override: false, // "enable writing anyway"
  connectedAt: null,
  disconnects: 0,
  pollsOk: 0,
  pollsFailed: 0,
  lastRxAt: null,
  measuring: false,
  keepAliveTimer: null,
  rereadTimer: null,
  wakeLock: null,
};

const link = new KatanaLink({
  log: coreLog,
  write: async (packets, message) => {
    if (!state.open || !state.transport) throw new Error('Not connected');
    if (!state.measuring && $('chkRaw').checked) log(`→ raw OUT (${packets.length} bytes): ${hex(packets)}`, 'out');
    const written = await state.transport.send(packets);
    if (typeof written === 'number' && written !== packets.length) {
      log(`Short write: ${written} of ${packets.length} bytes (message of ${message.length} bytes).`, 'err');
    }
  },
});

function canWrite() {
  if (!state.open || !state.identity) return false;
  return state.identity.isKatana100 || state.override;
}

// ---------------------------------------------------------------------------
// Rehearsal controls
// ---------------------------------------------------------------------------

const controls = [
  { id: 'ns', label: 'NS threshold', offset: PATCH_OFFSET.nsThreshold },
  { id: 'gain', label: 'Amp gain', offset: PATCH_OFFSET.ampGain },
  { id: 'vol', label: 'Amp volume', offset: PATCH_OFFSET.ampVolume },
].map((c) => {
  const address = addOffset(ADDR.currentPatch, c.offset);
  return { ...c, address, linear: toLinear(address), guard: new GuardedValue({ min: 0, max: 100, holdMs: 300 }) };
});

function buildControls() {
  const host = $('controls');
  for (const c of controls) {
    const root = document.createElement('div');
    root.className = 'ctl';
    root.innerHTML = `
      <div class="ctlhead"><span></span><output>–</output></div>
      <div class="strip"><div class="fill"></div><span class="hint">drag sideways</span></div>
      <div class="steps">
        <button data-step="-5">−5</button><button data-step="-1">−1</button>
        <button data-step="1">+1</button><button data-step="5">+5</button>
      </div>`;
    root.querySelector('.ctlhead span').textContent = `${c.label}  (${hex(c.address)})`;
    c.output = root.querySelector('output');
    c.fill = root.querySelector('.fill');
    c.strip = root.querySelector('.strip');
    c.buttons = [...root.querySelectorAll('button')];
    host.appendChild(root);

    for (const button of c.buttons) {
      button.addEventListener('click', () => {
        if (!controlUsable(c)) return;
        const value = c.guard.userStep(Number(button.dataset.step), now());
        if (value !== null) pushControl(c, value);
      });
    }

    // Relative drag only: the value changes by the distance dragged, never to the tap position.
    let drag = null;
    c.strip.addEventListener('pointerdown', (e) => {
      if (!controlUsable(c)) return;
      drag = { pointerId: e.pointerId, startX: e.clientX, startValue: c.guard.value, width: Math.max(100, c.strip.clientWidth), last: c.guard.value };
      c.guard.beginDrag(now());
      c.strip.classList.add('dragging');
      try { c.strip.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    });
    c.strip.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (!controlUsable(c)) return;
      const range = c.guard.max - c.guard.min;
      const wanted = c.guard.clamp(drag.startValue + ((e.clientX - drag.startX) / drag.width) * range);
      if (wanted === drag.last) return;
      drag.last = wanted;
      pushControl(c, c.guard.userSet(wanted, now()));
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      drag = null;
      c.guard.endDrag(now());
      c.strip.classList.remove('dragging');
    };
    c.strip.addEventListener('pointerup', endDrag);
    c.strip.addEventListener('pointercancel', endDrag);
    c.strip.addEventListener('lostpointercapture', endDrag);
  }
}

function controlUsable(c) {
  return canWrite() && c.guard.value !== null;
}

function pushControl(c, value) {
  renderControl(c);
  link.writeLatest(c.address, [value], c.label);
}

function renderControl(c) {
  const v = c.guard.value;
  c.output.textContent = v === null ? '–' : String(v);
  const share = v === null ? 0 : (Math.min(c.guard.max, Math.max(c.guard.min, v)) - c.guard.min) / (c.guard.max - c.guard.min);
  c.fill.style.width = `${share * 100}%`;
  const usable = controlUsable(c);
  for (const b of c.buttons) b.disabled = !usable;
  c.strip.style.opacity = usable ? '1' : '.4';
}

function invalidateControls() {
  link.clearWrites();
  for (const c of controls) {
    c.guard.invalidate();
    renderControl(c);
  }
}

// DT1 the amp sent on its own: update every control whose address lies inside the block.
function applyUnsolicitedToControls(msg) {
  for (const c of controls) {
    const index = c.linear - msg.linearAddress;
    if (index < 0 || index >= msg.data.length) continue;
    const applied = c.guard.applyRemote(msg.data[index], now());
    log(`${c.label}: amp reports ${msg.data[index]}${applied ? '' : ' (ignored, control was touched within the last 300 ms)'}`, 'info');
    renderControl(c);
  }
}

async function readControlValues() {
  if (!state.open) return;
  const [ns, gain, vol] = controls;
  try {
    const r = await link.request(gain.address, 2, { note: 'amp gain + volume' });
    if (r.data.length >= 2 && r.linearAddress === gain.linear) {
      gain.guard.setFromAmp(r.data[0]);
      vol.guard.setFromAmp(r.data[1]);
      log(`Amp gain = ${r.data[0]}, amp volume = ${r.data[1]} (${r.ms.toFixed(1)} ms)`, 'ok');
    } else {
      log(`Unexpected reply for gain/volume: address ${hex(r.address)}, data ${hex(r.data)}`, 'err');
    }
  } catch (e) {
    log(`Reading gain/volume failed: ${describeError(e)}`, 'err');
  }
  try {
    const r = await link.request(ns.address, 1, { note: 'NS threshold' });
    if (r.data.length >= 1 && r.linearAddress === ns.linear) {
      ns.guard.setFromAmp(r.data[0]);
      log(`NS threshold = ${r.data[0]} (${r.ms.toFixed(1)} ms)`, 'ok');
    } else {
      log(`Unexpected reply for NS threshold: address ${hex(r.address)}, data ${hex(r.data)}`, 'err');
    }
  } catch (e) {
    log(`Reading NS threshold failed: ${describeError(e)}`, 'err');
  }
  refresh();
}

// ---------------------------------------------------------------------------
// Incoming messages
// ---------------------------------------------------------------------------

link.onDt1 = (msg, { solicited }) => {
  if (solicited) return;
  if (msg.linearAddress === toLinear(ADDR.patchNumber)) {
    const index = decodeNibbles(msg.data);
    log(`Amp reports a patch change to index ${index} (${PATCH_SLOT_NAMES[index] ?? 'unknown'}). Pending writes dropped, values are read again in 500 ms.`, 'info');
    invalidateControls();
    clearTimeout(state.rereadTimer);
    state.rereadTimer = setTimeout(() => { if (state.open) readBasics(); }, 500);
    return;
  }
  applyUnsolicitedToControls(msg);
};

link.onIdentity = (msg, { solicited, cable }) => {
  if (!solicited) log(`Identity reply without a pending request (cable ${cable}).`, 'info');
  link.deviceId = msg.deviceId;
};

function onTransportData(bytes) {
  state.lastRxAt = now();
  if (!state.measuring && $('chkRaw').checked) log(`← raw IN (${bytes.length} bytes): ${hex(bytes)}`, 'in');
  link.feed(bytes);
}

function onTransportDisconnect(reason) {
  state.disconnects++;
  log(`DISCONNECTED (${reason}). Disconnect number ${state.disconnects}${state.connectedAt === null ? '' : ` after ${formatDuration(now() - state.connectedAt)} connected`}.`, 'err');
  markClosed('device disconnected');
  if (state.transport?.kind === 'webusb') setStatus('openInfo', 'Disconnected. Plug the amp back in, then tap Open (or select the device again).', 'err');
  else setStatus('openInfo', 'Disconnected. Plug the amp back in, then select the device and tap Open.', 'err');
}

function markClosed(reason) {
  state.open = false;
  state.connectedAt = null;
  state.identity = null;
  state.override = false;
  clearTimeout(state.rereadTimer);
  link.reset(reason);
  invalidateControls();
  refresh();
}

// ---------------------------------------------------------------------------
// Step 1 + 2: select device, dump descriptors
// ---------------------------------------------------------------------------

async function selectDevice(anyDevice) {
  try {
    if (state.open) await closeDevice();
    const model = await state.transport.selectDevice({ anyDevice });
    if (!model) {
      state.model = null;
      setStatus('deviceInfo', 'No device selected.', 'err');
      refresh();
      return;
    }
    state.model = model;
    const isKatana = model.vendorId === USB_IDS.vendorId && model.productId === USB_IDS.productId;
    setStatus('deviceInfo', `${hex4(model.vendorId)}:${hex4(model.productId)} ${model.manufacturerName} ${model.productName}`.trim()
      + (isKatana ? '' : '  (not the expected Katana IDs)'), isKatana ? 'ok' : 'err');
    log(`Selected device ${hex4(model.vendorId)}:${hex4(model.productId)} "${model.manufacturerName}" "${model.productName}"`
      + `${isKatana ? ' = expected Katana Gen 3 IDs' : ` (expected ${hex4(USB_IDS.vendorId)}:${hex4(USB_IDS.productId)})`}`, isKatana ? 'ok' : 'err');
    await dumpDescriptors();
  } catch (e) {
    log(`Select device: ${describeError(e)}`, 'err');
  }
  refresh();
}

async function dumpDescriptors() {
  const model = state.model;
  if (!model) return;
  log('---- Descriptors ----');
  log(`Device class/subclass/protocol: ${hex2(model.deviceClass)}/${hex2(model.deviceSubclass)}/${hex2(model.deviceProtocol)}`
    + `${model.usbVersion ? `, USB ${model.usbVersion}` : ''}${model.serialNumber ? `, serial "${model.serialNumber}"` : ''}`
    + `${model.deviceName ? `, ${model.deviceName}` : ''}${model.hasPermission === undefined ? '' : `, permission=${model.hasPermission}`}`);
  if (model.configurations.length > 0) {
    for (const config of model.configurations) {
      log(`Configuration ${config.value}${config.name ? ` "${config.name}"` : ''}${config.value === model.activeConfiguration ? ' (active)' : ''}: ${config.interfaces.length} interface/alt entries`);
      for (const line of describeInterfaces(config.interfaces)) log(`  ${line}`);
    }
  } else {
    for (const line of describeInterfaces(model.interfaces)) log(`  ${line}`);
    if (model.interfaces.length === 0) log('  The device model lists no interfaces.', 'err');
  }

  let raw = null;
  try {
    raw = await state.transport.readRawDescriptors();
  } catch (e) {
    log(`Reading raw descriptors failed: ${describeError(e)}`, 'err');
    if (state.transport.kind === 'webusb') {
      log('If device.open() fails on Android Chrome, the descriptor list above (from the browser) is still valid. Try Open anyway; otherwise the next step is the test APK.', 'info');
    }
  }
  if (raw) dumpRawDescriptors(raw);
  else if (state.transport.kind === 'native') log('Raw descriptors are printed after Open on the native transport.');

  updatePick();
}

function dumpRawDescriptors(raw) {
  const bytes = Array.from(raw);
  log(`Raw descriptors (${bytes.length} bytes):`);
  logHexDump(bytes);
  const parsed = parseRawDescriptors(bytes);
  log('Decoded:');
  for (const line of parsed.lines) log(`  ${line}`);
  if (parsed.error) log(parsed.error, 'err');
  if (parsed.roland.length > 0) {
    for (const r of parsed.roland) {
      log(`Roland MIDI descriptor found on interface ${r.interfaceId} alt ${r.alternateSetting}: ${hex(r.bytes)}. This is what the Linux Roland quirk looks for, so this interface should carry MIDI.`, 'ok');
    }
  } else {
    log('No Roland descriptor (06 24 F1 02 …) found in the raw descriptors.', 'info');
  }
  // Fall back to the raw descriptors when the transport reported no interfaces.
  if (state.model && state.model.interfaces.length === 0 && parsed.configurations[0]?.interfaces.length > 0) {
    log('Using the interface list decoded from the raw descriptors.', 'info');
    state.model.interfaces = parsed.configurations[0].interfaces;
    updatePick();
  }
  return parsed;
}

function updatePick() {
  const interfaces = state.model?.interfaces ?? [];
  state.pick = pickInterface(interfaces);
  if (state.pick) {
    log(`Auto-pick: interface ${state.pick.interfaceId} alt ${state.pick.alternateSetting}, IN ${hex2(state.pick.inEndpoint.address)}, OUT ${hex2(state.pick.outEndpoint.address)} (${state.pick.reason})`, 'ok');
    const others = state.pick.candidates.slice(1);
    if (others.length > 0) {
      log(`Other candidates: ${others.map((c) => `interface ${c.interfaceId} alt ${c.alternateSetting} (IN ${hex2(c.inEndpoint.address)}, OUT ${hex2(c.outEndpoint.address)})`).join('; ')}`);
    }
  } else if (interfaces.length > 0) {
    log('Auto-pick: no interface has both a bulk/interrupt IN and OUT endpoint. Choose manually.', 'err');
  }
  populateSelectors();
}

// ---------------------------------------------------------------------------
// Interface / endpoint dropdowns
// ---------------------------------------------------------------------------

function setOptions(select, options, keep) {
  select.replaceChildren(...options.map(([value, text]) => {
    const o = document.createElement('option');
    o.value = String(value);
    o.textContent = text;
    return o;
  }));
  if (keep !== undefined && options.some(([value]) => String(value) === String(keep))) select.value = String(keep);
}

function populateSelectors() {
  const interfaces = state.model?.interfaces ?? [];
  const ids = [...new Set(interfaces.map((i) => i.id))];
  const pickText = state.pick ? `Auto (interface ${state.pick.interfaceId} alt ${state.pick.alternateSetting})`
    : (state.transport?.kind === 'native' ? 'Auto (plugin decides)' : 'Auto (nothing suitable)');
  setOptions($('selItf'), [['auto', pickText], ...ids.map((id) => {
    const first = interfaces.find((i) => i.id === id);
    return [id, `${id}: class ${hex2(first.interfaceClass)}`];
  })], $('selItf').value);
  populateAlt();
}

function populateAlt() {
  const interfaces = state.model?.interfaces ?? [];
  const manual = $('selItf').value !== 'auto';
  for (const id of ['selAlt', 'selIn', 'selOut']) $(id).disabled = !manual;
  if (!manual) {
    for (const id of ['selAlt', 'selIn', 'selOut']) setOptions($(id), [['auto', 'Auto']]);
    return;
  }
  const itfId = Number($('selItf').value);
  const alts = interfaces.filter((i) => i.id === itfId);
  setOptions($('selAlt'), alts.map((a) => [a.alternateSetting, `${a.alternateSetting}: ${a.endpoints.length} endpoint(s)`]), $('selAlt').value);
  populateEndpoints();
}

function populateEndpoints() {
  const entry = selectedEntry();
  for (const [id, direction] of [['selIn', 'in'], ['selOut', 'out']]) {
    const eps = (entry?.endpoints ?? []).filter((ep) => ep.direction === direction);
    setOptions($(id), [['auto', 'Auto'], ...eps.map((ep) => [ep.address, `${hex2(ep.address)} ${ep.type} ${ep.maxPacketSize}`])], $(id).value);
  }
}

function selectedEntry() {
  const itfId = Number($('selItf').value);
  const alt = Number($('selAlt').value);
  return (state.model?.interfaces ?? []).find((i) => i.id === itfId && i.alternateSetting === alt) ?? null;
}

// Returns the selection for transport.open(), or throws with a readable message.
function resolveSelection() {
  if ($('selItf').value === 'auto') {
    if (state.transport.kind === 'native') return {}; // the plugin picks
    if (!state.pick) throw new Error('No suitable interface found automatically. Choose interface, alternate setting and endpoints by hand.');
    return {
      interfaceId: state.pick.interfaceId,
      alternateSetting: state.pick.alternateSetting,
      inEndpoint: state.pick.inEndpoint.address,
      outEndpoint: state.pick.outEndpoint.address,
    };
  }
  const entry = selectedEntry();
  if (!entry) throw new Error('Selected interface/alternate setting not found.');
  const choose = (selectId, direction) => {
    const value = $(selectId).value;
    if (value !== 'auto') return Number(value);
    const ep = usableEndpoints(entry, direction)[0];
    if (!ep) throw new Error(`Interface ${entry.id} alt ${entry.alternateSetting} has no bulk/interrupt ${direction.toUpperCase()} endpoint.`);
    return ep.address;
  };
  return {
    interfaceId: entry.id,
    alternateSetting: entry.alternateSetting,
    inEndpoint: choose('selIn', 'in'),
    outEndpoint: choose('selOut', 'out'),
  };
}

// ---------------------------------------------------------------------------
// Step 3: open / close
// ---------------------------------------------------------------------------

const describeEndpoint = (ep) => (ep && typeof ep === 'object'
  ? `${hex2(ep.address)} ${ep.type ?? '?'} maxPacket=${ep.maxPacketSize ?? '?'}`
  : String(ep));

async function openDevice() {
  $('btnOpen').disabled = true;
  try {
    if (state.open) await closeDevice();
    const selection = resolveSelection();
    log(`---- Open (${state.transport.kind}) with ${Object.keys(selection).length === 0 ? 'plugin auto-pick' : JSON.stringify(selection)} ----`);
    const info = await state.transport.open(selection);
    state.open = true;
    state.connectedAt = now();
    state.lastRxAt = null;
    link.parser.reset();
    const text = `Open: interface ${info.interfaceId} alt ${info.alternateSetting}, IN ${describeEndpoint(info.inEndpoint)}, OUT ${describeEndpoint(info.outEndpoint)}`;
    log(text, 'ok');
    setStatus('openInfo', text, 'ok');
    if (info.setInterfaceOk === false) log('The plugin reports that setInterface (alternate setting) FAILED; the endpoints may not be active.', 'err');
    else if (info.setInterfaceOk === true) log('Plugin: setInterface ok.', 'ok');
    if (state.pick && Object.keys(selection).length === 0
      && (info.interfaceId !== state.pick.interfaceId || info.alternateSetting !== state.pick.alternateSetting)) {
      log(`Note: the plugin picked a different interface than this page would have (interface ${state.pick.interfaceId} alt ${state.pick.alternateSetting}).`, 'info');
    }
    if (info.rawDescriptors && info.rawDescriptors.length > 0) dumpRawDescriptors(info.rawDescriptors);
    log('Next: send the identity request. If there is no reply, try another cable number, alternate setting or endpoint.');
  } catch (e) {
    log(`Open failed: ${describeError(e)}`, 'err');
    setStatus('openInfo', `Open failed: ${describeError(e)}`, 'err');
    if (state.transport.kind === 'webusb') {
      const cause = e.cause ?? e;
      if (cause?.name === 'SecurityError') {
        log('SecurityError: Chrome blocks WebUSB access to protected interface classes (audio, HID, mass storage …). Pick the vendor-class interface instead.', 'info');
      }
      if (['device.open', 'claimInterface', 'selectConfiguration', 'selectAlternateInterface'].includes(e.step)) {
        log('On Android Chrome this is an expected, informative outcome: the kernel driver probably holds the interface; next step is the test APK (it can claim with force). Please keep this log.', 'info');
      }
      await state.transport.close().catch(() => {});
    }
    state.open = false;
  }
  refresh();
}

async function closeDevice() {
  try {
    await state.transport.close();
    log('Closed.', 'info');
  } catch (e) {
    log(`Close: ${describeError(e)}`, 'err');
  }
  markClosed('closed by user');
  setStatus('openInfo', 'Not open.', 'info');
  setStatus('identityInfo', 'Not asked yet.', 'info');
}

// ---------------------------------------------------------------------------
// Step 4: identity
// ---------------------------------------------------------------------------

async function sendIdentity() {
  $('btnIdentity').disabled = true;
  link.setCable(Number($('selCable').value));
  try {
    const reply = await link.identity();
    const verdict = checkIdentity(reply.message);
    state.identity = verdict;
    state.override = false;
    const cableNote = reply.cable === link.cable ? `on cable ${reply.cable}` : `on cable ${reply.cable} (request was sent on cable ${link.cable})`;
    const text = `${verdict.text} Reply ${cableNote} after ${reply.ms.toFixed(1)} ms.`;
    log(`VERDICT: ${text}`, verdict.isKatana100 ? 'ok' : 'err');
    log(`  expected start: ${hex(EXPECTED_IDENTITY_PREFIX)}`);
    log(`  received:       ${hex(reply.message.bytes)}`);
    setStatus('identityInfo', text, verdict.isKatana100 ? 'ok' : 'err');
  } catch (e) {
    state.identity = null;
    log(`VERDICT: no identity reply (${describeError(e)}). IN transfers so far: ${link.stats.transfers}, bytes: ${link.stats.bytesIn}. Try another cable number, alternate setting or endpoint pair.`, 'err');
    setStatus('identityInfo', `No identity reply: ${describeError(e)}`, 'err');
  }
  refresh();
}

// ---------------------------------------------------------------------------
// Step 5: read
// ---------------------------------------------------------------------------

async function readBasics() {
  if (!state.open) return;
  const parts = [];
  try {
    const r = await link.request(ADDR.editorLevel, 1, { note: 'editor level' });
    const level = r.data[0];
    log(`Editor level = ${level} (${level === 1 ? 'as expected' : 'EXPECTED 1'}; ${r.ms.toFixed(1)} ms)`, level === 1 ? 'ok' : 'err');
    parts.push(`editor level ${level}`);
  } catch (e) {
    log(`Reading the editor level failed: ${describeError(e)}`, 'err');
  }
  let slot = '';
  try {
    const r = await link.request(ADDR.patchNumber, 2, { note: 'patch number' });
    const index = decodeNibbles(r.data);
    slot = PATCH_SLOT_NAMES[index] ?? `index ${index}`;
    log(`Patch number = ${index} (${slot}), raw ${hex(r.data)} (${r.ms.toFixed(1)} ms)`, 'ok');
    parts.push(`patch ${index} = ${slot}`);
  } catch (e) {
    log(`Reading the patch number failed: ${describeError(e)}`, 'err');
  }
  try {
    const r = await link.request(addOffset(ADDR.currentPatch, PATCH_OFFSET.name), PATCH_NAME_LENGTH, { note: 'patch name' });
    const name = decodeAscii(r.data);
    log(`Patch name = "${name}" (${r.data.length} bytes, ${r.ms.toFixed(1)} ms)`, r.data.length === PATCH_NAME_LENGTH ? 'ok' : 'err');
    $('patch').textContent = `${slot ? `${slot}: ` : ''}${name || '(no name)'}`;
  } catch (e) {
    log(`Reading the patch name failed: ${describeError(e)}`, 'err');
  }
  setStatus('readInfo', parts.join(', '), parts.length > 0 ? 'ok' : 'err');
  await readControlValues();
}

async function setEditorMode(on) {
  if (!canWrite()) return;
  try {
    await link.writeDt1(ADDR.editorMode, [on ? 1 : 0], `editor mode ${on ? 'on' : 'off'}`);
    log(`Editor mode ${on ? 'on' : 'off'} sent.`, 'ok');
  } catch (e) {
    log(`Editor mode: ${describeError(e)}`, 'err');
  }
}

async function customRead() {
  let address;
  let size;
  try {
    address = parseHex($('addr').value);
    size = parseHex($('size').value);
    if (address.length !== 4 || size.length !== 4) throw new Error('Address and size need 4 bytes each');
  } catch (e) {
    log(`Custom read: ${describeError(e)}`, 'err');
    return;
  }
  try {
    const r = await link.request(address, size, { range: true, note: 'custom read' });
    const a = analyzeRangeRead(r.blocks, r.sentAt);
    log(`Custom read: ${a.count} DT1, ${a.dataBytes} data bytes, last reply after ${a.totalMs.toFixed(1)} ms.`, 'ok');
    for (const b of r.blocks) log(`  ${hex(b.address)}: ${hex(b.data)}  = decimal ${b.data.join(', ')}`, 'in');
  } catch (e) {
    log(`Custom read: ${describeError(e)}`, 'err');
  }
}

// ---------------------------------------------------------------------------
// Step 6: timing
// ---------------------------------------------------------------------------

async function measurePatchRead() {
  $('btnMeasure').disabled = true;
  log(`---- Full patch read: RQ1 ${hex(ADDR.currentPatch)} size ${hex(SIZE.patch)} (per-message logging paused) ----`);
  state.measuring = true;
  link.quiet = true;
  const statsBefore = { ...link.stats };
  try {
    const r = await link.request(ADDR.currentPatch, SIZE.patch, { range: true, note: 'full patch' });
    const a = analyzeRangeRead(r.blocks, r.sentAt);
    const seconds = (a.totalMs / 1000).toFixed(3);
    const summary = `${a.count} DT1, ${a.dataBytes} data bytes, ${seconds} s until the last block (first reply after ${a.firstReplyMs.toFixed(1)} ms)`;
    const asExpected = a.count === 80 && a.dataBytes === 2649;
    log(`RESULT: ${summary}.`, asExpected ? 'ok' : 'err');
    log(`  Expected on the PC: 80 DT1, 2649 data bytes, 0.27 s.${asExpected ? ' Counts match.' : ' Counts DIFFER.'}`);
    log(`  Block addresses ascending: ${a.ascending ? 'yes' : `no (${a.outOfOrder} block(s) arrived after a higher address)`}; duplicates: ${a.duplicates}; longest block: ${a.maxDataLength} data bytes.`);
    log(`  USB transfers during the read: ${link.stats.transfers - statsBefore.transfers}, bytes in: ${link.stats.bytesIn - statsBefore.bytesIn}.`);
    log(`  Arrival order (address:length): ${r.blocks.map((b) => `${hex(b.address).replaceAll(' ', '')}:${b.data.length}`).join(' ')}`);
    setStatus('timingInfo', `${summary}. Ascending: ${a.ascending ? 'yes' : 'no'}. Expected on the PC: 80 DT1, 2649 bytes, 0.27 s.`, asExpected ? 'ok' : 'err');
  } catch (e) {
    log(`Full patch read failed: ${describeError(e)}`, 'err');
    setStatus('timingInfo', `Failed: ${describeError(e)}`, 'err');
  } finally {
    link.quiet = false;
    state.measuring = false;
  }
  refresh();
}

// ---------------------------------------------------------------------------
// Step 8: stability
// ---------------------------------------------------------------------------

function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderStability() {
  $('stConnected').textContent = state.open && state.connectedAt !== null ? formatDuration(now() - state.connectedAt) : 'not connected';
  $('stDisconnects').textContent = String(state.disconnects);
  $('stPolls').textContent = `${state.pollsOk} ok, ${state.pollsFailed} without reply${$('chkKeepAlive').checked ? '' : ' (off)'}`;
  $('stLastRx').textContent = state.lastRxAt === null ? '–' : `${((now() - state.lastRxAt) / 1000).toFixed(0)} s ago`;
  $('stTraffic').textContent = `${link.stats.transfers} / ${link.stats.bytesIn}`;
}

async function keepAlivePoll() {
  if (!state.open || state.measuring) return;
  try {
    const reply = await link.identity({ note: 'keep-alive poll' });
    state.pollsOk++;
    log(`Keep-alive ok (${reply.ms.toFixed(1)} ms), connected for ${formatDuration(now() - (state.connectedAt ?? now()))}.`, 'ok');
  } catch (e) {
    state.pollsFailed++;
    log(`Keep-alive poll got NO REPLY: ${describeError(e)}${state.connectedAt === null ? '' : ` (connected for ${formatDuration(now() - state.connectedAt)})`}`, 'err');
  }
  renderStability();
}

function toggleKeepAlive() {
  clearInterval(state.keepAliveTimer);
  state.keepAliveTimer = null;
  if ($('chkKeepAlive').checked) {
    state.keepAliveTimer = setInterval(keepAlivePoll, 10000);
    log('Keep-alive poll on: identity request every 10 s while connected. Note: a browser tab in the background may be throttled.', 'info');
  } else {
    log('Keep-alive poll off.', 'info');
  }
  renderStability();
}

async function updateWakeLock() {
  const wanted = $('chkWake').checked;
  try {
    if (wanted && !state.wakeLock) {
      if (!navigator.wakeLock) throw new Error('Screen wake lock is not supported here');
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
      log('Screen wake lock active.', 'info');
    } else if (!wanted && state.wakeLock) {
      await state.wakeLock.release();
      state.wakeLock = null;
      log('Screen wake lock released.', 'info');
    }
  } catch (e) {
    log(`Wake lock: ${describeError(e)}`, 'err');
  }
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

function refresh() {
  const hasTransport = !!state.transport;
  const hasDevice = !!state.model;
  $('btnSelect').disabled = !hasTransport;
  $('btnSelectAny').disabled = !hasTransport;
  $('btnDump').disabled = !hasDevice;
  $('secOpen').classList.toggle('disabled', !hasDevice);
  $('btnOpen').disabled = !hasDevice;
  $('btnClose').disabled = !state.open;
  for (const id of ['secIdentity', 'secRead', 'secTiming', 'secSliders', 'secStability']) {
    $(id).classList.toggle('disabled', !state.open);
  }
  $('btnIdentity').disabled = !state.open;
  $('btnMeasure').disabled = !state.open || state.measuring;

  const writable = canWrite();
  $('btnEditorOn').disabled = !writable;
  $('btnEditorOff').disabled = !writable;
  $('btnOverride').hidden = !(state.open && state.identity && !state.identity.isKatana100 && !state.override);
  if (!state.identity) {
    setStatus('writeInfo', 'Writing is disabled until the identity reply was verified (section 3).', 'info');
  } else if (state.identity.isKatana100) {
    setStatus('writeInfo', 'Writing enabled: KATANA-100 verified.', 'ok');
  } else if (state.override) {
    setStatus('writeInfo', `Writing enabled by hand although the model code is ${state.identity.modelCode === null ? 'unknown' : hex2(state.identity.modelCode)}, not ${hex2(MODEL_CODE_KATANA_100)}.`, 'err');
  } else {
    setStatus('writeInfo', `WARNING: this is not a verified KATANA-100 (${state.identity.text}) Writing stays disabled; addresses may mean something else on this device.`, 'err');
  }
  for (const c of controls) renderControl(c);
  renderStability();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function start() {
  buildControls();
  setOptions($('selCable'), Array.from({ length: 16 }, (_, i) => [i, `${i}${i === 0 ? ' (default)' : ''}`]));

  log('Katana Studio – USB test');
  log(`User agent: ${navigator.userAgent}`);
  log(`Location: ${location.origin}${location.pathname}, secure context: ${window.isSecureContext}`);
  const cap = window.Capacitor;
  log(`Capacitor: ${cap ? `present, native platform: ${!!cap.isNativePlatform?.()}, platform: ${cap.getPlatform?.() ?? '?'}` : 'not present'}; navigator.usb: ${navigator.usb ? 'present' : 'missing'}`);

  const transportLog = coreLog;
  try {
    const plugin = findNativePlugin();
    if (plugin) {
      state.transport = new NativeTransport({ log: transportLog, plugin });
      $('btnSelect').textContent = 'List devices / select Katana';
    } else if (cap?.isNativePlatform?.()) {
      log('Running inside the app, but the KatanaUsb plugin was not found in window.Capacitor.Plugins.', 'err');
      setStatus('transportInfo', 'Native app without the KatanaUsb plugin: cannot test.', 'err');
    } else if (WebUsbTransport.available()) {
      state.transport = new WebUsbTransport({ log: transportLog });
    } else {
      const why = window.isSecureContext
        ? 'This browser has no WebUSB. Use Chrome (Android or desktop), or the test APK.'
        : 'WebUSB needs https or localhost. Open the page from GitHub Pages or via localhost.';
      log(why, 'err');
      setStatus('transportInfo', why, 'err');
    }
  } catch (e) {
    log(`Transport setup failed: ${describeError(e)}`, 'err');
    setStatus('transportInfo', `Transport setup failed: ${describeError(e)}`, 'err');
  }

  if (state.transport) {
    state.transport.onData = onTransportData;
    state.transport.onDisconnect = onTransportDisconnect;
    state.transport.onAttach = (info) => log(`USB device attached: ${info}. ${state.open ? '' : 'Select the device / tap Open to connect.'}`, 'info');
    setStatus('transportInfo', `Transport: ${state.transport.label}`, 'ok');
    log(`Transport: ${state.transport.label}`, 'ok');
  }

  $('btnSelect').addEventListener('click', () => selectDevice(false));
  $('btnSelectAny').addEventListener('click', () => selectDevice(true));
  $('btnDump').addEventListener('click', () => dumpDescriptors().catch((e) => log(`Dump: ${describeError(e)}`, 'err')));
  $('selItf').addEventListener('change', populateAlt);
  $('selAlt').addEventListener('change', populateEndpoints);
  $('btnOpen').addEventListener('click', openDevice);
  $('btnClose').addEventListener('click', closeDevice);
  $('selCable').addEventListener('change', () => {
    link.setCable(Number($('selCable').value));
    log(`Cable number for outgoing packets: ${link.cable}`);
  });
  $('btnIdentity').addEventListener('click', sendIdentity);
  $('btnRead').addEventListener('click', readBasics);
  $('btnEditorOn').addEventListener('click', () => setEditorMode(true));
  $('btnEditorOff').addEventListener('click', () => setEditorMode(false));
  $('btnCustom').addEventListener('click', customRead);
  $('btnMeasure').addEventListener('click', measurePatchRead);
  $('btnReadValues').addEventListener('click', readControlValues);
  $('btnOverride').addEventListener('click', () => {
    state.override = true;
    log('Writing enabled by hand for a device that is not a verified KATANA-100.', 'err');
    refresh();
  });
  $('chkKeepAlive').addEventListener('change', toggleKeepAlive);
  $('chkWake').addEventListener('change', updateWakeLock);
  document.addEventListener('visibilitychange', () => {
    log(`Page is now ${document.visibilityState}.`, 'info');
    if (document.visibilityState === 'visible') updateWakeLock();
  });

  $('btnClear').addEventListener('click', () => {
    logLines.length = 0;
    $('log').replaceChildren();
  });
  $('btnCopy').addEventListener('click', copyLog);

  setInterval(renderStability, 1000);
  refresh();
  window.katanaPageReady = true;
}

async function copyLog() {
  const text = logLines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    log(`Log copied (${logLines.length} lines).`, 'ok');
    return;
  } catch (e) {
    // Fall through to the legacy way (some WebViews have no async clipboard).
    void e;
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('execCommand returned false');
    log(`Log copied (${logLines.length} lines).`, 'ok');
  } catch (e) {
    log(`Copy failed: ${describeError(e)}. Select the log text by hand instead.`, 'err');
  }
}

start();
