import { DETACH_DISTANCE, SNAP_DISTANCE } from '../chains/bounds';
import {
  CHAIN_MOVE_HOLD_MS,
  crossedDetachDistance,
  decideDragRelease,
  isMultiUnitSelection,
  resolveNodeDragMode,
  resolveSelectionUnits,
  snapProbeChainId,
  worldDistance,
} from './dragLifecycle';

describe('worldDistance / crossedDetachDistance', () => {
  const home = { x: 100, y: 50 };

  test('distance is Euclidean in world units', () => {
    expect(worldDistance(home, { x: 103, y: 54 })).toBe(5);
  });

  test('detach fires at exactly DETACH_DISTANCE and beyond, not inside', () => {
    expect(crossedDetachDistance(home, { x: 100 + DETACH_DISTANCE - 1, y: 50 })).toBe(false);
    expect(crossedDetachDistance(home, { x: 100 + DETACH_DISTANCE, y: 50 })).toBe(true);
    expect(crossedDetachDistance(home, { x: 100 + DETACH_DISTANCE + 1, y: 50 })).toBe(true);
  });

  test('DETACH_DISTANCE stays strictly above SNAP_DISTANCE (hysteresis premise)', () => {
    expect(DETACH_DISTANCE).toBeGreaterThan(SNAP_DISTANCE);
  });
});

describe('resolveNodeDragMode', () => {
  const base = {
    wasChained: true,
    heldMs: 0,
    groupSelected: false,
    contextMenuOpen: false,
    longPressMovesChain: true,
  };

  test('free node is always free, regardless of dwell or group', () => {
    expect(
      resolveNodeDragMode({ ...base, wasChained: false, heldMs: 999, groupSelected: true }),
    ).toBe('free');
  });

  test('Select group forces moveChain (the §8.6 other route)', () => {
    expect(resolveNodeDragMode({ ...base, heldMs: 0, groupSelected: true })).toBe('moveChain');
  });

  test('open context menu blocks moveChain even after a long dwell', () => {
    expect(
      resolveNodeDragMode({
        ...base,
        heldMs: CHAIN_MOVE_HOLD_MS + 50,
        contextMenuOpen: true,
      }),
    ).toBe('detachMember');
  });

  test('assumption mapping: short drag detaches, dwell ≥ 200ms moves chain', () => {
    expect(resolveNodeDragMode({ ...base, heldMs: CHAIN_MOVE_HOLD_MS - 1 })).toBe('detachMember');
    expect(resolveNodeDragMode({ ...base, heldMs: CHAIN_MOVE_HOLD_MS })).toBe('moveChain');
  });

  test('opposite mapping: short drag moves chain, dwell ≥ 200ms detaches', () => {
    expect(
      resolveNodeDragMode({
        ...base,
        heldMs: 0,
        longPressMovesChain: false,
      }),
    ).toBe('moveChain');
    expect(
      resolveNodeDragMode({
        ...base,
        heldMs: CHAIN_MOVE_HOLD_MS,
        longPressMovesChain: false,
      }),
    ).toBe('detachMember');
  });
});

describe('resolveSelectionUnits / isMultiUnitSelection', () => {
  test('collapses selected members into distinct chains and free nodes', () => {
    const units = resolveSelectionUnits(new Set(['a', 'b', 'free', 'ghost']), {
      a: { chainId: 'c1' },
      b: { chainId: 'c1' },
      c: { chainId: 'c2' },
      free: { chainId: null },
    });
    expect(units.chainIds).toEqual(['c1']);
    expect(units.freeNodeIds).toEqual(['free']);
    // One chain + one free node is already multi-unit (Select all path).
    expect(isMultiUnitSelection(units)).toBe(true);
  });

  test('a single chain with no free nodes is not multi-unit (Select group)', () => {
    const units = resolveSelectionUnits(new Set(['a', 'b']), {
      a: { chainId: 'c1' },
      b: { chainId: 'c1' },
    });
    expect(units.chainIds).toEqual(['c1']);
    expect(units.freeNodeIds).toEqual([]);
    expect(isMultiUnitSelection(units)).toBe(false);
  });

  test('Select all across two chains is multi-unit', () => {
    const units = resolveSelectionUnits(new Set(['a', 'b']), {
      a: { chainId: 'c1' },
      b: { chainId: 'c2' },
    });
    expect(isMultiUnitSelection(units)).toBe(true);
  });

  test('two free nodes are multi-unit', () => {
    const units = resolveSelectionUnits(new Set(['a', 'b']), {
      a: { chainId: null },
      b: { chainId: null },
    });
    expect(units.chainIds).toEqual([]);
    expect(units.freeNodeIds).toEqual(['a', 'b']);
    expect(isMultiUnitSelection(units)).toBe(true);
  });
});

describe('snapProbeChainId (P6.7)', () => {
  test('ordinary member nulls chainId once detached so vacated chain can re-candidate', () => {
    expect(
      snapProbeChainId({ storeChainId: 'c1', detached: true, kind: 'number' }),
    ).toBeNull();
    expect(
      snapProbeChainId({ storeChainId: 'c1', detached: false, kind: 'number' }),
    ).toBe('c1');
  });

  test('result keeps store chainId even when session-detached (own-chain stays excluded)', () => {
    expect(
      snapProbeChainId({ storeChainId: 'c1', detached: true, kind: 'result' }),
    ).toBe('c1');
    expect(
      snapProbeChainId({ storeChainId: 'c1', detached: false, kind: 'result' }),
    ).toBe('c1');
  });
});

describe('decideDragRelease', () => {
  const position = { x: 200, y: 80 };
  const append = { kind: 'append' as const, chainId: 'c1' };

  test('snap candidate wins over detach or move', () => {
    expect(
      decideDragRelease({ wasChained: true, detached: true, candidate: append, position }),
    ).toEqual({ kind: 'snap', outcome: append });
    expect(
      decideDragRelease({ wasChained: false, detached: false, candidate: append, position }),
    ).toEqual({ kind: 'snap', outcome: append });
  });

  test('chained + detached + no candidate → detach at position', () => {
    expect(
      decideDragRelease({ wasChained: true, detached: true, candidate: null, position }),
    ).toEqual({ kind: 'detach', position });
  });

  test('result + chained + detached + no candidate → cancel (P6.7, never free)', () => {
    expect(
      decideDragRelease({
        wasChained: true,
        detached: true,
        candidate: null,
        position,
        isResult: true,
      }),
    ).toEqual({ kind: 'cancel' });
  });

  test('result + snap candidate still snaps (commit substitutes a reference)', () => {
    expect(
      decideDragRelease({
        wasChained: true,
        detached: true,
        candidate: append,
        position,
        isResult: true,
      }),
    ).toEqual({ kind: 'snap', outcome: append });
  });

  test('chained + never detached + no candidate → cancel (snap back)', () => {
    expect(
      decideDragRelease({ wasChained: true, detached: false, candidate: null, position }),
    ).toEqual({ kind: 'cancel' });
  });

  test('free + no candidate → move', () => {
    expect(
      decideDragRelease({ wasChained: false, detached: false, candidate: null, position }),
    ).toEqual({ kind: 'move', position });
  });
});
