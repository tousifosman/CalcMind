import {
  AUTOSAVE_DEBOUNCE_MS,
  createAutosave,
} from './autosave';
import { serializeDocument } from './serialize';
import { createEmptyDocument } from '../model/factories';
import type { CalcDocument } from '../model/types';

function makeHarness(initial?: CalcDocument) {
  let doc = initial ?? createEmptyDocument('Autosave fixture');
  const writes: Array<{ id: string; json: string }> = [];
  const savedAt: string[] = [];
  let clock = 0;

  const controller = createAutosave({
    getDocument: () => doc,
    write: async (id, json) => {
      writes.push({ id, json });
    },
    onSaved: at => {
      savedAt.push(at);
    },
    now: () => {
      clock += 1;
      return `2026-08-04T00:00:0${clock}.000Z`;
    },
  });

  return {
    controller,
    writes,
    savedAt,
    setDoc: (next: CalcDocument) => {
      doc = next;
    },
    getDoc: () => doc,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createAutosave', () => {
  test('markDirty debounces writes by AUTOSAVE_DEBOUNCE_MS', async () => {
    const { controller, writes, getDoc } = makeHarness();
    controller.markDirty();
    expect(writes).toHaveLength(0);

    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(writes).toHaveLength(0);

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await controller.flush(); // drain any in-flight chain
    expect(writes).toHaveLength(1);
    expect(writes[0].id).toBe(getDoc().id);
    expect(writes[0].json).toBe(serializeDocument(getDoc()));
  });

  test('rapid markDirty coalesces into one write after the quiet window', async () => {
    const { controller, writes } = makeHarness();
    controller.markDirty();
    jest.advanceTimersByTime(200);
    controller.markDirty();
    jest.advanceTimersByTime(200);
    controller.markDirty();
    expect(writes).toHaveLength(0);

    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await controller.flush();
    expect(writes).toHaveLength(1);
  });

  test('flush writes immediately and cancels the pending debounce', async () => {
    const { controller, writes, savedAt } = makeHarness();
    controller.markDirty();
    await controller.flush();
    expect(writes).toHaveLength(1);
    expect(savedAt).toEqual(['2026-08-04T00:00:01.000Z']);

    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    expect(writes).toHaveLength(1);
  });

  test('save is an alias for flush', async () => {
    const { controller, writes } = makeHarness();
    controller.markDirty();
    await controller.save();
    expect(writes).toHaveLength(1);
  });

  test('suppress blocks debounced writes; resume reschedules if still dirty', async () => {
    const { controller, writes } = makeHarness();
    controller.setSuppressed(true);
    controller.markDirty();
    expect(controller.isDirty()).toBe(true);
    expect(controller.isSuppressed()).toBe(true);

    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    expect(writes).toHaveLength(0);

    controller.setSuppressed(false);
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await controller.flush();
    expect(writes).toHaveLength(1);
  });

  test('flush still writes while suppressed (force-flush / kill-safety)', async () => {
    const { controller, writes } = makeHarness();
    controller.setSuppressed(true);
    controller.markDirty();
    await controller.flush();
    expect(writes).toHaveLength(1);
  });

  test('prepareDocumentSwitch flushes then clears dirty without a second write', async () => {
    const { controller, writes, setDoc } = makeHarness();
    controller.markDirty();
    await controller.prepareDocumentSwitch();
    expect(writes).toHaveLength(1);
    expect(controller.isDirty()).toBe(false);

    setDoc(createEmptyDocument('Other'));
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    expect(writes).toHaveLength(1);
  });

  test('concurrent markDirty during a write re-arms a follow-up save', async () => {
    // Real timers: this test gates on promises, not the debounce clock.
    jest.useRealTimers();

    let releaseWrite!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    let enteredWrite!: () => void;
    const entered = new Promise<void>(resolve => {
      enteredWrite = resolve;
    });
    let doc = createEmptyDocument('Gated');
    const writes: string[] = [];

    const controller = createAutosave({
      getDocument: () => doc,
      write: async (_id, json) => {
        writes.push(json);
        enteredWrite();
        await gate;
      },
      onSaved: () => {},
      now: () => 't',
    });

    controller.markDirty();
    const first = controller.flush();
    await entered;
    // Snapshot already taken with the original name; a new mutation must re-arm.
    doc = { ...doc, name: 'Changed mid-write' };
    controller.markDirty();
    releaseWrite();
    await first;
    await controller.flush();
    expect(writes).toHaveLength(2);
    expect(writes[0]).toContain('Gated');
    expect(writes[1]).toContain('Changed mid-write');
    controller.dispose();
  });
});

describe('autosave lifecycle listeners', () => {
  test('AppState background force-flushes', async () => {
    const { controller, writes } = makeHarness();
    const listeners: Array<(state: string) => void> = [];
    const addEventListener = jest.spyOn(
      require('react-native').AppState,
      'addEventListener',
    );
    addEventListener.mockImplementation((_type: string, cb: (s: string) => void) => {
      listeners.push(cb);
      return { remove: jest.fn() };
    });

    const detach = controller.attachLifecycleListeners();
    controller.markDirty();
    expect(writes).toHaveLength(0);

    listeners.forEach(cb => cb('background'));
    await controller.flush();
    expect(writes).toHaveLength(1);

    detach();
    addEventListener.mockRestore();
  });
});
