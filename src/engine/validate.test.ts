import { validateChain } from './validate';
import type {
  CalcNode,
  Chain,
  EqualsNode,
  NumberNode,
  OperatorNode,
  OperatorSymbol,
  ParenNode,
  ResultNode,
} from '../model/types';
import type { ChainStatus } from './errors';

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

function statusOf(nodes: CalcNode[]): ChainStatus {
  const built = chainOf(nodes);
  return validateChain(built.chain, built.nodes);
}

describe('validateChain', () => {
  test.each([
    {
      name: 'Empty — no members',
      nodes: [] as CalcNode[],
      expected: { status: 'Empty' } satisfies ChainStatus,
    },
    {
      name: 'Incomplete — lone operator (Empty → Incomplete)',
      nodes: [op('o1', '+')],
      expected: { status: 'Incomplete' } satisfies ChainStatus,
    },
    {
      name: 'Incomplete — trailing operator on a started expression (§9)',
      nodes: [number('n1', '3'), op('o1', '+')],
      expected: { status: 'Incomplete' } satisfies ChainStatus,
    },
    {
      name: 'Incomplete — Valid then trailing operator (Valid → Incomplete)',
      nodes: [number('n1', '3'), op('o1', '+'), number('n2', '4'), op('o2', '-')],
      expected: { status: 'Incomplete' } satisfies ChainStatus,
    },
    {
      name: 'Valid — complete sequence "3 + 4"',
      nodes: [number('n1', '3'), op('o1', '+'), number('n2', '4')],
      expected: { status: 'Valid' } satisfies ChainStatus,
    },
    {
      name: 'Valid — single number',
      nodes: [number('n1', '1221')],
      expected: { status: 'Valid' } satisfies ChainStatus,
    },
    {
      name: 'Invalid — adjacent numbers (§9, decision #4)',
      nodes: [number('n1', '12'), number('n2', '34')],
      expected: { status: 'Invalid', boundaryAfter: 0 } satisfies ChainStatus,
    },
    {
      name: 'Invalid — adjacent operators',
      nodes: [number('n1', '3'), op('o1', '+'), op('o2', '×'), number('n2', '4')],
      expected: { status: 'Invalid', boundaryAfter: 1 } satisfies ChainStatus,
    },
    {
      name: 'Invalid — node to the right of the result',
      nodes: [
        number('n1', '3'),
        op('o1', '+'),
        number('n2', '4'),
        equals('e1'),
        result('r1'),
        number('n3', '9'),
      ],
      expected: { status: 'Invalid', boundaryAfter: 4 } satisfies ChainStatus,
    },
    {
      name: 'Incomplete — unbalanced open paren (§10.2)',
      nodes: [paren('p1', 'open'), number('n1', '3'), op('o1', '+'), number('n2', '4')],
      expected: { status: 'Incomplete' } satisfies ChainStatus,
    },
    {
      name: 'Incomplete — unbalanced close paren',
      nodes: [number('n1', '3'), paren('p1', 'close')],
      expected: { status: 'Incomplete' } satisfies ChainStatus,
    },
    {
      name: 'Valid — balanced parens',
      nodes: [
        paren('p1', 'open'),
        number('n1', '3'),
        op('o1', '+'),
        number('n2', '4'),
        paren('p2', 'close'),
      ],
      expected: { status: 'Valid' } satisfies ChainStatus,
    },
    {
      name: 'Valid — implicit multiplication before "("',
      nodes: [
        number('n1', '10000'),
        paren('p1', 'open'),
        number('n2', '1'),
        op('o1', '+'),
        number('n3', '0.04'),
        paren('p2', 'close'),
      ],
      expected: { status: 'Valid' } satisfies ChainStatus,
    },
    {
      name: 'Evaluated — Valid + "="',
      nodes: [number('n1', '3'), op('o1', '+'), number('n2', '4'), equals('e1'), result('r1')],
      expected: { status: 'Evaluated' } satisfies ChainStatus,
    },
    {
      name: 'Evaluated — "=" without result node yet still Evaluated',
      nodes: [number('n1', '3'), op('o1', '+'), number('n2', '4'), equals('e1')],
      expected: { status: 'Evaluated' } satisfies ChainStatus,
    },
    {
      name: 'Incomplete — "=" with trailing operator to its left',
      nodes: [number('n1', '3'), op('o1', '+'), equals('e1')],
      expected: { status: 'Incomplete' } satisfies ChainStatus,
    },
    {
      name: 'Incomplete — bare "="',
      nodes: [equals('e1')],
      expected: { status: 'Incomplete' } satisfies ChainStatus,
    },
    {
      name: 'Incomplete — mid-typing empty raw',
      nodes: [number('n1', '')],
      expected: { status: 'Incomplete' } satisfies ChainStatus,
    },
    {
      name: 'Incomplete — mid-typing bare sign',
      nodes: [number('n1', '-')],
      expected: { status: 'Incomplete' } satisfies ChainStatus,
    },
    {
      name: 'Valid — partial "3." is evaluable',
      nodes: [number('n1', '3.')],
      expected: { status: 'Valid' } satisfies ChainStatus,
    },
    {
      name: 'Valid — negative number from raw, not a unary op',
      nodes: [number('n1', '-5'), op('o1', '+'), number('n2', '2')],
      expected: { status: 'Valid' } satisfies ChainStatus,
    },
  ])('$name', ({ nodes, expected }) => {
    expect(statusOf(nodes)).toEqual(expected);
  });

  test('Invalid deletes nothing — status is a mark, members unchanged', () => {
    const nodes = [number('n1', '12'), number('n2', '34')];
    const built = chainOf(nodes);
    const before = [...built.chain.members];
    const status = validateChain(built.chain, built.nodes);
    expect(status.status).toBe('Invalid');
    expect(built.chain.members).toEqual(before);
    expect(Object.keys(built.nodes).sort()).toEqual(['n1', 'n2']);
  });

  // §9 state-machine transitions that structural validation can observe.
  test('§9 transitions: Empty → Incomplete → Valid → Incomplete → Invalid → Valid → Evaluated', () => {
    expect(statusOf([])).toEqual({ status: 'Empty' });
    expect(statusOf([number('n1', '3'), op('o1', '+')])).toEqual({ status: 'Incomplete' });
    expect(statusOf([number('n1', '3'), op('o1', '+'), number('n2', '4')])).toEqual({
      status: 'Valid',
    });
    expect(
      statusOf([number('n1', '3'), op('o1', '+'), number('n2', '4'), op('o2', '-')]),
    ).toEqual({ status: 'Incomplete' });
    expect(statusOf([number('n1', '3'), number('n2', '4')])).toEqual({
      status: 'Invalid',
      boundaryAfter: 0,
    });
    // Invalid → Valid by removing the offender
    expect(statusOf([number('n1', '3')])).toEqual({ status: 'Valid' });
    expect(statusOf([number('n1', '3'), equals('e1'), result('r1')])).toEqual({
      status: 'Evaluated',
    });
  });
});
