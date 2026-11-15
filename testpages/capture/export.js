// Export format of a capture session (JSON) and the plain-text rendering.

import { describeEvent } from './describe.js';

export const FORMAT_NAME = 'katana-capture';
export const FORMAT_VERSION = 1;
export const TOOL_NAME = 'Katana Studio capture tool';

const pad = (n, width = 2) => String(n).padStart(width, '0');

// katana-capture-YYYYMMDD-HHMMSS.json, in local time.
export function exportFileName(date) {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `katana-capture-${day}-${time}.json`;
}

// session: {
//   startedAt: Date, events, filtered: { activeSensing, clock },
//   identity: hex string | null, deviceId: number | null, modelCode: number | null,
//   portName: string | null, settings: object, experiments: [{ id, title, notes }]
// }
// events: { t, dir: 'in' | 'out' | 'marker', bytes?: hex string, text?: string, reply?: boolean }
//   t = milliseconds since startedAt (high resolution).
//   reply (incoming DT1 only): true = counted as answer to the outstanding RQ1, false = unsolicited.
export function buildExport(session) {
  return {
    format: FORMAT_NAME,
    formatVersion: FORMAT_VERSION,
    tool: TOOL_NAME,
    startedAt: session.startedAt.toISOString(),
    portName: session.portName ?? null,
    identity: session.identity ?? null,
    deviceId: session.deviceId ?? null,
    modelCode: session.modelCode ?? null,
    settings: session.settings ?? {},
    filtered: { ...session.filtered },
    experiments: (session.experiments ?? []).map(({ id, title, notes }) => ({ id, title, notes: notes ?? '' })),
    events: session.events.map((e) => ({ ...e })),
  };
}

const ARROW = { in: '<-', out: '->', marker: '##' };

export function eventToText(event) {
  const time = event.t.toFixed(3).padStart(11);
  if (event.dir === 'marker') return `${time} ${ARROW.marker} ${event.text}`;
  return `${time} ${ARROW[event.dir]} ${event.bytes}   ; ${describeEvent(event)}`;
}

export function sessionToText(session) {
  const head = [
    `# ${TOOL_NAME}, format ${FORMAT_NAME} v${FORMAT_VERSION}`,
    `# started ${session.startedAt.toISOString()}`,
    `# port ${session.portName ?? '-'}, identity ${session.identity ?? '-'}`,
    `# filtered: ${session.filtered.activeSensing} active sensing, ${session.filtered.clock} clock`,
    '# time in ms since start; -> sent, <- received, ## marker',
  ];
  const notes = (session.experiments ?? [])
    .filter((x) => x.notes && x.notes.trim())
    .map((x) => `# notes ${x.id}: ${x.notes.trim().replace(/\s*\n\s*/g, ' / ')}`);
  return [...head, ...notes, ...session.events.map(eventToText)].join('\n') + '\n';
}
