import { tokenize, type Token } from './tokenize';
import type {
  CalcNode,
  Chain,
  EqualsNode,
  NumberNode,
  OperatorNode,
  OperatorSymbol,
  ParenNode,
  ReferenceNode,
  ResultNode,
} from '../model/types';

const ORIGIN = { x: 0, y: 0 };

function number(id: string, raw: string): NumberNode {
  return { id, kind: 'number', raw, position: ORIGIN, chainId: 'c1', createdAt: 0 };
}

function op(id: string, symbol: OperatorSymbol): OperatorNode {
  return { id, kind: 'operator', op: symbol, position: ORIGIN, chainId: 'c1', createdAt: 0 };
}

function paren(id: string, side: 'open' | 'close'): ParenNode {
  return { id, kind: 'paren', side, position: ORIGIN, chainId: 'c1', createdAt: 0 };
}

function equals(id: string): EqualsNode {
  return { id, kind: 'equals', position: ORIGIN, chainId: 'c1', createdAt: 0 };
}

function result(id: string): ResultNode {
  return {
    id,
    kind: 'result',
    position: ORIGIN,
    chainId: 'c1',
    createdAt: 0,
    sourceChainId: 'c1',
  };
}

function reference(id: string, targetNodeId: string): ReferenceNode {
  return {
    id,
    kind: 'reference',
    targetNodeId,
    position: ORIGIN,
    chainId: 'c1',
    createdAt: 0,
  };
}

/** Build a chain + node map from an ordered list of nodes. Members follow insertion order. */
function chainOf(nodes: CalcNode[]): { chain: Chain; nodes: Record<string, CalcNode> } {
  const map: Record<string, CalcNode> = {};
  for (const n of nodes) {
    map[n.id] = n;
  }
  return {
    chain: { id: 'c1', anchor: ORIGIN, members: nodes.map((n) => n.id) },
    nodes: map,
  };
}

describe('tokenize', () => {
  test('reads members in stored order, never sorted by position', () => {
    // Deliberately reverse the positions relative to member order (§6.1).
    const a = number('a', '1');
    a.position = { x: 100, y: 0 };
    const b = op('b', '+');
    b.position = { x: 50, y: 0 };
    const c = number('c', '2');
    c.position = { x: 0, y: 0 };
    const { chain, nodes } = chainOf([a, b, c]);

    expect(tokenize(chain, nodes).map((t) => t.nodeId)).toEqual(['a', 'b', 'c']);
  });

  test.each([
    {
      name: 'drops equals and result',
      nodes: [number('n1', '1221'), op('o1', '+'), number('n2', '3'), equals('e1'), result('r1')],
      expected: [
        { kind: 'number', raw: '1221', nodeId: 'n1' },
        { kind: 'operator', op: '+', nodeId: 'o1' },
        { kind: 'number', raw: '3', nodeId: 'n2' },
      ] satisfies Token[],
    },
    {
      name: 'keeps parens',
      nodes: [
        number('n1', '2'),
        op('o1', '×'),
        paren('p1', 'open'),
        number('n2', '3'),
        op('o2', '+'),
        number('n3', '4'),
        paren('p2', 'close'),
      ],
      expected: [
        { kind: 'number', raw: '2', nodeId: 'n1' },
        { kind: 'operator', op: '×', nodeId: 'o1' },
        { kind: 'paren', side: 'open', nodeId: 'p1' },
        { kind: 'number', raw: '3', nodeId: 'n2' },
        { kind: 'operator', op: '+', nodeId: 'o2' },
        { kind: 'number', raw: '4', nodeId: 'n3' },
        { kind: 'paren', side: 'close', nodeId: 'p2' },
      ] satisfies Token[],
    },
    {
      name: 'keeps references',
      nodes: [reference('ref1', 'target'), op('o1', '×'), number('n1', '2')],
      expected: [
        { kind: 'reference', targetNodeId: 'target', nodeId: 'ref1' },
        { kind: 'operator', op: '×', nodeId: 'o1' },
        { kind: 'number', raw: '2', nodeId: 'n1' },
      ] satisfies Token[],
    },
    {
      name: 'partial raw "3." tokenises without throwing',
      nodes: [number('n1', '3.')],
      expected: [{ kind: 'number', raw: '3.', nodeId: 'n1' }] satisfies Token[],
    },
    {
      name: 'empty chain yields empty token stream',
      nodes: [] as CalcNode[],
      expected: [] satisfies Token[],
    },
    {
      name: 'equals-only chain yields empty token stream',
      nodes: [equals('e1'), result('r1')],
      expected: [] satisfies Token[],
    },
  ])('$name', ({ nodes, expected }) => {
    const built = chainOf(nodes);
    expect(tokenize(built.chain, built.nodes)).toEqual(expected);
  });

  test('negative number raw is preserved on the token', () => {
    const built = chainOf([number('n1', '-5')]);
    expect(tokenize(built.chain, built.nodes)).toEqual([
      { kind: 'number', raw: '-5', nodeId: 'n1' },
    ]);
  });
});
