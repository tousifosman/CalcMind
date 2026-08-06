import {
  DETACH_DISTANCE,
  SNAP_DISTANCE,
  SNAP_VERTICAL,
  makeLinearSnappingNeighbours,
  makeSpatialHashSnappingNeighbours,
  type SnappingNeighbours,
} from './bounds';
import { resolveSnapCandidate, type SnapOutcome } from './snapping';
import { widthOf } from './measure';
import { tokens } from '../ui/tokens';
import type { CalcNode, Chain, NumberNode, OperatorNode } from '../model/types';

const LOCALE = 'en-US';

type NeighbourFactory = (
  chains: Record<string, Chain>,
  nodes: Record<string, CalcNode>,
  locale: string,
) => SnappingNeighbours;

/** P7.6: same snap suite must pass against both neighbour implementations. */
const neighbourFactories: ReadonlyArray<readonly [string, NeighbourFactory]> = [
  ['linear', makeLinearSnappingNeighbours],
  ['spatial-hash', makeSpatialHashSnappingNeighbours],
];

function numberNode(
  id: string,
  raw: string,
  position = { x: 0, y: 0 },
  chainId: string | null = null,
): NumberNode {
  return { id, kind: 'number', raw, position, chainId, createdAt: 0 };
}

function operatorNode(
  id: string,
  op: OperatorNode['op'] = '+',
  position = { x: 0, y: 0 },
  chainId: string | null = null,
): OperatorNode {
  return { id, kind: 'operator', op, position, chainId, createdAt: 0 };
}

function chain(id: string, members: string[], anchor = { x: 100, y: 0 }): Chain {
  return { id, anchor, members };
}

function resolveWith(
  factory: NeighbourFactory,
  dragged: CalcNode,
  chains: Record<string, Chain>,
  nodes: Record<string, CalcNode>,
): SnapOutcome | null {
  return resolveSnapCandidate(
    dragged,
    factory(chains, nodes, LOCALE),
    nodes,
    LOCALE,
  );
}

/** Place `dragged` so its left edge is `delta` world units from `edgeX`.
 *  Positive delta = to the right of the edge. */
function atLeftDelta(
  id: string,
  edgeX: number,
  delta: number,
  y = 0,
  chainId: string | null = null,
): NumberNode {
  return numberNode(id, '5', { x: edgeX + delta, y }, chainId);
}

/** Place `dragged` so its right edge is `delta` world units from `edgeX`. */
function atRightDelta(
  id: string,
  edgeX: number,
  delta: number,
  y = 0,
  chainId: string | null = null,
): NumberNode {
  const node = numberNode(id, '5', { x: 0, y }, chainId);
  const w = widthOf(node, LOCALE);
  return { ...node, position: { x: edgeX + delta - w, y } };
}

