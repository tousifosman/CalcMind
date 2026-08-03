// Domain model. See docs/ARCHITECTURE.md §6.

export type NodeId = string;
export type ChainId = string;

export interface Vec2 {
  x: number;
  y: number;
}

export type OperatorSymbol = '+' | '-' | '×' | '÷';

interface NodeBase {
  id: NodeId;
  /** World coords of the node's top-left.
   *  AUTHORITATIVE when chainId === null.
   *  DERIVED from chain layout when chainId !== null (see §8.1). */
  position: Vec2;
  chainId: ChainId | null;
  createdAt: number;
  /** Short user caption rendered above the cell in the node's identity hue.
   *  On the base rather than on numbers alone: the reference app labels results
   *  and inputs alike, and a label belongs to the identity, not one cell (§11.1). */
  label?: string;
}

export interface NumberNode extends NodeBase {
  kind: 'number';
  /** Exactly what the user typed: "1221", "3.", "-0.5". Parsing is the engine's job,
   *  so partial input like "3." survives a save/load cycle intact. */
  raw: string;
}

export interface OperatorNode extends NodeBase {
  kind: 'operator';
  op: OperatorSymbol;
}

export interface EqualsNode extends NodeBase {
  kind: 'equals';
}

/** Grouping. Present in v1 because Tydlig's keypad has parens and retrofitting a
 *  node kind means a schema migration (§10.2). */
export interface ParenNode extends NodeBase {
  kind: 'paren';
  side: 'open' | 'close';
}

export interface ResultNode extends NodeBase {
  kind: 'result';
  sourceChainId: ChainId;
  /** CACHE ONLY — never trusted. Recomputed on load; lets us paint before the
   *  engine has run and makes saved files human-readable. Engine output always wins. */
  derived?: { display: string; computedAt: string };
}

/** Phase 6. Declared in v1 of the schema so adding linking is not a breaking migration. */
export interface ReferenceNode extends NodeBase {
  kind: 'reference';
  targetNodeId: NodeId;
}

export type CalcNode =
  | NumberNode
  | OperatorNode
  | ParenNode
  | EqualsNode
  | ResultNode
  | ReferenceNode;

export type NodeKind = CalcNode['kind'];

export interface Chain {
  id: ChainId;
  /** Ordered left→right. THIS is the token order — never re-derived from x positions (§6.1). */
  members: NodeId[];
  /** World position of the chain's left edge. The chain's authoritative position. */
  anchor: Vec2;
}

export interface Viewport {
  pan: Vec2;
  zoom: number;
}

export interface CalcDocument {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  viewport: Viewport;
  nodes: Record<NodeId, CalcNode>;
  chains: Record<ChainId, Chain>;
}

export const CURRENT_SCHEMA_VERSION = 1;

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
