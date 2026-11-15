// Katana capture tool: Web MIDI glue and DOM. The logic lives in recorder.js, requests.js,
// snapshot.js, export.js and describe.js (tested with node --test).

import {
  ADDR, SIZE, PATCH_OFFSET, PATCH_NAME_LENGTH, PATCH_SLOT_NAMES, IDENTITY_REQUEST, BROADCAST_DEVICE_ID,
  MODEL_CODE_KATANA_100,
  addOffset, buildDt1, decodeAscii, decodeNibbles, encodeNibbles, hex, parseHex, parseMessage,
  sendIntervalMs, storedPatchAddress, toLinear,
} from '../shared/katana.js';
import { Recorder } from './recorder.js';
import { RequestManager, formatResult } from './requests.js';
import { compareRelative, diffSnapshots, markReported, snapshotFromBlocks } from './snapshot.js';
import { buildExport, exportFileName, sessionToText } from './export.js';
import { describeAddress, describeEvent } from './describe.js';
import { EXPERIMENTS, PRESET_MARKERS } from './experiments.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_DEVICE_ID = 0x10; // seen in the identity reply; replaced by the real one on connect
const SYSTEM_READ_SIZE = [0x00, 0x01, 0x00, 0x00]; // generous; the amp skips gaps
const COMMAND_DUMP_SIZE = 16;
const MAX_LOG_LINES = 500;
const MAX_BYTES_ON_SCREEN = 28;
const REPLIES_SHOWN_PER_REQUEST = 8;
const MAX_DIFF_ROWS = 300;
const NOTES_KEY = 'katana-capture-notes-v1';

// ---- State ----

let midi = null;
let input = null;
let output = null;
let deviceId = DEFAULT_DEVICE_ID;
let identity = null; // parsed identity reply
let identityWaiter = null;
let lastPatchIndex = null;
let unsolicitedCount = 0;
let dirty = false; // unexported events

let snapshotA = null; // { scope, map }
let unsolicitedSinceA = [];

let repliesInRun = 0;
let hiddenReplies = 0;

const recorder = new Recorder();
recorder.onEvent = () => { dirty = true; };

const requests = new RequestManager({
  send: (bytes) => sendRaw(bytes),
  getDeviceId: () => deviceId,
  now: () => recorder.now(),
});

// ---- Log (capped, flushed in batches so a 26 kB dump does not freeze the page) ----

let pendingLines = [];
let flushScheduled = false;

function queueLine(text, cls) {
  pendingLines.push({ text, cls });
  if (pendingLines.length > MAX_LOG_LINES) pendingLines = pendingLines.slice(-MAX_LOG_LINES);
  if (!flushScheduled) {
    flushScheduled = true;
    setTimeout(flushLog, 60); // a timer, not requestAnimationFrame: it also runs while the tab is hidden
  }
}

