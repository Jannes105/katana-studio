// Exporting files: the Android share menu in the app, a plain download in the browser (development on the PC).

import { Capacitor } from '@capacitor/core';
import { APP_VERSION } from '../app-info';
import type { FileMeta } from '../state/backup';
import type { ConnectionState } from '../state/connection';
import { toJson, type KatanaFile } from '../storage/format';
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
  const name = fileName(file);
  const text = toJson(file);
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
