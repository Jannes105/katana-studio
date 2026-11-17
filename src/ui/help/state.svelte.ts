// The explanation currently open (Phase 3a). Any control opens it with openHelp(); App shows the window.

import type { HelpTarget } from './help';

export const helpState = $state<{ target: HelpTarget | null }>({ target: null });

export function openHelp(target: HelpTarget): void {
  helpState.target = target;
  // A short buzz tells the finger that the long press counted (ignored where not supported).
  navigator.vibrate?.(15);
}

export function closeHelp(): void {
  helpState.target = null;
}