function flushLog() {
  flushScheduled = false;
  const log = $('log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const fragment = document.createDocumentFragment();
  for (const { text, cls } of pendingLines) {
    const line = document.createElement('div');
    line.className = cls;
    line.textContent = text;
    fragment.appendChild(line);
  }
  pendingLines = [];
  log.appendChild(fragment);
  while (log.childElementCount > MAX_LOG_LINES) log.firstElementChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
  updateCounters();
}

function shortenBytes(hexString) {
  const count = (hexString.length + 1) / 3;
  if (count <= MAX_BYTES_ON_SCREEN) return hexString;
  return `${hexString.slice(0, MAX_BYTES_ON_SCREEN * 3 - 1)} … (${count} bytes)`;
}

function showEvent(event) {
  const time = event.t.toFixed(1).padStart(9);
  if (event.dir === 'marker') {
    queueLine(`${time} ## ${event.text}`, 'marker');
    return;
  }
  const arrow = event.dir === 'in' ? '←' : '→';
  const cls = event.reply === false ? 'uns' : event.dir;
  queueLine(`${time} ${arrow} ${shortenBytes(event.bytes)}\n            ${describeEvent(event)}`, cls);
}

function localLine(text, cls = 'local') {
  queueLine(`          ${text}`, cls);
}

function updateCounters() {
  const c = recorder.counts();
  $('counters').textContent =
    `recorded: ${c.in} in, ${c.out} out, ${c.marker} markers · unsolicited DT1: ${unsolicitedCount} · ` +
    `not recorded: ${recorder.filtered.activeSensing} active sensing, ${recorder.filtered.clock} clock`;
}

function setStatus(text, cls) {
  $('status').textContent = text;
  $('status').className = cls;
}

// ---- Recording wrappers ----

function addMarker(text) {
  const event = recorder.addMarker(text);
  if (event) showEvent(event);
}

// Notes written by the tool itself; part of the recording like user markers.
const toolNote = (text) => addMarker(`[tool] ${text}`);

// ---- Sending (paced like BTS: 20 ms plus length / 3.125 ms between messages) ----

let sendChain = Promise.resolve();

// Resolves with the session time at which the message was handed to the port.
function sendRaw(bytes) {
  const sent = sendChain.then(() => {
    if (!output) throw new Error('Not connected');
    const t = recorder.now();
    output.send(bytes);
    const event = recorder.addMessage('out', bytes, { t });
    if (event) showEvent(event);
    return t;
  });
  sendChain = sent.then(() => sleep(sendIntervalMs(bytes.length)), () => {});
  return sent;
}

const sendDt1 = (address, data) => sendRaw(buildDt1(deviceId, address, data));

// ---- Receiving ----

function onMidiMessage(e) {
  const bytes = Array.from(e.data);
  const t = e.timeStamp > 0 ? recorder.toSessionTime(e.timeStamp) : recorder.now();
  const parsed = parseMessage(bytes);

  let reply;
  if (parsed.type === 'dt1') {
    const fromOurAmp = parsed.deviceId === deviceId || parsed.deviceId === BROADCAST_DEVICE_ID;
    reply = fromOurAmp && requests.handleDt1(parsed, t);
    if (!reply) {
      unsolicitedCount++;
      if (snapshotA) unsolicitedSinceA.push({ linearAddress: parsed.linearAddress, data: parsed.data });
      if (parsed.linearAddress === toLinear(ADDR.patchNumber) && parsed.data.length === 2) {
        lastPatchIndex = decodeNibbles(parsed.data);
      }
    }
  }

  const event = recorder.addMessage('in', bytes, { t, reply });
  if (!event) return; // active sensing or clock: only counted

  if (reply === true) {
    repliesInRun++;
    if ($('chkCollapse').checked && repliesInRun > REPLIES_SHOWN_PER_REQUEST) hiddenReplies++;
    else showEvent(event);
  } else {
    showEvent(event);
  }

  if (parsed.type === 'identity' && identityWaiter) {
    identityWaiter(parsed);
    identityWaiter = null;
  }
}

// ---- Connection ----

function setConnected(connected) {
  for (const el of document.querySelectorAll('[data-conn]')) el.disabled = !connected;
  if (connected) $('btnSnapB').disabled = snapshotA === null;
  updateWriteLock();
}

function updateWriteLock() {
  $('writeControls').disabled = !(output && $('chkBackup').checked);
}

async function connect() {
  if (!navigator.requestMIDIAccess) return setStatus('This browser does not support Web MIDI. Please use Chrome.', 'err');
  if (!window.isSecureContext) return setStatus('This page needs https or localhost.', 'err');
  try {
    midi = await navigator.requestMIDIAccess({ sysex: true });
  } catch (error) {
    return setStatus(`MIDI access denied: ${error.message}`, 'err');
  }
  midi.onstatechange = onStateChange;

  if (input) input.onmidimessage = null;
  requests.cancelAll('Reconnecting');
  input = [...midi.inputs.values()].find((p) => /katana/i.test(p.name)) ?? null;
  output = [...midi.outputs.values()].find((p) => /katana/i.test(p.name)) ?? null;
  if (!input || !output) {
    input = output = null;
    setConnected(false);
    return setStatus('Katana not found. USB connected, amp on, BOSS Tone Studio closed?', 'err');
  }
  input.onmidimessage = onMidiMessage;
  toolNote(`connected to MIDI port "${input.name}"`);
  setStatus('Asking for identity …', 'info');

  identity = null;
  const reply = new Promise((resolve) => {
    identityWaiter = resolve;
    setTimeout(() => resolve(null), 1500);
  });
  try {
    await sendRaw(IDENTITY_REQUEST);
  } catch (error) {
    return setStatus(`Send failed: ${error.message}`, 'err');
  }
  identity = await reply;
  identityWaiter = null;

  if (identity) {
    deviceId = identity.deviceId;
    const known = identity.modelCode === MODEL_CODE_KATANA_100;
    setStatus(`Connected to ${input.name}`, known ? 'ok' : 'err');
    $('deviceInfo').textContent =
      `identity reply: ${hex(identity.bytes)}\n` +
      `device ID ${hex([deviceId])} · model code ${hex([identity.modelCode])} ` +
      (known ? '(KATANA-100)' : '(NOT the expected 06 = KATANA-100: be careful with writes)');
  } else {
    deviceId = DEFAULT_DEVICE_ID;
    setStatus(`Port ${input.name} open, but no identity reply`, 'err');
    $('deviceInfo').textContent = `no identity reply within 1.5 s · using default device ID ${hex([deviceId])}`;
    toolNote('no identity reply within 1.5 s');
  }
  $('btnConnect').textContent = 'Reconnect';
  setConnected(true);
}

function onStateChange(e) {
  const port = e.port;
  if (!/katana/i.test(port.name ?? '')) return;
  if (port.state === 'disconnected' && (port === input || port === output)) {
    toolNote(`MIDI port "${port.name}" disconnected`);
    requests.cancelAll('Port disconnected');
    input = output = null;
    setConnected(false);
    setStatus('Port disconnected. Press Connect again.', 'err');
  }
}

// ---- Reading ----

let readRunning = false;

// Runs one read action at a time and reports errors in the given result element.
async function readAction(resultEl, fn) {
  if (readRunning) return;
  readRunning = true;
  for (const el of document.querySelectorAll('[data-read]')) el.disabled = true;
  try {
    await fn();
  } catch (error) {
    resultEl.textContent = `Error: ${error.message}`;
    localLine(`Error: ${error.message}`, 'err');
  } finally {
    readRunning = false;
    if (output) {
      for (const el of document.querySelectorAll('[data-read]')) el.disabled = false;
      $('btnSnapB').disabled = snapshotA === null;
    }
  }
}

function silenceGap() {
  const value = Number($('gapMs').value);
  return Number.isFinite(value) && value >= 50 ? value : 300;
}

// One RQ1 through the request helper; the summary line also goes into the recording.
async function read(label, address, size) {
  repliesInRun = 0;
  hiddenReplies = 0;
  const result = await requests.request(address, size, { label, silenceGapMs: silenceGap() });
  if (hiddenReplies > 0) localLine(`… ${hiddenReplies} more reply DT1 not shown (all recorded)`);
  toolNote(formatResult(result));
  return result;
}

const ascii = (data) => data.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');

function dumpBlocks(result, { withAscii = false } = {}) {
  return result.blocks
    .map((b) => `${hex(b.address)}: ${hex(b.data)}${withAscii ? `   |${ascii(b.data)}|` : ''}`)
    .join('\n');
}

function patchName(blocks, base) {
  const nameAddress = toLinear(base) + PATCH_OFFSET.name;
  const block = blocks.find((b) => b.linearAddress === nameAddress);
  if (!block || block.data.length < PATCH_NAME_LENGTH) return null;
  return decodeAscii(block.data.slice(0, PATCH_NAME_LENGTH));
}

async function readPatchNumber() {
  const result = await read('patch number', ADDR.patchNumber, 2);
  const data = result.blocks[0]?.data;
  const index = data && data.length >= 2 ? decodeNibbles(data.slice(0, 2)) : null;
  if (index !== null) lastPatchIndex = index;
  return { result, data, index };
}

function showRead(text) {
  $('readResult').textContent = text;
  $('slotTable').replaceChildren();
}

function table(headers, rows, rowClass = () => '') {
  const el = document.createElement('table');
  const head = el.createTHead().insertRow();
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  }
  const body = el.createTBody();
  rows.forEach((cells, i) => {
    const tr = body.insertRow();
    tr.className = rowClass(i);
    for (const cell of cells) tr.insertCell().textContent = cell;
  });
  return el;
}

