import { layoutChain } from './layout';
import { widthOf } from './measure';
import type { CalcNode, Chain, NumberNode, OperatorNode } from '../model/types';

function numberNode(id: string, raw: string): NumberNode {
  return { id, kind: 'number', raw, position: { x: -1, y: -1 }, chainId: 'c1', createdAt: 0 };
}

function operatorNode(id: string, op: OperatorNode['op'] = '+'): OperatorNode {
  return { id, kind: 'operator', op, position: { x: -1, y: -1 }, chainId: 'c1', createdAt: 0 };
}

function chain(members: string[], anchor = { x: 100, y: 200 }): Chain {
  return { id: 'c1', anchor, members };
}

describe('layoutChain: flush left-to-right from anchor', () => {
  test('lays members out with no gaps and no overlaps, all at anchor.y', () => {
    const a = numberNode('a', '12');
    const op = operatorNode('op');
    const b = numberNode('b', '345');
    const nodes: Record<string, CalcNode> = { a, op, b };
    const c = chain(['a', 'op', 'b']);

    const positions = layoutChain(c, nodes, 'en-US');

    expect(positions.a).toEqual({ x: c.anchor.x, y: c.anchor.y });
    expect(positions.op).toEqual({ x: c.anchor.x + widthOf(a, 'en-US'), y: c.anchor.y });
    expect(positions.b).toEqual({
      x: c.anchor.x + widthOf(a, 'en-US') + widthOf(op, 'en-US'),
      y: c.anchor.y,
    });
    // No gap: each member's left edge equals the previous member's right edge.
    expect(positions.op.x).toBe(positions.a.x + widthOf(a, 'en-US'));
    expect(positions.b.x).toBe(positions.op.x + widthOf(op, 'en-US'));
  });

  test('a single-member chain sits exactly at the anchor', () => {
    const a = numberNode('a', '7');
    const c = chain(['a']);
    const positions = layoutChain(c, { a }, 'en-US');
    expect(positions.a).toEqual({ x: c.anchor.x, y: c.anchor.y });
  });

  test('a member id with no matching node is skipped rather than throwing', () => {
    const a = numberNode('a', '1');
    const c = chain(['a', 'ghost']);
    expect(() => layoutChain(c, { a }, 'en-US')).not.toThrow();
    expect(layoutChain(c, { a }, 'en-US').ghost).toBeUndefined();
  });
});

describe('layoutChain: members order is the truth (§6.1)', () => {
  test('reordering members reorders the layout', () => {
    const a = numberNode('a', '9999999'); // wide
    const b = numberNode('b', '1'); // narrow, floors at nodeHeight
    const nodes: Record<string, CalcNode> = { a, b };

    const forward = layoutChain(chain(['a', 'b']), nodes, 'en-US');
    expect(forward.a.x).toBe(100);
    expect(forward.b.x).toBe(100 + widthOf(a, 'en-US'));

    const reversed = layoutChain(chain(['b', 'a']), nodes, 'en-US');
    expect(reversed.b.x).toBe(100);
    expect(reversed.a.x).toBe(100 + widthOf(b, 'en-US'));
  });

  test('identical x values on the nodes themselves never reorder anything', () => {
    // Both nodes carry the same (stale/authoritative-looking) position.x going in;
    // layoutChain must ignore node.position entirely and derive order only from
    // chain.members, so a rendering bug in `position` can't change reading order.
    const a: NumberNode = { id: 'a', kind: 'number', raw: '2', position: { x: 42, y: 42 }, chainId: 'c1', createdAt: 0 };
    const b: NumberNode = { id: 'b', kind: 'number', raw: '3', position: { x: 42, y: 42 }, chainId: 'c1', createdAt: 0 };
    const nodes: Record<string, CalcNode> = { a, b };

    const positions = layoutChain(chain(['a', 'b']), nodes, 'en-US');
    expect(positions.a.x).toBe(100);
    expect(positions.b.x).toBe(100 + widthOf(a, 'en-US'));
    expect(positions.a.x).not.toBe(a.position.x);
  });
});

describe('layoutChain: position is a cache, not the source of truth', () => {
  test('the returned positions are independent of the nodes\' prior position field', () => {
    const a = numberNode('a', '5');
    a.position = { x: 9999, y: 9999 };
    const positions = layoutChain(chain(['a']), { a }, 'en-US');
    expect(positions.a).toEqual({ x: 100, y: 200 });
  });
});
