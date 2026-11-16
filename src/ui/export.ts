// Exporting files: the Android share menu in the app, a plain download in the browser (development on the PC).

import { Capacitor } from '@capacitor/core';
import { APP_VERSION } from '../app-info';
import type { FileMeta } from '../state/backup';
import type { ConnectionState } from '../state/connection';
import { toJson, type BackupFile, type KatanaFile, type PatchFile } from '../storage/format';
import { toTsl } from '../storage/tsl';
import { shareTextFile } from '../storage/files-android';

export function fileMeta(s: ConnectionState, now = new Date()): FileMeta {
  return {
    createdAt: now.toISOString(),
    appVersion: APP_VERSION,
    model: { code: s.modelCode ?? 0, name: s.model ?? '' },
  };
}

/** File name with local date and time, e.g. katana-backup-2026-11-16-1712.json. */
export function fileName(file: KatanaFile, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  if (file.kind === 'backup') return `katana-backup-${stamp}.json`;
  const name = file.current.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'patch';
  return `katana-patch-${file.current.channel}-${name}-${stamp}.json`;
}

export async function exportFile(file: KatanaFile, title: string): Promise<void> {
  await exportText(fileName(file), toJson(file), title);
}

const safe = (text: string): string => text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The current patch as a one-patch .tsl for BOSS Tone Studio. */
export async function exportPatchTsl(file: PatchFile, title: string): Promise<void> {
  const name = file.current.name || 'patch';
  const text = toTsl(name, [{ blocks: file.current.blocks }]);
  await exportText(`katana-${safe(file.current.channel)}-${safe(name) || 'patch'}.tsl`, text, title);
}

/** The channels A1–B4 of a backup as one .tsl (eight patches in channel order). */
export async function exportChannelsTsl(file: BackupFile, title: string): Promise<void> {
  const patches = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => {
    const e = file.slots.get(i);
    return e ? [{ memo: `${e.channel} ${e.name}`.trim(), blocks: e.blocks }] : [];
  });
  const stamp = fileName(file).replace(/^katana-backup-|.json$/g, '');
  await exportText(`katana-channels-${stamp}.tsl`, toTsl(`Katana A1-B4 ${stamp}`, patches), title);
}

async function exportText(name: string, text: string, title: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await shareTextFile(name, text, title);
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