$('btnPatchNumber').onclick = () => readAction($('readResult'), async () => {
  const { result, data, index } = await readPatchNumber();
  showRead(`${formatResult(result)}\n` + (data
    ? `data ${hex(data)} → index ${index} (${PATCH_SLOT_NAMES[index] ?? 'outside 0–9'}), decoded as two nibble bytes (u2x4)`
    : ''));
});

$('btnEditorLevel').onclick = () => readAction($('readResult'), async () => {
  const result = await read('editor level', ADDR.editorLevel, 1);
  const data = result.blocks[0]?.data;
  showRead(`${formatResult(result)}\n${data ? `data ${hex(data)} (expected 01)` : ''}`);
});

$('btnPatchName').onclick = () => readAction($('readResult'), async () => {
  const result = await read('current patch name', ADDR.currentPatch, PATCH_NAME_LENGTH);
  const name = patchName(result.blocks, ADDR.currentPatch);
  showRead(`${formatResult(result)}\n${name !== null ? `name "${name}"` : ''}`);
});

$('btnFullPatch').onclick = () => readAction($('readResult'), async () => {
  const result = await read('full current patch', ADDR.currentPatch, SIZE.patch);
  showRead(
    `${formatResult(result)}\n(measured before on the PC: 80 DT1, 2649 data bytes, 0.27 s)\n` +
    `name "${patchName(result.blocks, ADDR.currentPatch) ?? '?'}"\n\n${dumpBlocks(result)}`);
});

