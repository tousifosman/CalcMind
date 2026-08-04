// Tokeniser: chain.members → token stream. See docs/ARCHITECTURE.md §10.1 and §6.1.
//
// Reads members in stored order — never sorted by position. Drops '=' and the result node;
// keeps numbers, operators, parens and references. Partial raw like "3." tokenises without
// throwing; turning raw into a value is evaluate's job.
import type {
  CalcNode,
  Chain,
  NodeId,
  OperatorSymbol,
  ParenSide,
} from '../model/types';

export type NumberToken = {
  kind: 'number';
  raw: string;
  nodeId: NodeId;
};

export type OperatorToken = {
  kind: 'operator';
  op: OperatorSymbol;
  nodeId: NodeId;
};

export type ParenToken = {
  kind: 'paren';
  side: ParenSide;
  nodeId: NodeId;
};

export type ReferenceToken = {
  kind: 'reference';
  targetNodeId: NodeId;
  nodeId: NodeId;
};

export type Token = NumberToken | OperatorToken | ParenToken | ReferenceToken;

/** True for node kinds the tokeniser keeps. Equals and result are dropped (§10.1). */
export function isExpressionNode(
  node: CalcNode,
): node is Extract<CalcNode, { kind: 'number' | 'operator' | 'paren' | 'reference' }> {
  return (
    node.kind === 'number' ||
    node.kind === 'operator' ||
    node.kind === 'paren' ||
    node.kind === 'reference'
  );
}

/**
 * Turn a chain's members into the token stream the parser consumes. Order is
 * `chain.members` as stored (§6.1) — never recovered from `position.x`.
 */
export function tokenize(chain: Chain, nodes: Record<NodeId, CalcNode>): Token[] {
  const tokens: Token[] = [];
  for (const id of chain.members) {
    const node = nodes[id];
    if (node === undefined) {
      throw new Error(`tokenize: missing node ${id}`);
    }
    if (node.kind === 'equals' || node.kind === 'result') {
      continue;
    }
    tokens.push(nodeToToken(node));
  }
  return tokens;
}

export function nodeToToken(
  node: Extract<CalcNode, { kind: 'number' | 'operator' | 'paren' | 'reference' }>,
): Token {
  switch (node.kind) {
    case 'number':
      return { kind: 'number', raw: node.raw, nodeId: node.id };
    case 'operator':
      return { kind: 'operator', op: node.op, nodeId: node.id };
    case 'paren':
      return { kind: 'paren', side: node.side, nodeId: node.id };
    case 'reference':
      return { kind: 'reference', targetNodeId: node.targetNodeId, nodeId: node.id };
  }
}
