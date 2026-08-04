import { nanoid } from 'nanoid';
import {
  CalcDocument,
  CURRENT_SCHEMA_VERSION,
  NodeId,
  ChainId,
  Vec2,
  NumberNode,
  OperatorNode,
  OperatorSymbol,
  ParenNode,
  ParenSide,
  EqualsNode,
  ResultNode,
} from './types';

export function createNodeId(): NodeId {
  return `n_${nanoid()}`;
}

export function createChainId(): ChainId {
  return `c_${nanoid()}`;
}

export function createDocumentId(): string {
  return `doc_${nanoid()}`;
}

export function createEmptyDocument(name = 'Untitled'): CalcDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: createDocumentId(),
    name,
    createdAt: now,
    updatedAt: now,
    viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
    nodes: {},
    chains: {},
  };
}

// Node factories build freestanding nodes: chainId: null, position authoritative
// (§6). Callers own placing the result in a document via a command.

export function createNumberNode(position: Vec2, raw: string): NumberNode {
  return {
    id: createNodeId(),
    kind: 'number',
    position,
    chainId: null,
    createdAt: Date.now(),
    raw,
  };
}

export function createOperatorNode(position: Vec2, op: OperatorSymbol): OperatorNode {
  return {
    id: createNodeId(),
    kind: 'operator',
    position,
    chainId: null,
    createdAt: Date.now(),
    op,
  };
}

export function createParenNode(position: Vec2, side: ParenSide): ParenNode {
  return {
    id: createNodeId(),
    kind: 'paren',
    position,
    chainId: null,
    createdAt: Date.now(),
    side,
  };
}

export function createEqualsNode(position: Vec2): EqualsNode {
  return {
    id: createNodeId(),
    kind: 'equals',
    position,
    chainId: null,
    createdAt: Date.now(),
  };
}

/** Result nodes are derived (§6): callers set `sourceChainId` and write `derived` as a
 *  cache from the engine. Position is a layout cache once the node is a chain member. */
export function createResultNode(position: Vec2, sourceChainId: ChainId): ResultNode {
  return {
    id: createNodeId(),
    kind: 'result',
    position,
    chainId: null,
    createdAt: Date.now(),
    sourceChainId,
  };
}