$('btnSystem').onclick = () => readAction($('readResult'), async () => {
  const result = await read('SYSTEM', ADDR.system, SYSTEM_READ_SIZE);
  showRead(`${formatResult(result)}\n(measured before on the PC: 21 DT1, 131 data bytes, 23 ms)\n\n${dumpBlocks(result, { withAscii: true })}`);
});

$('btnAllSlots').onclick = () => readAction($('readResult'), async () => {
  const number = await readPatchNumber();
  const result = await read('all ten stored slots', ADDR.storedPatchBase, SIZE.allStoredPatches);
  showRead(
    `${formatResult(number.result)}\n${formatResult(result)}\n` +
    '(measured before on the PC: 800 DT1, 26490 data bytes, 2.7 s)\n' +
    `current patch number: ${number.index ?? '?'} (highlighted)`);

  const stride = toLinear(SIZE.storedPatchStride);
  const rows = PATCH_SLOT_NAMES.map((slotName, index) => {
    const address = storedPatchAddress(index);
    const start = toLinear(address);
    const blocks = result.blocks.filter((b) => b.linearAddress >= start && b.linearAddress < start + stride);
    const bytes = blocks.reduce((sum, b) => sum + b.data.length, 0);
    const name = patchName(blocks, address);
    return [String(index), slotName, hex(address), name === null ? '(no name block)' : `"${name}"`, String(blocks.length), String(bytes)];
  });
  $('slotTable').replaceChildren(table(
    ['index', 'expected', 'address', 'name read from the amp', 'DT1', 'data bytes'],
    rows,
    (i) => (i === number.index ? 'current' : '')));
});

