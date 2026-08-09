import {
  buildConnectorScene,
  collectConnectorLinks,
  CONNECTOR_FAN_COLLAPSE_AT,
  CONNECTOR_NEUTRAL_HUE,
  CONNECTOR_UNSELECTED_OPACITY,
  connectorMarkerId,
  connectorPath,
  nodesWithDragOverride,
  sortFanConsumers,
} from './connectors';
import { assignIdentityHues } from '../engine/identity';
import { identityHues } from '../ui/tokens';
import type {
  CalcNode,
  NumberNode,
  OperatorNode,
  ReferenceNode,
  ResultNode,
} from '../model/types';

function result(
  id: string,
  x: number,
  y: number,
  overrides: Partial<ResultNode> = {},
): ResultNode {
  return {
    id,
    kind: 'result',
    sourceChainId: 'c_src',
    position: { x, y },
    chainId: 'c_src',
    createdAt: 0,
    derived: { display: '1', computedAt: '2026-08-04T00:00:00.000Z' },
    ...overrides,
  };
}

function reference(
  id: string,
  targetNodeId: string,
  x: number,
  y: number,
): ReferenceNode {
  return {
    id,
    kind: 'reference',
    targetNodeId,
    position: { x, y },
    chainId: 'c_dep',
    createdAt: 0,
  };
}

function number(id: string, x: number, y: number, raw = '1'): NumberNode {
  return {
    id,
    kind: 'number',
    raw,
    position: { x, y },
    chainId: null,
    createdAt: 0,
  };
}

describe('collectConnectorLinks', () => {
  test('pairs each live reference with its target', () => {
    const nodes: Record<string, CalcNode> = {
      r1: result('r1', 0, 0),
      a: reference('a', 'r1', 0, 100),
      b: reference('b', 'r1', 80, 100),
    };
    expect(collectConnectorLinks(nodes)).toEqual([
      { sourceNodeId: 'r1', referenceNodeId: 'a' },
      { sourceNodeId: 'r1', referenceNodeId: 'b' },
    ]);
  });

  test('skips dangling references (no source to draw from)', () => {
    const nodes: Record<string, CalcNode> = {
      a: reference('a', 'missing', 0, 100),
    };
    expect(collectConnectorLinks(nodes)).toEqual([]);
  });
});

describe('sortFanConsumers', () => {
  test('orders left-to-right by reference x, then id', () => {
    const nodes: Record<string, CalcNode> = {
      r1: result('r1', 0, 0),
      right: reference('right', 'r1', 200, 100),
      left: reference('left', 'r1', 40, 100),
      midA: reference('midA', 'r1', 100, 100),
      midB: reference('midB', 'r1', 100, 100),
    };
    const sorted = sortFanConsumers(collectConnectorLinks(nodes), nodes);
    expect(sorted.map((l) => l.referenceNodeId)).toEqual([
      'left',
      'midA',
      'midB',
      'right',
    ]);
  });
});

describe('connectorPath', () => {
  test('emits a cubic from start to end', () => {
    const d = connectorPath(
      { x: 50, y: 64 },
      { x: 50, y: 160 },
      0,
      1,
      { left: 0, right: 100, top: 0, bottom: 64 },
    );
    expect(d).toMatch(/^M50 64 C/);
    expect(d).toMatch(/, 50 160$/);
  });

  test('fans exit points across the source bottom for 1→N', () => {
    const bounds = { left: 0, right: 100, top: 0, bottom: 64 };
    const start = { x: 50, y: 64 };
    const end = { x: 50, y: 160 };
    const left = connectorPath(start, end, 0, 3, bounds);
    const mid = connectorPath(start, end, 1, 3, bounds);
    const right = connectorPath(start, end, 2, 3, bounds);
    expect(left).not.toBe(mid);
    expect(mid).not.toBe(right);
    // Leftmost fan starts left of centre; rightmost right of centre.
    expect(left.startsWith('M36 64')).toBe(true);
    expect(right.startsWith('M64 64')).toBe(true);
  });
});

