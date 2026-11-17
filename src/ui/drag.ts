// Relative drag for knobs: a control never jumps to the touch point; only the distance moved changes the value
// (PLAN 5, Phase 1 "Bedienkonzept"). Taken over from the design draft.

import type { Action } from 'svelte/action';

export interface DragOptions {
  readonly axis: 'x' | 'y';
  /** Pixels per value step; a function so it can depend on the element size. */
  readonly pxPerStep: number | ((node: HTMLElement) => number);
  readonly get: () => number;
  readonly set: (value: number) => void;
  readonly enabled: () => boolean;
  readonly onTap?: () => void;
  readonly onDoubleTap?: () => void;
  readonly onDrag?: (dragging: boolean) => void;
  /**
   * Long press (Phase 3a): held for LONG_PRESS_MS without moving DRAG_THRESHOLD_PX. It spends the gesture: no
   * drag and no tap follow, so a long press never changes a value.
   */
  readonly onLongPress?: () => void;
}

export const DRAG_THRESHOLD_PX = 6;
const DOUBLE_TAP_MS = 320;
export const LONG_PRESS_MS = 450;

export const relativeDrag: Action<HTMLElement, DragOptions> = (node, initial) => {
  let o = initial;
  let pointer: number | null = null;
  let startX = 0;
  let startY = 0;
  let startValue = 0;
  let dragging = false;
  let lastTap = 0;
  let longTimer: ReturnType<typeof setTimeout> | undefined;
  let spent = false;
  node.style.touchAction = 'none';
  const stopTimer = (): void => {
    clearTimeout(longTimer);
    longTimer = undefined;
  };

  const down = (e: PointerEvent): void => {
    if (pointer !== null) return;
    pointer = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startValue = o.get();
    dragging = false;
    spent = false;
    node.setPointerCapture(e.pointerId);
    if (o.onLongPress) {
      longTimer = setTimeout(() => {
        longTimer = undefined;
        spent = true;
        lastTap = 0;
        o.onLongPress?.();
      }, LONG_PRESS_MS);
    }
  };

  const move = (e: PointerEvent): void => {
    if (e.pointerId !== pointer || spent) return;
    const d = o.axis === 'x' ? e.clientX - startX : startY - e.clientY;
    if (!dragging) {
      // Movement along either axis ends a pending long press; only the drag axis starts a drag.
      if (Math.max(Math.abs(e.clientX - startX), Math.abs(e.clientY - startY)) >= DRAG_THRESHOLD_PX)
        stopTimer();
      if (Math.abs(d) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      o.onDrag?.(true);
    }
    if (!o.enabled()) return;
    const px = typeof o.pxPerStep === 'function' ? o.pxPerStep(node) : o.pxPerStep;
    o.set(Math.round(startValue + d / Math.max(px, 0.5)));
  };

  const end = (e: PointerEvent, cancelled: boolean): void => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    stopTimer();
    if (spent) {
      spent = false;
      return;
    }
    if (dragging) {
      dragging = false;
      o.onDrag?.(false);
      return;
    }
    if (cancelled) return;
    const now = performance.now();
    if (now - lastTap < DOUBLE_TAP_MS) {
      lastTap = 0;
      o.onDoubleTap?.();
    } else {
      lastTap = now;
      o.onTap?.();
    }
  };
  const up = (e: PointerEvent): void => end(e, false);
  const cancel = (e: PointerEvent): void => end(e, true);

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', cancel);
  return {
    update(next: DragOptions) {
      o = next;
    },
    destroy() {
      stopTimer();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', cancel);
    },
  };
};