$('btnVerify').onclick = () => readAction($('readResult'), async () => {
  const number = await readPatchNumber();
  if (number.index === null || number.index < 0 || number.index > 9) {
    showRead(`${formatResult(number.result)}\nCould not decode a patch index 0–9 from ${number.data ? hex(number.data) : 'no data'}.`);
    return;
  }
  const index = number.index;
  const slotAddress = storedPatchAddress(index);
  const current = await read('current patch', ADDR.currentPatch, SIZE.patch);
  const slot = await read(`stored slot index ${index}`, slotAddress, SIZE.patch);
  const cmp = compareRelative(current.blocks, ADDR.currentPatch, slot.blocks, slotAddress);
  const currentName = patchName(current.blocks, ADDR.currentPatch);
  const slotName = patchName(slot.blocks, slotAddress);

  const verdict = cmp.blocksCompared > 0 && cmp.differing.length === 0 && !cmp.missingInA.length && !cmp.missingInB.length
    ? 'IDENTICAL'
    : 'DIFFERENT (wrong mapping, or unsaved changes on this channel)';
  const summary =
    `patch number ${index} (${PATCH_SLOT_NAMES[index]}) → slot ${hex(slotAddress)}: ${verdict}; ` +
    `${cmp.equalBlocks} of ${cmp.blocksCompared} blocks equal, current name "${currentName ?? '?'}", slot name "${slotName ?? '?'}"`;
  toolNote(`verify mapping: ${summary}`);

  const lines = [formatResult(number.result), formatResult(current), formatResult(slot), '', summary];
  if (cmp.missingInA.length) lines.push(`blocks only in the slot: ${cmp.missingInA.map((o) => hex(o)).join(', ')}`);
  if (cmp.missingInB.length) lines.push(`blocks only in the current patch: ${cmp.missingInB.map((o) => hex(o)).join(', ')}`);
  for (const d of cmp.differing) {
    lines.push(`+${hex(d.offset)}\n  current: ${hex(d.a)}\n  slot:    ${hex(d.b)}`);
  }
  showRead(lines.join('\n'));
});

$('btnCustomRead').onclick = () => readAction($('readResult'), async () => {
  const address = parseHex($('customAddr').value);
  const size = parseHex($('customSize').value);
  if (address.length !== 4 || size.length !== 4) throw new Error('Address and size need 4 hex bytes each.');
  const result = await read('custom RQ1', address, size);
  showRead(`${formatResult(result)}\n\n${dumpBlocks(result, { withAscii: true })}`);
});

// ---- Snapshot + diff ----

const SNAP_SCOPES = {
  patch: { label: 'current patch', address: ADDR.currentPatch, size: SIZE.patch },
  system: { label: 'SYSTEM', address: ADDR.system, size: SYSTEM_READ_SIZE },
};

$('btnSnapA').onclick = () => readAction($('diffSummary'), async () => {
  const scope = $('snapScope').value;
  const { label, address, size } = SNAP_SCOPES[scope];
  const result = await read(`snapshot A (${label})`, address, size);
  if (result.timedOut) throw new Error('No reply, snapshot A not taken.');
  snapshotA = { scope, map: snapshotFromBlocks(result.blocks) };
  unsolicitedSinceA = [];
  $('snapStatus').textContent =
    `Snapshot A: ${label}, ${result.dt1Count} blocks, ${result.dataBytes} bytes, taken at ${(result.sentAt / 1000).toFixed(1)} s. ` +
    'Now operate one control on the amp, then take B.';
  $('diffSummary').textContent = '';
  $('diffTable').replaceChildren();
});

