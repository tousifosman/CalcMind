import { hitTestNode } from './hitTest';
import { createNumberNode, createOperatorNode, createReferenceNode } from '../model/factories';
import { tokens } from '../ui/tokens';
import type { CalcNode } from '../model/types';

function byId(...nodes: CalcNode[]): Record<string, CalcNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n]));
}

describe('hitTestNode', () => {
  test('returns null for a point over empty canvas', () => {
    const nodes = byId(createNumberNode({ x: 0, y: 0 }, '5'));
    expect(hitTestNode(nodes, { x: 1000, y: 1000 }, 'en-US')).toBeNull();
  });

  test('returns the node whose bounds contain the point', () => {
    const number = createNumberNode({ x: 100, y: 100 }, '5');
    const nodes = byId(number);
    expect(hitTestNode(nodes, { x: 110, y: 120 }, 'en-US')).toBe(number);
  });

  test('a point just outside the box on every side misses', () => {
    const operator = createOperatorNode({ x: 0, y: 0 }, '+');
    const nodes = byId(operator);
    expect(hitTestNode(nodes, { x: -1, y: 0 }, 'en-US')).toBeNull();
    expect(hitTestNode(nodes, { x: tokens.operatorWidth + 1, y: 0 }, 'en-US')).toBeNull();
    expect(hitTestNode(nodes, { x: 0, y: -1 }, 'en-US')).toBeNull();
    expect(hitTestNode(nodes, { x: 0, y: tokens.nodeHeight + 1 }, 'en-US')).toBeNull();
  });

  test('the exact edges of the box are inside', () => {
    const operator = createOperatorNode({ x: 0, y: 0 }, '+');
    const nodes = byId(operator);
    expect(hitTestNode(nodes, { x: 0, y: 0 }, 'en-US')).toBe(operator);
    expect(hitTestNode(nodes, { x: tokens.operatorWidth, y: tokens.nodeHeight }, 'en-US')).toBe(
      operator,
    );
  });

  test('hits reference nodes (P4.9) without throwing', () => {
    const reference = createReferenceNode({ x: 0, y: 0 }, 'n_x');
    const nodes = byId(reference);
    expect(() => hitTestNode(nodes, { x: 0, y: 0 }, 'en-US')).not.toThrow();
    expect(hitTestNode(nodes, { x: 0, y: 0 }, 'en-US')).toBe(reference);
  });
});
