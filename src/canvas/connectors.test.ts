import {
  buildConnectorScene,
  collectConnectorLinks,
  CONNECTOR_FAN_COLLAPSE_AT,
  CONNECTOR_NEUTRAL_HUE,
  CONNECTOR_UNSELECTED_OPACITY,
  connectorMarkerId,
  connectorPath,
  sortFanConsumers,
} from './connectors';
import { assignIdentityHues } from '../engine/identity';
import { identityHues } from '../ui/tokens';
import type {
  CalcNode,
  NumberNode,
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
});

describe('connectorMarkerId', () => {
  test('strips characters that are illegal in SVG fragment ids', () => {
    expect(connectorMarkerId('#2F6BFF')).toBe('cm-arrow-2F6BFF');
  });
});
