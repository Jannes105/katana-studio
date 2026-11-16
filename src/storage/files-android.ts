// Saving a file on the phone and handing it to the Android share menu (PLAN 4.6: export e.g. to Google Drive).
// One of the two places in the core allowed to use Capacitor (eslint.config.js).

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Writes `text` to the app's cache folder and opens the share menu for it. Resolves when the menu is closed;
 * a cancelled share is not an error.
 */
export async function shareTextFile(fileName: string, text: string, title: string): Promise<void> {
  const written = await Filesystem.writeFile({
    path: fileName,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  try {
    await Share.share({ title, files: [written.uri], dialogTitle: title });
  } catch (error) {
    // The share sheet reports "Share canceled" when the user backs out; nothing went wrong.
    if (error instanceof Error && /cancel/i.test(error.message)) return;
    throw error;
  }
}
