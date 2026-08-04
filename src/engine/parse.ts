// Precedence-climbing parser. See docs/ARCHITECTURE.md §10.2.
//
// Structured so `^`, prefix/postfix operators and function application can be added later
// without restructuring — parsePrefix / parsePostfix / parsePrimary are the extension
// seams. Do not implement those extensions here.
import type { Token } from './tokenize';
import type { NodeId, OperatorSymbol } from '../model/types';

export type NumberExpr = { kind: 'number'; raw: string; nodeId: NodeId };
export type ReferenceExpr = { kind: 'reference'; targetNodeId: NodeId; nodeId: NodeId };
export type BinaryExpr = {
  kind: 'binary';
  op: OperatorSymbol;
  left: Expr;
  right: Expr;
};

export type Expr = NumberExpr | ReferenceExpr | BinaryExpr;

const PREC_ADD = 1;
const PREC_MUL = 2;

function infixPrec(op: OperatorSymbol): number {
  return op === '+' || op === '-' ? PREC_ADD : PREC_MUL;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Tokens → AST. Caller must only pass a sequence validateChain already classified as
 * Valid or Evaluated — this parser assumes balanced parens and a complete expression.
 */
export function parse(tokens: Token[]): Expr {
  if (tokens.length === 0) {
    throw new ParseError('parse: empty token stream');
  }
  const ctx = { tokens, i: 0 };
  const expr = parseExpr(ctx, 0);
  if (ctx.i !== tokens.length) {
    throw new ParseError(`parse: trailing token at ${ctx.i}`);
  }
  return expr;
}

type Ctx = { tokens: Token[]; i: number };

function peek(ctx: Ctx): Token | undefined {
  return ctx.tokens[ctx.i];
}

function advance(ctx: Ctx): Token {
  const t = ctx.tokens[ctx.i];
  if (t === undefined) {
    throw new ParseError('parse: unexpected end of tokens');
  }
  ctx.i += 1;
  return t;
}

/** Precedence climbing over infix operators and the narrow implicit-mul rule. */
function parseExpr(ctx: Ctx, minPrec: number): Expr {
  let left = parsePrefix(ctx);

  for (;;) {
    const next = peek(ctx);
    if (next === undefined) {
      break;
    }

    // Implicit multiplication only before '(' (§10.2, decision #4).
    if (next.kind === 'paren' && next.side === 'open') {
      if (PREC_MUL < minPrec) {
        break;
      }
      const right = parseExpr(ctx, PREC_MUL + 1);
      left = { kind: 'binary', op: '×', left, right };
      continue;
    }

    if (next.kind !== 'operator') {
      break;
    }
    const prec = infixPrec(next.op);
    if (prec < minPrec) {
      break;
    }
    advance(ctx); // consume the operator we peeked
    const op = next.op;
    // Left-associative: recurse at prec + 1.
    const right = parseExpr(ctx, prec + 1);
    left = { kind: 'binary', op, left, right };
  }

  return left;
}

/**
 * Prefix level. Today this is only a passthrough to postfix; a future unary minus /
 * `√` binds here (§10.2 extension path).
 */
function parsePrefix(ctx: Ctx): Expr {
  return parsePostfix(ctx);
}

/**
 * Postfix level. Today this is only a passthrough to primary; a future `!` / `²`
 * loops here (§10.2 extension path).
 */
function parsePostfix(ctx: Ctx): Expr {
  return parsePrimary(ctx);
}

/**
 * Primary: number | reference | '(' expr ')' | (future: function '(' expr ')').
 */
function parsePrimary(ctx: Ctx): Expr {
  const token = advance(ctx);

  if (token.kind === 'number') {
    return { kind: 'number', raw: token.raw, nodeId: token.nodeId };
  }
  if (token.kind === 'reference') {
    return {
      kind: 'reference',
      targetNodeId: token.targetNodeId,
      nodeId: token.nodeId,
    };
  }
  if (token.kind === 'paren' && token.side === 'open') {
    const inner = parseExpr(ctx, 0);
    const close = advance(ctx);
    if (close.kind !== 'paren' || close.side !== 'close') {
      throw new ParseError('parse: expected closing paren');
    }
    return inner;
  }

  throw new ParseError(`parse: expected primary, got ${token.kind}`);
}
