import { describe, expect, it } from 'vitest';
import { SYSTEM_PARAMS } from '../../src/model/system';
import { SYSTEM_SECTIONS, systemLayout } from '../../src/ui/system-pages';

describe('SYSTEM pages in the control tab', () => {
  it('every SYSTEM parameter is reachable (all memories, both EQ types)', () => {
    const seen = new Set<string>();
    for (const sel of [0, 1, 2])
      for (const type of [0, 1])
        for (const lo of [0, 1])
          for (const sec of SYSTEM_SECTIONS) {
            const values: Record<string, number> = {
              'system.globalEq.select': sel,
              [`system.globalEq.${sel + 1}.type`]: type,
              'system.lineOut.select': lo,
            };
            const l = systemLayout(sec, (k) => values[k]);
            for (const p of [...l.head, ...l.pages.flatMap((pg) => [...pg.choices, ...pg.knobs])])
              seen.add(p.key);
          }
    const missing = SYSTEM_PARAMS.map((p) => p.key).filter((k) => !seen.has(k));
    // On/off and memory are the row of their own above the global EQ pages; the GA-FC function mode sits in the
    // area "Switches".
    expect(missing).toEqual([
      'system.globalEq.on',
      'system.globalEq.select',
      'system.gafc.sw1',
      'system.gafc.sw2',
      'system.gafc.sw3',
      'system.gafc.sw4',
      'system.gafc.panel',
    ]);
  });

  it('no page holds more than six knobs or eight choices', () => {
    for (const sec of SYSTEM_SECTIONS) {
      for (const p of systemLayout(sec, () => 0).pages) {
        expect(p.knobs.length, `${sec} ${p.title}`).toBeLessThanOrEqual(6);
        expect(p.choices.length, `${sec} ${p.title}`).toBeLessThanOrEqual(8);
      }
    }
  });

  it('MIDI: channel on top, CC in three pages of choices, PC in two pages of knobs', () => {
    const l = systemLayout('midi', () => 0);
    expect(l.head.map((p) => p.key)).toEqual(['system.midi.channel']);
    expect(l.pages.map((p) => p.title)).toEqual(['CC 1/3', 'CC 2/3', 'CC 3/3', 'PC 1/2', 'PC 2/2']);
  });
});
