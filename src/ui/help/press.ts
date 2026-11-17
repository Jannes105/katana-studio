// Long press on buttons (choices, types, switches; Phase 3a). Knobs use relativeDrag's onLongPress instead,
// because they capture the pointer for dragging. Rules as there: the finger must stay within DRAG_THRESHOLD_PX
// for LONG_PRESS_MS; once it fires, the following click is swallowed, so a long press never selects or switches
// anything. Scrolling a list cancels the press (pointercancel).

import type { Action } from 'svelte/action';
import { DRAG_THRESHOLD_PX, LONG_PRESS_MS } from '../drag';

export const longPress: Action<HTMLElement, (() => void) | undefined> = (node, initial) => {
  let onLong = initial;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pointer: number | null = null;
  let startX = 0;
  let startY = 0;
  let swallowClick = false;

  const stop = (): void => {
    clearTimeout(timer);
    timer = undefined;
    pointer = null;
  };
  const down = (e: PointerEvent): void => {
    if (!onLong || pointer !== null) return;
    pointer = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    swallowClick = false;
    timer = setTimeout(() => {
      timer = undefined;
      swallowClick = true;
      onLong?.();
    }, LONG_PRESS_MS);
  };
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== pointer) return;
    if (Math.max(Math.abs(e.clientX - startX), Math.abs(e.clientY - startY)) >= DRAG_THRESHOLD_PX) stop();
  };
  const end = (e: PointerEvent): void => {
    if (e.pointerId === pointer) stop();
  };
  const click = (e: Event): void => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  // Android shows a context menu or selection on a long touch; not wanted on controls.
  const menu = (e: Event): void => {
    if (onLong) e.preventDefault();
  };

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('click', click, true);
  node.addEventListener('contextmenu', menu);
  return {
    update(next) {
      onLong = next;
    },
    destroy() {
      stop();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
      node.removeEventListener('click', click, true);
      node.removeEventListener('contextmenu', menu);
    },
  };
};