$('btnSnapB').onclick = () => readAction($('diffSummary'), async () => {
  if (!snapshotA) throw new Error('Take snapshot A first.');
  const { label, address, size } = SNAP_SCOPES[snapshotA.scope];
  const between = unsolicitedSinceA.slice(); // unsolicited DT1 that arrived before B was requested
  const result = await read(`snapshot B (${label})`, address, size);
  if (result.timedOut) throw new Error('No reply, snapshot B not taken.');
  const diff = diffSnapshots(snapshotA.map, snapshotFromBlocks(result.blocks));
  const changes = markReported(diff.changes, between);
  const reported = changes.filter((c) => c.reported).length;

  const summary = [
    `${label}: ${changes.length} byte(s) changed between A and B, ${reported} of them reported by the amp itself.`,
    `Unsolicited DT1 between A and B: ${between.length}` +
      (between.length ? ` (addresses: ${[...new Set(between.map((m) => hex(parseAddress(m.linearAddress))))].join(', ')})` : ''),
  ];
  if (diff.onlyInA.length) summary.push(`blocks only in A: ${diff.onlyInA.map((a) => hex(a)).join(', ')}`);
  if (diff.onlyInB.length) summary.push(`blocks only in B: ${diff.onlyInB.map((a) => hex(a)).join(', ')}`);
  for (const l of diff.lengthChanged) summary.push(`block ${hex(l.address)} changed length ${l.oldLength} → ${l.newLength}`);
  if (changes.length > MAX_DIFF_ROWS) summary.push(`Table shows the first ${MAX_DIFF_ROWS} changes.`);
  $('diffSummary').textContent = summary.join('\n');

  toolNote(
    `diff A→B (${label}): ${changes.length} byte(s) changed, ${reported} reported, ${between.length} unsolicited DT1 between` +
    (changes.length && changes.length <= 12
      ? `: ${changes.map((c) => `${hex(c.address)} ${hex([c.oldValue])}→${hex([c.newValue])}`).join(', ')}`
      : ''));

  const rows = changes.slice(0, MAX_DIFF_ROWS).map((c) => [
    hex(c.address),
    describeAddress(c.address).label,
    `${hex([c.oldValue])} (${c.oldValue})`,
    `${hex([c.newValue])} (${c.newValue})`,
    c.reported ? 'yes' : 'no',
  ]);
  $('diffTable').replaceChildren(rows.length
    ? table(['address', 'where', 'old', 'new', 'reported by the amp'], rows)
    : document.createTextNode(''));
  $('snapStatus').textContent = 'B compared with A. Snapshot A is kept; take a new A for the next control.';
});

function parseAddress(linear) {
  return addOffset([0, 0, 0, 0], linear);
}

// ---- Firmware hunt ----

$('btnFirmware').onclick = () => readAction($('fwResult'), async () => {
  toolNote('firmware hunt: dumping candidate areas (read-only)');
  const system = await read('SYSTEM', ADDR.system, SYSTEM_READ_SIZE);
  const command = await read('command area 7F 00 00 00', ADDR.editorLevel, COMMAND_DUMP_SIZE);
  const lines = [
    '== identity reply ==',
    identity ? hex(identity.bytes) : '(none received)',
    identity ? `bytes after the manufacturer ID (index 6 ff.): ${hex(identity.bytes.slice(6, -1))}` : '',
    '',
    `== ${formatResult(system)} ==`,
    dumpBlocks(system, { withAscii: true }),
    '',
    `== ${formatResult(command)} ==`,
    dumpBlocks(command, { withAscii: true }),
  ];
  $('fwResult').textContent = lines.join('\n');
});

// ---- Write experiments ----

const NS_THRESHOLD_ADDRESS = addOffset(ADDR.currentPatch, PATCH_OFFSET.nsThreshold);

function showWrite(text) {
  $('writeResult').textContent = text;
}

async function writeAction(fn) {
  try {
    await fn();
  } catch (error) {
    showWrite(`Error: ${error.message}`);
    localLine(`Error: ${error.message}`, 'err');
  }
}

