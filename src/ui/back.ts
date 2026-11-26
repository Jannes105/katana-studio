// The Android back button (and Escape in the browser) closes the topmost layer: an explanation, a window from
// below, a sub page (effect, pedal, SYSTEM section). Every open layer registers a close handler while it is
// shown; the last one registered is on top. With nothing open, the app shell decides (start tab, then leave).

import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

const stack: (() => void)[] = [];

/** Registers a layer as open; returns the function that unregisters it (use as the cleanup of an $effect). */
export function onBack(close: () => void): () => void {
  const entry = (): void => close();
  stack.push(entry);
  return () => {
    const i = stack.lastIndexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Closes the topmost layer; false when none is open. */
export function back(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top();
  return true;
}

/** Number of open layers (for tests). */
export function openLayers(): number {
  return stack.length;
}

/**
 * Wires the back button (native) and Escape (browser). `fallback` runs when no layer is open and returns true
 * if it handled the press (e.g. went to the start tab); otherwise the app goes to the background.
 */
export function installBack(fallback: () => boolean): void {
  if (Capacitor.isNativePlatform()) {
    void CapApp.addListener('backButton', () => {
      if (!back() && !fallback()) void CapApp.minimizeApp();
    });
  } else {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (back() || fallback()) e.preventDefault();
    });
  }
}
