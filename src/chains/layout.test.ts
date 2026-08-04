import { insertionFeedback, layoutChain } from './layout';
import { widthOf } from './measure';
import type { SnapOutcome } from './snapping';
import type { CalcNode, Chain, NumberNode, OperatorNode } from '../model/types';
import { tokens } from '../ui/tokens';

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

describe('insertionFeedback: mid-drag gap + caret (§8.3)', () => {
  const locale = 'en-US';

  function freeNumber(id: string, raw: string, x: number, y = 40): NumberNode {
    return { id, kind: 'number', raw, position: { x, y }, chainId: null, createdAt: 0 };
  }

  function chained(id: string, raw: string, x: number, y = 40): NumberNode {
    return { id, kind: 'number', raw, position: { x, y }, chainId: 'c1', createdAt: 0 };
  }

  function seededChain(): {
    nodes: Record<string, CalcNode>;
    chains: Record<string, Chain>;
    dragged: NumberNode;
  } {
    const a = chained('a', '12', 100);
    const op = operatorNode('op');
    op.position = { x: 100 + widthOf(a, locale), y: 40 };
    const b = chained('b', '3', op.position.x + widthOf(op, locale));
    const dragged = freeNumber('d', '99', 0);
    const c = chain(['a', 'op', 'b'], { x: 100, y: 40 });
    return {
      nodes: { a, op, b, d: dragged },
      chains: { c1: c },
      dragged,
    };
  }

  test('null candidate clears caret and offsets — gap closes with no residual', () => {
    const { nodes, chains, dragged } = seededChain();
    expect(insertionFeedback(null, dragged, chains, nodes, locale)).toEqual({
      caret: null,
      offsets: {},
    });
  });

  test('prepend: caret left of the chain by gap width; members stay put', () => {
    const { nodes, chains, dragged } = seededChain();
    const gap = widthOf(dragged, locale);
    const feedback = insertionFeedback(
      { kind: 'prepend', chainId: 'c1' },
      dragged,
      chains,
      nodes,
      locale,
    );
    expect(feedback.offsets).toEqual({});
    expect(feedback.caret).toEqual({
      x: 100 - gap,
      y: 40,
      width: Math.max(tokens.borderBand, 4),
      height: tokens.nodeHeight,
    });
  });

  test('append: caret at the chain right edge; members stay put', () => {
    const { nodes, chains, dragged } = seededChain();
    const right =
      100 +
      widthOf(nodes.a, locale) +
      widthOf(nodes.op, locale) +
      widthOf(nodes.b, locale);
    const feedback = insertionFeedback(
      { kind: 'append', chainId: 'c1' },
      dragged,
      chains,
      nodes,
      locale,
    );
    expect(feedback.offsets).toEqual({});
    expect(feedback.caret?.x).toBe(right);
    expect(feedback.caret?.y).toBe(40);
  });

  test('insert: members at index and after shift right by gap; caret at old boundary', () => {
    const { nodes, chains, dragged } = seededChain();
    const gap = widthOf(dragged, locale);
    const boundary = 100 + widthOf(nodes.a, locale); // between a and op
    const feedback = insertionFeedback(
      { kind: 'insert', chainId: 'c1', index: 1 },
      dragged,
      chains,
      nodes,
      locale,
    );
    expect(feedback.offsets).toEqual({ op: { x: gap, y: 0 }, b: { x: gap, y: 0 } });
    expect(feedback.offsets.a).toBeUndefined();
    expect(feedback.caret).toEqual({
      x: boundary,
      y: 40,
      width: Math.max(tokens.borderBand, 4),
      height: tokens.nodeHeight,
    });
  });

  test('insert at index 0 matches prepend geometry (gap on the left)', () => {
    const { nodes, chains, dragged } = seededChain();
    const gap = widthOf(dragged, locale);
    const feedback = insertionFeedback(
      { kind: 'insert', chainId: 'c1', index: 0 },
      dragged,
      chains,
      nodes,
      locale,
    );
    expect(feedback.offsets).toEqual({});
    expect(feedback.caret?.x).toBe(100 - gap);
  });

  test('newChain with dragged on the right: partner stays, caret at its right edge', () => {
    const partner = freeNumber('p', '5', 200);
    const dragged = freeNumber('d', '7', 280);
    const nodes = { p: partner, d: dragged };
    const feedback = insertionFeedback(
      { kind: 'newChain', leftId: 'p', rightId: 'd' },
      dragged,
      {},
      nodes,
      locale,
    );
    expect(feedback.offsets).toEqual({});
    expect(feedback.caret?.x).toBe(200 + widthOf(partner, locale));
    expect(feedback.caret?.y).toBe(40);
  });

  test('newChain with dragged on the left: partner previews at live + gap, not home + gap', () => {
    // Store home is far from the live drag point — the bug this catches used home and
    // jumped on commit (PR #63 review). live = (120, 55); partner home = (200, 40).
    const partner = freeNumber('p', '5', 200, 40);
    const dragged = freeNumber('d', '7', 0, 0); // store home; live passed separately
    const live = { x: 120, y: 55 };
    const nodes = { p: partner, d: dragged };
    const gap = widthOf(dragged, locale);
    const feedback = insertionFeedback(
      { kind: 'newChain', leftId: 'd', rightId: 'p' },
      dragged,
      {},
      nodes,
      locale,
      live,
    );
    expect(feedback.offsets).toEqual({
      p: { x: live.x + gap - partner.position.x, y: live.y - partner.position.y },
    });
    expect(feedback.caret?.x).toBe(live.x + gap);
    expect(feedback.caret?.y).toBe(live.y);
  });

  test('newChain dragged-left preview matches formNewChain commit geometry', () => {
    // Cross-check: the partner's previewed world position equals what layout writes
    // after commitSnapOutcome with the same live release point.
    const partner = freeNumber('p', '5', 200);
    const dragged = freeNumber('d', '7', 0);
    const live = { x: 120, y: 40 };
    const gap = widthOf(dragged, locale);
    const feedback = insertionFeedback(
      { kind: 'newChain', leftId: 'd', rightId: 'p' },
      dragged,
      {},
      { p: partner, d: dragged },
      locale,
      live,
    );
    const previewedPartner = {
      x: partner.position.x + feedback.offsets.p!.x,
      y: partner.position.y + feedback.offsets.p!.y,
    };
    // formNewChain anchors at live and lays the right member at live.x + width(left).
    expect(previewedPartner).toEqual({ x: live.x + gap, y: live.y });
    expect(feedback.caret?.x).toBe(previewedPartner.x);
  });

  test('unknown chain id yields empty feedback rather than throwing', () => {
    const dragged = freeNumber('d', '1', 0);
    const outcome: SnapOutcome = { kind: 'append', chainId: 'missing' };
    expect(insertionFeedback(outcome, dragged, {}, { d: dragged }, locale)).toEqual({
      caret: null,
      offsets: {},
    });
  });
});