$('chkBackup').onchange = () => {
  updateWriteLock();
  if ($('chkBackup').checked) toolNote('write section unlocked (user confirmed BOSS Tone Studio backup)');
};

$('btnEditorOn').onclick = () => writeAction(async () => {
  toolNote('editor mode ON requested');
  await sendDt1(ADDR.editorMode, [0x01]);
  showWrite('Sent editor mode ON (DT1 7F 00 00 01 = 01).');
});

$('btnEditorOff').onclick = () => writeAction(async () => {
  toolNote('editor mode OFF requested');
  await sendDt1(ADDR.editorMode, [0x00]);
  showWrite('Sent editor mode OFF (DT1 7F 00 00 01 = 00).');
});

$('btnNsRead').onclick = () => readAction($('writeResult'), async () => {
  const result = await read('NS threshold', NS_THRESHOLD_ADDRESS, 1);
  const value = result.blocks[0]?.data[0];
  if (value === undefined) throw new Error('No reply for the NS threshold.');
  $('nsThr').value = value;
  $('nsThrV').textContent = value;
  showWrite(`NS threshold is ${value}.`);
});

let nsTimer = null;
$('nsThr').addEventListener('input', () => {
  const value = Number($('nsThr').value);
  $('nsThrV').textContent = value;
  clearTimeout(nsTimer); // while dragging, only the newest value goes out
  nsTimer = setTimeout(() => writeAction(() => sendDt1(NS_THRESHOLD_ADDRESS, [value])), 40);
});

for (let index = 1; index <= 8; index++) {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = `${index} = ${PATCH_SLOT_NAMES[index]}`;
  $('selPatch').appendChild(option);
}

$('btnPatchSelect').onclick = () => writeAction(async () => {
  const index = Number($('selPatch').value);
  if (!Number.isInteger(index) || index < 1 || index > 8) throw new Error('Only indexes 1 to 8 are allowed.');
  const data = encodeNibbles(index, 2);
  toolNote(`PATCH_SELECT index ${index} (${PATCH_SLOT_NAMES[index]}) requested, data ${hex(data)} (assumed u2x4)`);
  await sendDt1(ADDR.patchSelect, data);
  showWrite(`Sent PATCH_SELECT ${hex(data)}. Check the amp and the log for what it reports back.`);
});

$('btnCustomWrite').onclick = () => writeAction(async () => {
  const address = parseHex($('dtAddr').value);
  const data = parseHex($('dtData').value);
  if (address.length !== 4) throw new Error('The address needs 4 hex bytes.');
  if (data.length === 0) throw new Error('No data bytes.');
  const message = buildDt1(deviceId, address, data); // validates 7-bit bytes
  const info = describeAddress(address);
  const risky = info.area !== 'current';
  const question =
    `Send this DT1 to the amp?\n\naddress ${hex(address)} (${info.label})\ndata ${hex(data)}\n\n${hex(message)}` +
    (risky ? '\n\nWARNING: this address is outside the current patch (stored memory, system or command area). Only continue if you know what it does.' : '');
  if (!window.confirm(question)) return;
  toolNote(`custom DT1 ${hex(address)} data ${hex(data)}`);
  await sendRaw(message);
  showWrite(`Sent ${hex(message)}`);
});

// ---- Markers ----

$('btnMarker').onclick = () => {
  addMarker($('markerText').value);
  $('markerText').value = '';
  $('markerText').focus();
};
$('markerText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btnMarker').click();
});

for (const text of PRESET_MARKERS) {
  const button = document.createElement('button');
  button.className = 'sec small';
  button.textContent = text;
  button.onclick = () => addMarker(text);
  $('presetMarkers').appendChild(button);
}

// ---- Experiment checklist ----

