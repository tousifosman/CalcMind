import { parse, type Expr } from './parse';
import { tokenize } from './tokenize';
import type {
  CalcNode,
  Chain,
  NumberNode,
  OperatorNode,
  OperatorSymbol,
  ParenNode,
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

function parseNodes(nodes: CalcNode[]): Expr {
  const built = chainOf(nodes);
  return parse(tokenize(built.chain, built.nodes));
}

describe('parse', () => {
  test('2 + 3 × 4 binds multiplication tighter (left-assoc add/mul)', () => {
    // 2 + 3 × 4 = 14 — AST must be +(2, ×(3, 4)), not ×(+(2, 3), 4)
    const ast = parseNodes([
      number('n1', '2'),
      op('o1', '+'),
      number('n2', '3'),
      op('o2', '×'),
      number('n3', '4'),
    ]);
    expect(ast).toEqual({
      kind: 'binary',
      op: '+',
      left: { kind: 'number', raw: '2', nodeId: 'n1' },
      right: {
        kind: 'binary',
        op: '×',
        left: { kind: 'number', raw: '3', nodeId: 'n2' },
        right: { kind: 'number', raw: '4', nodeId: 'n3' },
      },
    });
  });

  test('2 × (3 + 4) groups the addition', () => {
    const ast = parseNodes([
      number('n1', '2'),
      op('o1', '×'),
      paren('p1', 'open'),
      number('n2', '3'),
      op('o2', '+'),
      number('n3', '4'),
      paren('p2', 'close'),
    ]);
    expect(ast).toEqual({
      kind: 'binary',
      op: '×',
      left: { kind: 'number', raw: '2', nodeId: 'n1' },
      right: {
        kind: 'binary',
        op: '+',
        left: { kind: 'number', raw: '3', nodeId: 'n2' },
        right: { kind: 'number', raw: '4', nodeId: 'n3' },
      },
    });
  });

  test('implicit multiplication only before "("', () => {
    const ast = parseNodes([
      number('n1', '10000'),
      paren('p1', 'open'),
      number('n2', '1'),
      op('o1', '+'),
      number('n3', '0.04'),
      paren('p2', 'close'),
    ]);
    expect(ast).toEqual({
      kind: 'binary',
      op: '×',
      left: { kind: 'number', raw: '10000', nodeId: 'n1' },
      right: {
        kind: 'binary',
        op: '+',
        left: { kind: 'number', raw: '1', nodeId: 'n2' },
        right: { kind: 'number', raw: '0.04', nodeId: 'n3' },
      },
    });
  });

  test('left-associative subtraction: 10 − 3 − 2 → (10 − 3) − 2', () => {
    const ast = parseNodes([
      number('n1', '10'),
      op('o1', '-'),
      number('n2', '3'),
      op('o2', '-'),
      number('n3', '2'),
    ]);
    expect(ast).toEqual({
      kind: 'binary',
      op: '-',
      left: {
        kind: 'binary',
        op: '-',
        left: { kind: 'number', raw: '10', nodeId: 'n1' },
        right: { kind: 'number', raw: '3', nodeId: 'n2' },
      },
      right: { kind: 'number', raw: '2', nodeId: 'n3' },
    });
  });

  test('negative numbers come from NumberNode.raw, not a unary operator', () => {
    const ast = parseNodes([number('n1', '-5'), op('o1', '+'), number('n2', '2')]);
    expect(ast).toEqual({
      kind: 'binary',
      op: '+',
      left: { kind: 'number', raw: '-5', nodeId: 'n1' },
      right: { kind: 'number', raw: '2', nodeId: 'n2' },
    });
  });

  test('division same precedence as multiplication, left-associative', () => {
    const ast = parseNodes([
      number('n1', '8'),
      op('o1', '÷'),
      number('n2', '2'),
      op('o2', '×'),
      number('n3', '3'),
    ]);
    expect(ast).toEqual({
      kind: 'binary',
      op: '×',
      left: {
        kind: 'binary',
        op: '÷',
        left: { kind: 'number', raw: '8', nodeId: 'n1' },
        right: { kind: 'number', raw: '2', nodeId: 'n2' },
      },
      right: { kind: 'number', raw: '3', nodeId: 'n3' },
    });
  });
});