describe.each(neighbourFactories)('resolveSnapCandidate (%s)', (_label, factory) => {
  const resolve = (
    dragged: CalcNode,
    chains: Record<string, Chain>,
    nodes: Record<string, CalcNode>,
  ) => resolveWith(factory, dragged, chains, nodes);

  describe('chain append / prepend at SNAP_DISTANCE', () => {
  // Single-member chain: left = 100, right = 100 + nodeHeight (64).
  const member = numberNode('m', '1', { x: 100, y: 0 }, 'c1');
  const c1 = chain('c1', ['m'], { x: 100, y: 0 });
  const chainRight = 100 + widthOf(member, LOCALE);
  const chainLeft = 100;

  test.each([
    {
      name: 'APPEND just inside threshold',
      dragged: atLeftDelta('d', chainRight, SNAP_DISTANCE - 1),
      expected: { kind: 'append', chainId: 'c1' } satisfies SnapOutcome,
    },
    {
      name: 'APPEND exactly at SNAP_DISTANCE is outside (strict <)',
      dragged: atLeftDelta('d', chainRight, SNAP_DISTANCE),
      expected: null,
    },
    {
      name: 'APPEND just inside from the left (overlapping the chain end)',
      dragged: atLeftDelta('d', chainRight, -(SNAP_DISTANCE - 1)),
      expected: { kind: 'append', chainId: 'c1' } satisfies SnapOutcome,
    },
    {
      name: 'PREPEND just inside threshold',
      dragged: atRightDelta('d', chainLeft, -(SNAP_DISTANCE - 1)),
      expected: { kind: 'prepend', chainId: 'c1' } satisfies SnapOutcome,
    },
    {
      name: 'PREPEND exactly at SNAP_DISTANCE is outside',
      dragged: atRightDelta('d', chainLeft, -SNAP_DISTANCE),
      expected: null,
    },
  ])('$name', ({ dragged, expected }) => {
    const nodes = { m: member, d: dragged };
    expect(resolve(dragged, { c1 }, nodes)).toEqual(expected);
  });
});

describe('INSERT_AT at member boundaries', () => {
  const a = numberNode('a', '12', { x: 100, y: 0 }, 'c1');
  const op = operatorNode('op', '+', { x: 0, y: 0 }, 'c1');
  const b = numberNode('b', '3', { x: 0, y: 0 }, 'c1');
  const c1 = chain('c1', ['a', 'op', 'b'], { x: 100, y: 0 });
  // Boundary between a and op (insert index 1).
  const boundaryX = 100 + widthOf(a, LOCALE);
  const halfW = tokens.nodeHeight / 2;

  // Place centerX left of boundary 1 so boundary 2 (op|b) stays outside SNAP_DISTANCE —
  // otherwise nearest-wins would prefer the closer second boundary.
  const insideOffset = SNAP_DISTANCE - 1;
  const outsideOffset = SNAP_DISTANCE;
  const boundary2X = boundaryX + widthOf(op, LOCALE);

  test.each([
    {
      name: 'INSERT just inside threshold at first boundary',
      dragged: numberNode('d', '5', {
        x: boundaryX - insideOffset - halfW,
        y: 0,
      }),
      expected: { kind: 'insert', chainId: 'c1', index: 1 } satisfies SnapOutcome,
    },
    {
      name: 'INSERT exactly at SNAP_DISTANCE is outside',
      dragged: numberNode('d', '5', {
        x: boundaryX - outsideOffset - halfW,
        y: 0,
      }),
      expected: null,
    },
    {
      name: 'INSERT at second boundary (between op and b)',
      // Align centerX with boundary 2; |boundary2 - boundary1| = operatorWidth (34) ≥ SNAP_DISTANCE,
      // so boundary 1 is not also a candidate.
      dragged: numberNode('d', '5', { x: boundary2X - halfW, y: 0 }),
      expected: { kind: 'insert', chainId: 'c1', index: 2 } satisfies SnapOutcome,
    },
  ])('$name', ({ dragged, expected }) => {
    const nodes = { a, op, b, d: dragged };
    expect(resolve(dragged, { c1 }, nodes)).toEqual(expected);
  });
});

describe('NEW_CHAIN with a free node', () => {
  const free = numberNode('f', '7', { x: 200, y: 0 });
  const freeRight = 200 + widthOf(free, LOCALE);
  const freeLeft = 200;

  test.each([
    {
      name: 'dragged to the right of free → NEW_CHAIN [free, dragged]',
      dragged: atLeftDelta('d', freeRight, SNAP_DISTANCE - 1),
      expected: { kind: 'newChain', leftId: 'f', rightId: 'd' } satisfies SnapOutcome,
    },
    {
      name: 'dragged to the left of free → NEW_CHAIN [dragged, free]',
      dragged: atRightDelta('d', freeLeft, -(SNAP_DISTANCE - 1)),
      expected: { kind: 'newChain', leftId: 'd', rightId: 'f' } satisfies SnapOutcome,
    },
    {
      name: 'exactly SNAP_DISTANCE from free right edge → none',
      dragged: atLeftDelta('d', freeRight, SNAP_DISTANCE),
      expected: null,
    },
    {
      name: 'exactly SNAP_DISTANCE from free left edge → none',
      dragged: atRightDelta('d', freeLeft, -SNAP_DISTANCE),
      expected: null,
    },
  ])('$name', ({ dragged, expected }) => {
    const nodes = { f: free, d: dragged };
    expect(resolve(dragged, {}, nodes)).toEqual(expected);
  });
});

describe('nearest wins', () => {
  test('closer chain append beats a farther free-node new-chain', () => {
    const member = numberNode('m', '1', { x: 100, y: 0 }, 'c1');
    const c1 = chain('c1', ['m'], { x: 100, y: 0 });
    const chainRight = 100 + widthOf(member, LOCALE);
    // Free node well clear of the dragged node's snap radius so only the chain qualifies.
    const free = numberNode('f', '9', { x: chainRight + 200, y: 0 });
    // Dragged sits SNAP_DISTANCE-1 past the chain (near) and farther from free.
    const dragged = atLeftDelta('d', chainRight, SNAP_DISTANCE - 1);
    const nodes = { m: member, f: free, d: dragged };

    expect(resolve(dragged, { c1 }, nodes)).toEqual({
      kind: 'append',
      chainId: 'c1',
    });
  });

  test('closer free node beats a farther chain prepend', () => {
    const member = numberNode('m', '1', { x: 300, y: 0 }, 'c1');
    const c1 = chain('c1', ['m'], { x: 300, y: 0 });
    const free = numberNode('f', '9', { x: 100, y: 0 });
    const freeRight = 100 + widthOf(free, LOCALE);
    // Near the free node; far from the chain at x=300.
    const dragged = atLeftDelta('d', freeRight, 5);
    const nodes = { m: member, f: free, d: dragged };

    expect(resolve(dragged, { c1 }, nodes)).toEqual({
      kind: 'newChain',
      leftId: 'f',
      rightId: 'd',
    });
  });
});

describe('vertical gate is inherited from neighbours', () => {
  test('a horizontally-perfect append still returns none when vertically out of range', () => {
    const member = numberNode('m', '1', { x: 100, y: 0 }, 'c1');
    const farY = tokens.nodeHeight + SNAP_VERTICAL; // excluded by strict <
    const c1 = chain('c1', ['m'], { x: 100, y: farY });
    const memberFar = { ...member, position: { x: 100, y: farY } };
    const chainRight = 100 + widthOf(member, LOCALE);
    const dragged = atLeftDelta('d', chainRight, 0, 0);
    const nodes = { m: memberFar, d: dragged };

    expect(resolve(dragged, { c1 }, nodes)).toBeNull();
  });
});

describe('detach hysteresis (§8.2)', () => {
  // DETACH_DISTANCE (44) > SNAP_DISTANCE (28) is what stops a just-detached
  // member from immediately re-snapping into the slot it left. After detach the
  // node is free and the chain no longer lists it; place it DETACH_DISTANCE
  // past the insertion boundary that used to hold it and assert no candidate.
  test('just past DETACH_DISTANCE from the vacated insert slot does not re-snap', () => {
    const a = numberNode('a', '12', { x: 100, y: 0 }, 'c1');
    const c = numberNode('c', '3', { x: 0, y: 0 }, 'c1');
    // Chain after B detached: [a, c]. The vacated slot is the boundary between them.
    const c1 = chain('c1', ['a', 'c'], { x: 100, y: 0 });
    const slotX = 100 + widthOf(a, LOCALE);
    const halfW = tokens.nodeHeight / 2;
    // centerX = slotX + DETACH_DISTANCE → just at/past detach from the old home.
    const dragged = numberNode('b', '5', {
      x: slotX + DETACH_DISTANCE - halfW,
      y: 0,
    });
    const nodes = { a, c, b: dragged };

    // Sanity: the geometric claim this test rests on.
    expect(DETACH_DISTANCE).toBeGreaterThan(SNAP_DISTANCE);
    expect(resolve(dragged, { c1 }, nodes)).toBeNull();
  });

  test('the same slot re-accepts the node once it returns inside SNAP_DISTANCE', () => {
    const a = numberNode('a', '12', { x: 100, y: 0 }, 'c1');
    const c = numberNode('c', '3', { x: 0, y: 0 }, 'c1');
    const c1 = chain('c1', ['a', 'c'], { x: 100, y: 0 });
    const slotX = 100 + widthOf(a, LOCALE);
    const halfW = tokens.nodeHeight / 2;
    const dragged = numberNode('b', '5', {
      x: slotX + (SNAP_DISTANCE - 1) - halfW,
      y: 0,
    });
    const nodes = { a, c, b: dragged };

    expect(resolve(dragged, { c1 }, nodes)).toEqual({
      kind: 'insert',
      chainId: 'c1',
      index: 1,
    });
  });

  test('just past DETACH_DISTANCE from a chain end does not APPEND', () => {
    const member = numberNode('m', '1', { x: 100, y: 0 }, 'c1');
    const c1 = chain('c1', ['m'], { x: 100, y: 0 });
    const chainRight = 100 + widthOf(member, LOCALE);
    // A trailing member dragged right past detach — distance to the end is
    // DETACH_DISTANCE, which is outside SNAP_DISTANCE.
    const dragged = atLeftDelta('d', chainRight, DETACH_DISTANCE);
    const nodes = { m: member, d: dragged };

    expect(resolve(dragged, { c1 }, nodes)).toBeNull();
  });
});

describe('own chain excluded while still a member', () => {
  test('a chain member does not resolve PREPEND/APPEND/INSERT against its own chain', () => {
    const a = numberNode('a', '1', { x: 100, y: 0 }, 'c1');
    const b = numberNode('b', '2', { x: 164, y: 0 }, 'c1');
    const c1 = chain('c1', ['a', 'b'], { x: 100, y: 0 });
    // Drag b only a few units — still well inside SNAP_DISTANCE of the slot —
    // but neighbours.chainsNear excludes own chain, so outcome is none until
    // detach clears chainId (P3.5) and the hysteresis gap takes over.
    const dragged = { ...b, position: { x: 164 + 10, y: 0 } };
    const nodes = { a, b: dragged };

    expect(resolve(dragged, { c1 }, nodes)).toBeNull();
  });
});
}); // end describe.each neighbourFactories