function loadNotes() {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveNotes() {
  const notes = {};
  for (const area of document.querySelectorAll('textarea[data-exp]')) notes[area.dataset.exp] = area.value;
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch { /* storage unavailable: notes still go into the export */ }
}

function renderExperiments() {
  const saved = loadNotes();
  for (const exp of EXPERIMENTS) {
    const box = document.createElement('div');
    box.className = 'exp';

    const title = document.createElement('h3');
    const name = document.createElement('span');
    name.textContent = `${exp.id} · ${exp.title} `;
    const tag = document.createElement('span');
    tag.className = exp.writes ? 'tag w' : 'tag';
    tag.textContent = exp.writes ? 'needs write section' : 'read-only';
    name.appendChild(tag);
    const buttons = document.createElement('span');
    for (const [label, word] of [['Start', 'START'], ['End', 'END']]) {
      const button = document.createElement('button');
      button.className = 'sec small';
      button.textContent = label;
      button.onclick = () => addMarker(`${word} ${exp.id}: ${exp.title}`);
      buttons.appendChild(button);
    }
    title.append(name, buttons);

    const steps = document.createElement('ol');
    for (const step of exp.steps) {
      const li = document.createElement('li');
      li.textContent = step;
      steps.appendChild(li);
    }

    const notes = document.createElement('textarea');
    notes.dataset.exp = exp.id;
    notes.placeholder = `Notes for ${exp.id} (stored in the export)`;
    notes.value = saved[exp.id] ?? '';
    notes.addEventListener('input', () => { saveNotes(); dirty = true; });

    box.append(title, steps, notes);
    $('experimentList').appendChild(box);
  }
}

$('btnClearNotes').onclick = () => {
  if (!window.confirm('Delete the notes of all experiments?')) return;
  for (const area of document.querySelectorAll('textarea[data-exp]')) area.value = '';
  saveNotes();
};

// ---- Export ----

function currentSession() {
  return {
    startedAt: recorder.startedAt,
    events: recorder.events,
    filtered: recorder.filtered,
    portName: input?.name ?? null,
    identity: identity ? hex(identity.bytes) : null,
    deviceId: identity ? identity.deviceId : null,
    modelCode: identity ? identity.modelCode : null,
    settings: { silenceGapMs: silenceGap(), firstReplyTimeoutMs: requests.firstReplyTimeoutMs },
    experiments: EXPERIMENTS.map((exp) => ({
      id: exp.id,
      title: exp.title,
      notes: document.querySelector(`textarea[data-exp="${exp.id}"]`)?.value ?? '',
    })),
  };
}

$('btnDownload').onclick = () => {
  const session = currentSession();
  const blob = new Blob([JSON.stringify(buildExport(session), null, 1)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = exportFileName(session.startedAt);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  dirty = false;
  localLine(`Saved ${link.download} (${session.events.length} events). Move it into captures/.`);
};

$('btnCopyText').onclick = async () => {
  try {
    await navigator.clipboard.writeText(sessionToText(currentSession()));
    dirty = false;
    localLine(`Copied ${recorder.events.length} events as text.`);
  } catch {
    localLine('Copy failed.', 'err');
  }
};

$('btnNewSession').onclick = () => {
  if (dirty && recorder.events.length && !window.confirm('Discard the current recording? It has not been exported.')) return;
  recorder.reset();
  dirty = false;
  unsolicitedCount = 0;
  snapshotA = null;
  unsolicitedSinceA = [];
  $('btnSnapB').disabled = true;
  $('snapStatus').textContent = '';
  pendingLines = [];
  $('log').replaceChildren();
  if (input) toolNote(`new session, still connected to "${input.name}", identity ${identity ? hex(identity.bytes) : 'unknown'}`);
  updateCounters();
};

// Deliberately no "editor mode off" on unload: leaving it on is one of the experiments (Q8).
window.addEventListener('beforeunload', (e) => {
  if (dirty && recorder.events.length) e.preventDefault();
});

// ---- Start ----

$('btnConnect').onclick = connect;
renderExperiments();
setConnected(false);
updateCounters();
