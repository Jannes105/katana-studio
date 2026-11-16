import { describe, expect, it } from 'vitest';
import { ADDR, formatAddress, type Address } from '../../src/protocol/address';
import { greet, modelName, signOff, type GreetingLink } from '../../src/protocol/greeting';

interface FakeAmp {
  manufacturerId?: number;
  modelCode?: number;
  editorLevel?: number;
  /** Editor mode reads back as this regardless of what was written (undefined: as written). */
  stuckEditorMode?: number;
  silent?: boolean;
}

function fakeLink(amp: FakeAmp = {}): { link: GreetingLink; log: string[] } {
  const log: string[] = [];
  let editorMode = 0;
  const link: GreetingLink = {
    identify() {
      log.push('identify');
      if (amp.silent) return Promise.reject(new Error('timeout'));
      return Promise.resolve({
        deviceId: 0x10,
        manufacturerId: amp.manufacturerId ?? 0x41,
        modelCode: amp.modelCode ?? 0x06,
      });
    },
    readBytes(address: Address, size: number) {
      log.push(`read ${formatAddress(address)} ${size}`);
      if (address === ADDR.editorLevel) return Promise.resolve([amp.editorLevel ?? 1]);
      if (address === ADDR.editorMode) return Promise.resolve([amp.stuckEditorMode ?? editorMode]);
      return Promise.reject(new Error('unexpected read'));
    },
    write(address: Address, data: readonly number[]) {
      log.push(`write ${formatAddress(address)} ${data.join(' ')}`);
      if (address === ADDR.editorMode) editorMode = data[0] ?? 0;
      return Promise.resolve();
    },
  };
  return { link, log };
}

describe('greeting', () => {
  it('runs the BTS order and switches editor mode on', async () => {
    const { link, log } = fakeLink();
    const result = await greet(link);
    expect(log).toEqual([
      'identify',
      'read 7F 00 00 00 1',
      'write 7F 00 00 01 1',
      'read 7F 00 00 01 1', // read back: the switch is not acknowledged
    ]);
    expect(result).toEqual({
      deviceId: 0x10,
      modelCode: 0x06,
      editorLevel: 1,
      editorMode: 1,
      warnings: [],
      readOnly: false,
    });
    expect(modelName(result.modelCode)).toBe('KATANA-100');
  });

  it('warns and goes read-only on another model, and writes nothing', async () => {
    const { link, log } = fakeLink({ modelCode: 0x07 });
    const result = await greet(link);
    expect(result.warnings).toEqual([{ kind: 'model', got: 0x07 }]);
    expect(result.readOnly).toBe(true);
    expect(result.editorMode).toBeNull();
    expect(log.some((l) => l.startsWith('write'))).toBe(false);
    expect(modelName(0x07)).toBe('unknown model (07)');
  });

  it('writes nothing for another manufacturer', async () => {
    const { link, log } = fakeLink({ manufacturerId: 0x43 });
    const result = await greet(link);
    expect(result.warnings).toEqual([{ kind: 'manufacturer', got: 0x43 }]);
    expect(log.some((l) => l.startsWith('write'))).toBe(false);
  });

  it('on another editor level: read-only, but editor mode still on (firmware update case)', async () => {
    const { link, log } = fakeLink({ editorLevel: 2 });
    const result = await greet(link);
    expect(result.warnings).toEqual([{ kind: 'editor-level', got: 2 }]);
    expect(result.readOnly).toBe(true);
    expect(result.editorMode).toBe(1);
    expect(log).toContain('write 7F 00 00 01 1');
  });

  it('warns but stays writable when editor mode does not read back', async () => {
    const result = await greet(fakeLink({ stuckEditorMode: 0 }).link);
    expect(result.warnings).toEqual([{ kind: 'editor-mode', got: 0 }]);
    expect(result.readOnly).toBe(false);
  });

  it('rejects when the amp does not answer', async () => {
    await expect(greet(fakeLink({ silent: true }).link)).rejects.toThrow('timeout');
  });

  it('signs off by switching editor mode off', async () => {
    const { link, log } = fakeLink();
    await signOff(link);
    expect(log).toEqual(['write 7F 00 00 01 0']);
  });
});
