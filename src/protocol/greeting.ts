// Greeting (PLAN 4.3, protocol-notes 2.9): identity request → take the device ID → check the model code →
// RQ1 editor level (expect 1) → DT1 editor mode on → read editor mode back (the switch is not acknowledged).
//
// A mismatch never blocks: the app warns and stays read-only until the user unlocks writing (PLAN 4.3).
// Editor mode is switched on for a KATANA-100 even if the editor level differs (most likely a firmware update;
// without editor mode the app would miss every change on the amp). For another model nothing is written at
// all, because we do not know what the command does there; reading works without editor mode.

import { ADDR, type Address } from './address';
import { MODEL_CODE_KATANA_100, ROLAND_ID } from './sysex';

export const EXPECTED_EDITOR_LEVEL = 1;
export const EDITOR_MODE_ON = 1;
export const EDITOR_MODE_OFF = 0;

/** What the greeting needs from the layer below (implemented by SendQueue). */
export interface GreetingLink {
  /** Sends the identity request and resolves with the reply (or rejects on timeout). */
  identify(): Promise<{ deviceId: number; manufacturerId: number; modelCode: number }>;
  /** RQ1 of `size` bytes with the device ID learned from `identify`; resolves with the data. */
  readBytes(address: Address, size: number): Promise<readonly number[]>;
  /** DT1; resolves once sent (the amp does not acknowledge). */
  write(address: Address, data: readonly number[]): Promise<void>;
}

export type GreetingWarning =
  | { kind: 'manufacturer'; got: number }
  | { kind: 'model'; got: number }
  | { kind: 'editor-level'; got: number }
  | { kind: 'editor-mode'; got: number };

export interface GreetingResult {
  readonly deviceId: number;
  readonly modelCode: number;
  readonly editorLevel: number;
  /** Editor mode as read back after switching it on; null when it was not switched (foreign device). */
  readonly editorMode: number | null;
  /** Empty: all as expected. Otherwise the app runs read-only and shows the warnings. */
  readonly warnings: readonly GreetingWarning[];
  readonly readOnly: boolean;
}

export const MODEL_NAMES: Readonly<Record<number, string>> = { [MODEL_CODE_KATANA_100]: 'KATANA-100' };

export function modelName(code: number): string {
  return MODEL_NAMES[code] ?? `unknown model (${code.toString(16).padStart(2, '0').toUpperCase()})`;
}

/**
 * Runs the greeting. Rejects only if the amp does not answer at all (timeout from the link); every unexpected
 * value becomes a warning instead.
 */
export async function greet(link: GreetingLink): Promise<GreetingResult> {
  const warnings: GreetingWarning[] = [];

  const id = await link.identify();
  if (id.manufacturerId !== ROLAND_ID) warnings.push({ kind: 'manufacturer', got: id.manufacturerId });
  if (id.modelCode !== MODEL_CODE_KATANA_100) warnings.push({ kind: 'model', got: id.modelCode });

  const knownDevice = warnings.length === 0;

  const [editorLevel = -1] = await link.readBytes(ADDR.editorLevel, 1);
  if (editorLevel !== EXPECTED_EDITOR_LEVEL) warnings.push({ kind: 'editor-level', got: editorLevel });

  // Editor mode is required for any report from the amp (protocol-notes Q8).
  let editorMode: number | null = null;
  if (knownDevice) {
    await link.write(ADDR.editorMode, [EDITOR_MODE_ON]);
    [editorMode = -1] = await link.readBytes(ADDR.editorMode, 1);
    if (editorMode !== EDITOR_MODE_ON) warnings.push({ kind: 'editor-mode', got: editorMode });
  }

  // A failed editor mode only means the amp will not report changes; writing stays safe.
  const readOnly = warnings.some((w) => w.kind !== 'editor-mode');
  return { deviceId: id.deviceId, modelCode: id.modelCode, editorLevel, editorMode, warnings, readOnly };
}

/** Best-effort sign-off (PLAN 4.3): editor mode off. "Editor mode stays on" is the normal case. */
export async function signOff(link: Pick<GreetingLink, 'write'>): Promise<void> {
  await link.write(ADDR.editorMode, [EDITOR_MODE_OFF]);
}
