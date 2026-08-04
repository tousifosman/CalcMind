// Sequence validation: token stream + chain shape → exactly one §9 status.
// See docs/ARCHITECTURE.md §9 and §10.2.
//
// Structural rules only. Stale / ErrorState are lifecycle statuses applied after evaluation
// (P4.7–P4.8); this module still exports them on the ChainStatus union so callers share one type.
import { isExpressionNode, nodeToToken, type Token } from './tokenize';
import type { ChainStatus } from './errors';
import type { CalcNode, Chain, NodeId } from '../model/types';

/**
 * Classify a chain into exactly one §9 state from its member sequence.
 *
 * - Trailing operator → Incomplete (normal mid-typing), never an error.
 * - Unbalanced parens → Incomplete, not Invalid (§10.2).
 * - Adjacent numbers or adjacent operators → Invalid; nothing is deleted.
 * - Anything to the right of the result → Invalid.
 * - Valid expression with `=` → Evaluated; without → Valid.
 */
export function validateChain(chain: Chain, nodes: Record<NodeId, CalcNode>): ChainStatus {
  if (chain.members.length === 0) {
    return { status: 'Empty' };
  }

  const afterResult = nodeAfterResult(chain, nodes);
  if (afterResult !== null) {
    return { status: 'Invalid', boundaryAfter: afterResult };
  }

  const { expressionMemberIndexes, hasEquals } = splitExpressionMembers(chain, nodes);
  if (expressionMemberIndexes.length === 0) {
    // Bare `=` / `=`+result, or only non-expression junk already caught above.
    return { status: 'Incomplete' };
  }

  const tokens: Token[] = [];
  for (const idx of expressionMemberIndexes) {
    const id = chain.members[idx];
    const node = nodes[id];
    if (node === undefined) {
      throw new Error(`validateChain: missing node ${id}`);
    }
    if (!isExpressionNode(node)) {
      throw new Error(`validateChain: unexpected ${node.kind} in expression slice`);
    }
    tokens.push(nodeToToken(node));
  }

  const sequence = validateTokenSequence(tokens, expressionMemberIndexes);
  if (sequence.status === 'Invalid' || sequence.status === 'Incomplete') {
    return sequence;
  }

  // sequence is Valid
  return hasEquals ? { status: 'Evaluated' } : { status: 'Valid' };
}

/** Member index of the node before a hairline to the right of a result, or null. */
function nodeAfterResult(chain: Chain, nodes: Record<NodeId, CalcNode>): number | null {
  let resultIndex = -1;
  for (let i = 0; i < chain.members.length; i++) {
    const node = nodes[chain.members[i]];
    if (node?.kind === 'result') {
      resultIndex = i;
      break;
    }
  }
  if (resultIndex >= 0 && resultIndex < chain.members.length - 1) {
    return resultIndex;
  }
  return null;
}

/**
 * Expression members are everything before the first `=`, excluding any result.
 * `hasEquals` is whether an equals node is present at all.
 */
function splitExpressionMembers(
  chain: Chain,
  nodes: Record<NodeId, CalcNode>,
): { expressionMemberIndexes: number[]; hasEquals: boolean } {
  const expressionMemberIndexes: number[] = [];
  let hasEquals = false;
  for (let i = 0; i < chain.members.length; i++) {
    const node = nodes[chain.members[i]];
    if (node === undefined) {
      throw new Error(`validateChain: missing node ${chain.members[i]}`);
    }
    if (node.kind === 'equals') {
      hasEquals = true;
      break;
    }
    if (node.kind === 'result') {
      break;
    }
    expressionMemberIndexes.push(i);
  }
  return { expressionMemberIndexes, hasEquals };
}

type Expecting = 'operand' | 'operator';

/**
 * Walk the expression tokens. `memberIndexes[i]` is the chain.members index of `tokens[i]`,
 * so Invalid boundaries are reported in member space.
 */
function validateTokenSequence(
  tokens: Token[],
  memberIndexes: number[],
): Extract<ChainStatus, { status: 'Valid' | 'Incomplete' | 'Invalid' }> {
  let depth = 0;
  let expecting: Expecting = 'operand';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.kind === 'paren' && token.side === 'open') {
      if (expecting === 'operator') {
        // Implicit multiplication before '(' (§10.2) — stays Valid so far.
        expecting = 'operand';
      }
      depth += 1;
      continue;
    }

    if (token.kind === 'paren' && token.side === 'close') {
      if (expecting === 'operand') {
        // `)` where a term was required — mid-typing an empty group, or a stray close.
        return { status: 'Incomplete' };
      }
      depth -= 1;
      if (depth < 0) {
        return { status: 'Incomplete' };
      }
      expecting = 'operator';
      continue;
    }

    if (token.kind === 'operator') {
      if (expecting === 'operand') {
        // At the very start, a lone/leading operator is the Empty→Incomplete transition
        // (§9), not a hairline. Two operators in a row (i > 0) are Invalid.
        if (i === 0) {
          return { status: 'Incomplete' };
        }
        return {
          status: 'Invalid',
          boundaryAfter: memberIndexes[i - 1],
        };
      }
      expecting = 'operand';
      continue;
    }

    // number | reference — an operand
    if (expecting === 'operator') {
      // Two adjacent numbers/references. Not implicit multiplication (§9, decision #4).
      return { status: 'Invalid', boundaryAfter: memberIndexes[i - 1] };
    }
    if (token.kind === 'number' && !isEvaluableRaw(token.raw)) {
      // "", "-", "." mid-typing — Incomplete rather than Invalid.
      return { status: 'Incomplete' };
    }
    expecting = 'operator';
  }

  if (depth !== 0) {
    return { status: 'Incomplete' };
  }
  if (expecting === 'operand') {
    // Trailing operator, or empty expression — Incomplete (§9).
    return { status: 'Incomplete' };
  }
  return { status: 'Valid' };
}

/** Raw that Decimal can turn into a finite value — excludes mid-typing stubs. */
export function isEvaluableRaw(raw: string): boolean {
  if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
    return false;
  }
  // Canonical raw is digits with at most one '.'; reject anything else defensively.
  if (!/^-?\d*\.?\d*$/.test(raw)) {
    return false;
  }
  // Must contain at least one digit.
  return /\d/.test(raw);
}
