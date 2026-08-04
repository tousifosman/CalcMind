import { DETACH_DISTANCE, SNAP_DISTANCE } from '../chains/bounds';
import {
  crossedDetachDistance,
  decideDragRelease,
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
