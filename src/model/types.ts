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

export type ParenSide = 'open' | 'close';

/** Grouping. Present in v1 because Tydlig's keypad has parens and retrofitting a
 *  node kind means a schema migration (§10.2). */
export interface ParenNode extends NodeBase {
  kind: 'paren';
  side: ParenSide;
}

export interface ResultNode extends NodeBase {
  kind: 'result';
  sourceChainId: ChainId;
  /** CACHE ONLY — never trusted, never written. Recomputed on load and after every
   *  edit; the serialiser strips it (§12.3). A file that still carries one (hand-edit)
   *  is overwritten by the engine, which always wins. */
  derived?: ResultDerived;
}

/** What the result cell last painted (§9, §10.4). `display` is the numeric string when the
 *  outcome was a value (or the previous value kept under `stale`); an `error` outcome is
 *  rendered as an explanation, not as `display` and never as a bare glyph (§11.2). */
export interface ResultDerived {
  display: string;
  computedAt: string;
  /** Absent → successful value. Written by the recompute lifecycle (P4.7–P4.8). */
  outcome?: ResultOutcome;
}

export type ResultOutcome =
  | { status: 'stale' }
  | { status: 'error'; error: EngineErrorKind };

/** The six error kinds §10.4 lists. Also the `error` discriminant on `ResultOutcome`. */
export type EngineErrorKind =
  | 'Incomplete'
  | 'InvalidSequence'
  | 'DivideByZero'
  | 'Overflow'
  | 'NotANumber'
  | 'CircularReference';

/** Phase 6. Declared in v1 of the schema so adding linking is not a breaking migration. */
export interface ReferenceNode extends NodeBase {
  kind: 'reference';
  targetNodeId: NodeId;
  /**
   * Display string captured when the target was deleted (§11.2 / P6.4). Present on a
   * dangling reference so the cell can show the last known value struck-through rather
   * than a bare `?`. Cleared when the reference is re-pointed. Optional so documents
   * written before P6.4 and live (non-dangling) references stay valid without a
   * schema bump — absence means "no stamp yet," not "empty value."
   */
  lastKnownDisplay?: string;
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