describe('buildConnectorScene', () => {
  test('draws every live link in the source identity hue', () => {
    const nodes: Record<string, CalcNode> = {
      r1: result('r1', 0, 0),
      a: reference('a', 'r1', 0, 120),
      b: reference('b', 'r1', 80, 120),
    };
    const hues = assignIdentityHues(nodes, identityHues);
    const scene = buildConnectorScene(nodes, hues, 'en-US', null);
    expect(scene.curves).toHaveLength(2);
    expect(scene.badges).toHaveLength(0);
    expect(scene.curves.every((c) => c.hue === identityHues[0])).toBe(true);
    expect(scene.curves.every((c) => c.opacity === 1)).toBe(true);
    expect(scene.hues).toEqual([identityHues[0]]);
    expect(scene.bounds).not.toBeNull();
  });

  test('collapses more than ~4 consumers to a count badge', () => {
    const nodes: Record<string, CalcNode> = {
      r1: result('r1', 100, 0),
    };
    for (let i = 0; i < CONNECTOR_FAN_COLLAPSE_AT; i++) {
      const id = `ref_${i}`;
      nodes[id] = reference(id, 'r1', i * 60, 140);
    }
    const hues = assignIdentityHues(nodes, identityHues);
    const scene = buildConnectorScene(nodes, hues, 'en-US', null);
    expect(scene.curves).toHaveLength(0);
    expect(scene.badges).toEqual([
      expect.objectContaining({
        sourceNodeId: 'r1',
        count: CONNECTOR_FAN_COLLAPSE_AT,
        hue: identityHues[0],
      }),
    ]);
  });

  test('expands a collapsed fan when the source is selected', () => {
    const nodes: Record<string, CalcNode> = {
      r1: result('r1', 100, 0),
    };
    for (let i = 0; i < CONNECTOR_FAN_COLLAPSE_AT; i++) {
      const id = `ref_${i}`;
      nodes[id] = reference(id, 'r1', i * 60, 140);
    }
    const hues = assignIdentityHues(nodes, identityHues);
    const scene = buildConnectorScene(nodes, hues, 'en-US', 'r1');
    expect(scene.badges).toHaveLength(0);
    expect(scene.curves).toHaveLength(CONNECTOR_FAN_COLLAPSE_AT);
  });

  test('expands a collapsed fan when one consumer is selected', () => {
    const nodes: Record<string, CalcNode> = {
      r1: result('r1', 100, 0),
    };
    for (let i = 0; i < CONNECTOR_FAN_COLLAPSE_AT; i++) {
      const id = `ref_${i}`;
      nodes[id] = reference(id, 'r1', i * 60, 140);
    }
    const hues = assignIdentityHues(nodes, identityHues);
    const scene = buildConnectorScene(nodes, hues, 'en-US', 'ref_2');
    expect(scene.curves).toHaveLength(CONNECTOR_FAN_COLLAPSE_AT);
  });

  test('fades unselected connectors rather than hiding them', () => {
    const nodes: Record<string, CalcNode> = {
      r1: result('r1', 0, 0),
      r2: result('r2', 200, 0),
      a: reference('a', 'r1', 0, 120),
      b: reference('b', 'r2', 200, 120),
    };
    const hues = assignIdentityHues(nodes, identityHues);
    const scene = buildConnectorScene(nodes, hues, 'en-US', 'a');
    expect(scene.curves).toHaveLength(2);
    const selected = scene.curves.find((c) => c.referenceNodeId === 'a');
    const other = scene.curves.find((c) => c.referenceNodeId === 'b');
    expect(selected?.opacity).toBe(1);
    expect(other?.opacity).toBe(CONNECTOR_UNSELECTED_OPACITY);
  });

  test('uses the neutral hue when the source has no identity colour', () => {
    // A labelled source normally has a hue; force an empty map to prove the
    // non-chromatic fallback still draws the line.
    const nodes: Record<string, CalcNode> = {
      n1: number('n1', 0, 0),
      a: reference('a', 'n1', 0, 120),
    };
    const scene = buildConnectorScene(nodes, new Map(), 'en-US', null);
    expect(scene.curves).toHaveLength(1);
    expect(scene.curves[0]!.hue).toBe(CONNECTOR_NEUTRAL_HUE);
  });

  test('collapsed badge-only sources do not emit arrowhead marker hues', () => {
    const nodes: Record<string, CalcNode> = {
      r1: result('r1', 100, 0),
    };
    for (let i = 0; i < CONNECTOR_FAN_COLLAPSE_AT; i++) {
      const id = `ref_${i}`;
      nodes[id] = reference(id, 'r1', i * 60, 140);
    }
    const hues = assignIdentityHues(nodes, identityHues);
    const scene = buildConnectorScene(nodes, hues, 'en-US', null);
    expect(scene.badges).toHaveLength(1);
    expect(scene.hues).toEqual([]);
  });

  test('mid-drag override moves the dragged endpoint before store commit', () => {
    const nodes: Record<string, CalcNode> = {
      r1: result('r1', 0, 0),
      a: reference('a', 'r1', 0, 120),
    };
    const hues = assignIdentityHues(nodes, identityHues);
    const idle = buildConnectorScene(nodes, hues, 'en-US', null);
    const live = buildConnectorScene(nodes, hues, 'en-US', null, {
      nodeId: 'a',
      position: { x: 80, y: 200 },
      movingChainId: null,
    });
    expect(idle.curves[0]!.d).not.toBe(live.curves[0]!.d);
    // End point sits on the live top edge (y = 200), not the store's y = 120.
    expect(live.curves[0]!.d).toMatch(/ 200$/);
  });

  test('MovingChain override offsets sibling members of the same chain', () => {
    const op: OperatorNode = {
      id: 'op',
      kind: 'operator',
      op: '+',
      position: { x: 100, y: 120 },
      chainId: 'c_dep',
      createdAt: 0,
    };
    const nodes: Record<string, CalcNode> = {
      r1: result('r1', 0, 0),
      a: { ...reference('a', 'r1', 40, 120), chainId: 'c_dep' },
      op,
    };

    const overridden = nodesWithDragOverride(nodes, {
      nodeId: 'op',
      position: { x: 160, y: 180 },
      movingChainId: 'c_dep',
    });
    expect(overridden.op!.position).toEqual({ x: 160, y: 180 });
    // Same delta (+60, +60) applied to the sibling reference.
    expect(overridden.a!.position).toEqual({ x: 100, y: 180 });
    // Untouched chain stays put.
    expect(overridden.r1!.position).toEqual({ x: 0, y: 0 });
  });

  test('movingSelection offsets every listed chain and free node by the drag delta', () => {
    const nodes: Record<string, CalcNode> = {
      r1: result('r1', 0, 0),
      a: { ...reference('a', 'r1', 40, 120), chainId: 'c_dep' },
      free: number('free', 200, 40),
      other: number('other', 300, 40),
    };

    const overridden = nodesWithDragOverride(nodes, {
      nodeId: 'a',
      position: { x: 70, y: 150 },
      movingChainId: null,
      movingSelection: {
        chainIds: ['c_dep'],
        freeNodeIds: ['free'],
      },
    });
    expect(overridden.a!.position).toEqual({ x: 70, y: 150 });
    // free moves by the same (+30, +30) delta; other is outside the selection.
    expect(overridden.free!.position).toEqual({ x: 230, y: 70 });
    expect(overridden.other!.position).toEqual({ x: 300, y: 40 });
    expect(overridden.r1!.position).toEqual({ x: 0, y: 0 });
  });
});

describe('connectorMarkerId', () => {
  test('strips characters that are illegal in SVG fragment ids', () => {
    expect(connectorMarkerId('#2F6BFF')).toBe('cm-arrow-2F6BFF');
  });
});
