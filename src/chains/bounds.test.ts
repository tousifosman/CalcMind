import {
  SNAP_VERTICAL,
  boundsOf,
  makeLinearSnappingNeighbours,
  makeSnappingNeighbours,
  makeSpatialHashSnappingNeighbours,
  memberBoundaries,
  verticalOverlap,
} from './bounds';
import { widthOf } from './measure';
import { tokens } from '../ui/tokens';
import type { CalcNode, Chain, NumberNode, OperatorNode } from '../model/types';

function numberNode(id: string, raw: string, position = { x: 0, y: 0 }, chainId: string | null = null): NumberNode {
  return { id, kind: 'number', raw, position, chainId, createdAt: 0 };
}

function operatorNode(id: string, op: OperatorNode['op'] = '+', position = { x: 0, y: 0 }, chainId: string | null = null): OperatorNode {
  return { id, kind: 'operator', op, position, chainId, createdAt: 0 };
}

function chain(id: string, members: string[], anchor = { x: 100, y: 200 }): Chain {
  return { id, anchor, members };
}

describe('boundsOf', () => {
  test('returns top-left anchored bounds with widthOf(node) and nodeHeight', () => {
    const node = numberNode('n1', '123', { x: 10, y: 20 });

    expect(boundsOf(node, 'en-US')).toEqual({
      left: 10,
      right: 10 + widthOf(node, 'en-US'),
      top: 20,
      bottom: 20 + tokens.nodeHeight,
    });
  });
});

describe('verticalOverlap', () => {
  const a = { left: 0, right: 10, top: 0, bottom: 10 };

  test('returns zero when boxes overlap vertically', () => {
    expect(verticalOverlap(a, { left: 0, right: 10, top: 5, bottom: 15 })).toBe(0);
  });

  test('returns zero when boxes only touch at the edge', () => {
    expect(verticalOverlap(a, { left: 0, right: 10, top: 10, bottom: 20 })).toBe(0);
  });

  test('returns the vertical gap when boxes are separated', () => {
    expect(verticalOverlap(a, { left: 0, right: 10, top: 13, bottom: 23 })).toBe(3);
    expect(verticalOverlap(a, { left: 0, right: 10, top: -8, bottom: -2 })).toBe(2);
  });
});

describe('memberBoundaries', () => {
  test('returns insertion boundaries between each adjacent member', () => {
    const a = numberNode('a', '12', { x: 100, y: 200 }, 'c1');
    const op = operatorNode('op', '+', { x: 0, y: 0 }, 'c1');
    const b = numberNode('b', '345', { x: 0, y: 0 }, 'c1');
    const nodes: Record<string, CalcNode> = { a, op, b };
    const c = chain('c1', ['a', 'op', 'b']);

    expect(memberBoundaries(c, nodes, 'en-US')).toEqual([
      { index: 1, x: c.anchor.x + widthOf(a, 'en-US') },
      { index: 2, x: c.anchor.x + widthOf(a, 'en-US') + widthOf(op, 'en-US') },
    ]);
  });

  test('skips missing members rather than inventing a boundary from stale ids', () => {
    const a = numberNode('a', '1', { x: 100, y: 200 }, 'c1');
    const b = numberNode('b', '2', { x: 0, y: 0 }, 'c1');
    const nodes: Record<string, CalcNode> = { a, b };
    const c = chain('c1', ['a', 'ghost', 'b']);

    expect(memberBoundaries(c, nodes, 'en-US')).toEqual([{ index: 1, x: 100 + widthOf(a, 'en-US') }]);
  });
});

const neighbourFactories = [
  ['linear', makeLinearSnappingNeighbours],
  ['spatial-hash', makeSpatialHashSnappingNeighbours],
  ['default (spatial-hash)', makeSnappingNeighbours],
] as const;

describe.each(neighbourFactories)('makeSnappingNeighbours (%s)', (_label, factory) => {
  test('returns only chains within the exact snap-vertical threshold and excludes the node\'s own chain', () => {
    const dragged = numberNode('dragged', '5', { x: 20, y: 0 }, null);
    const nearY = tokens.nodeHeight + SNAP_VERTICAL - 1;
    const farY = tokens.nodeHeight + SNAP_VERTICAL;
    const nearMember = numberNode('nearMember', '1', { x: 100, y: nearY }, 'near');
    const farMember = numberNode('farMember', '1', { x: 100, y: farY }, 'far');
    const ownMember = numberNode('ownMember', '1', { x: 100, y: 10 }, 'own');
    const nodes: Record<string, CalcNode> = { dragged, nearMember, farMember, ownMember };
    const chains = {
      near: chain('near', ['nearMember'], { x: 100, y: nearY }),
      far: chain('far', ['farMember'], { x: 100, y: farY }),
      own: chain('own', ['ownMember'], { x: 100, y: 10 }),
    };
    const ownDragged = { ...dragged, chainId: 'own' };

    const neighbours = factory(chains, nodes, 'en-US');

    expect(neighbours.chainsNear(dragged).map((c) => c.id)).toEqual(['near', 'own']);
    expect(neighbours.chainsNear(ownDragged).map((c) => c.id)).toEqual(['near']);
  });

  test('returns only free nodes within the exact snap-vertical threshold, excluding self and references', () => {
    const dragged = numberNode('dragged', '5', { x: 20, y: 0 });
    const near = numberNode('near', '1', { x: 100, y: tokens.nodeHeight + SNAP_VERTICAL - 1 });
    const far = numberNode('far', '1', { x: 100, y: tokens.nodeHeight + SNAP_VERTICAL });
    const chained = numberNode('chained', '1', { x: 100, y: 10 }, 'c1');
    const reference = {
      ...numberNode('ref', '1', { x: 100, y: 10 }),
      kind: 'reference' as const,
      targetNodeId: 'target',
    };
    const nodes: Record<string, CalcNode> = { dragged, near, far, chained, reference };

    const neighbours = factory({}, nodes, 'en-US');

    expect(neighbours.freeNodesNear(dragged).map((node) => node.id)).toEqual(['near']);
  });
});

describe('linear vs spatial-hash neighbour parity', () => {
  test('chainsNear and freeNodesNear return the same ids for a scattered document', () => {
    const nodes: Record<string, CalcNode> = {};
    const chains: Record<string, Chain> = {};
    for (let i = 0; i < 40; i += 1) {
      const x = (i % 8) * 150;
      const y = Math.floor(i / 8) * 100;
      if (i % 3 === 0) {
        const id = `f${i}`;
        nodes[id] = numberNode(id, String(i), { x, y });
      } else {
        const cid = `c${i}`;
        const a = numberNode(`a${i}`, '1', { x, y }, cid);
        nodes[a.id] = a;
        chains[cid] = chain(cid, [a.id], { x, y });
      }
    }
    const dragged = numberNode('dragged', '9', { x: 160, y: 105 });
    nodes[dragged.id] = dragged;

    const linear = makeLinearSnappingNeighbours(chains, nodes, 'en-US');
    const hashed = makeSpatialHashSnappingNeighbours(chains, nodes, 'en-US');

    expect(hashed.chainsNear(dragged).map((c) => c.id)).toEqual(
      linear.chainsNear(dragged).map((c) => c.id),
    );
    expect(hashed.freeNodesNear(dragged).map((n) => n.id)).toEqual(
      linear.freeNodesNear(dragged).map((n) => n.id),
    );
  });
});
