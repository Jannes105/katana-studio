import { describe, expect, it } from 'vitest';
import { back, onBack, openLayers } from '../../src/ui/back';

describe('back button layers', () => {
  it('closes the topmost layer first, then the one below', () => {
    const closed: string[] = [];
    onBack(() => closed.push('page'));
    onBack(() => closed.push('sheet'));
    onBack(() => closed.push('help'));
    expect(back()).toBe(true);
    expect(back()).toBe(true);
    expect(closed).toEqual(['help', 'sheet']);
    expect(back()).toBe(true);
    expect(back()).toBe(false);
    expect(openLayers()).toBe(0);
  });

  it('forgets a layer that closed by itself (cross, backdrop)', () => {
    const closed: string[] = [];
    onBack(() => closed.push('page'));
    const off = onBack(() => closed.push('sheet'));
    off();
    off(); // twice is harmless
    expect(back()).toBe(true);
    expect(closed).toEqual(['page']);
    expect(openLayers()).toBe(0);
  });
});
