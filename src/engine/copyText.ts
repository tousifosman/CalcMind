// §8.6 `Copy` / `Copy As`: text a cell (or a selected group) hands to the system
// clipboard. Kept as pure engine-level string building — no clipboard access here,
// that side effect belongs to the store command that calls this (§8.6, commands.ts).
//
// "The value of the cell" only means something for the three kinds that actually carry
// one — number, result, reference — so this reuses each kind's own display-content
// function (the same one its node component renders) rather than re-deriving the text.
// Operator / paren / equals have no value of their own; `copyTextForNode` returns `null`
// for them and the context menu disables `Copy` accordingly.
import { formatForDisplay } from './format';
import { resultCellContent } from './errors';
import { referenceCellContent } from './reference';
import type { CalcNode, Chain, NodeId } from '../model/types';

/** The copyable text for a single cell's value, or `null` when this kind has none
 *  (operator / paren / equals) or the value isn't in a copyable state yet (an empty or
 *  errored result). A `stale` result and a `dangling` reference still copy their last
 *  known text — both are genuine, just not current. */
export function copyTextForNode(
  nodeId: NodeId,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
): string | null {
  const node = nodes[nodeId];
  if (!node) return null;
  switch (node.kind) {
    case 'number':
      return formatForDisplay(node.raw, locale);
    case 'result': {
      const content = resultCellContent(node.derived);
      return content.mode === 'value' || content.mode === 'stale' ? content.text : null;
    }
    case 'reference':
      return referenceCellContent(node, nodes, locale).text || null;
    default:
      return null;
  }
}

/** One chain member's glyph in a `Copy As` → `Copy without result` string — the same
 *  text each node kind renders on its own cell, so the copied formula reads like the
 *  one on screen. `number` and `reference` reuse {@link copyTextForNode}; operators and
 *  parens have no "value" to copy in isolation but do have a fixed glyph here since
 *  they're part of the formula's shape, not its answer. */
function memberGlyph(node: CalcNode, nodes: Record<NodeId, CalcNode>, locale: string): string | null {
  switch (node.kind) {
    case 'number':
    case 'reference':
      return copyTextForNode(node.id, nodes, locale);
    case 'operator':
      return node.op;
    case 'paren':
      return node.side === 'open' ? '(' : ')';
    // `equals` and `result` are dropped entirely — see chainTextWithoutResult below.
    default:
      return null;
  }
}

/** A chain's formula as plain text, `=` and its result dropped — `Copy As` → `Copy
 *  without result` (§8.6). `12 + 5 = 17` copies as `12 + 5`, not `12 + 5 =`: a dangling
 *  trailing `=` with nothing after it isn't a useful thing to have pasted elsewhere. */
export function chainTextWithoutResult(
  chain: Chain,
  nodes: Record<NodeId, CalcNode>,
  locale: string,
): string {
  const parts: string[] = [];
  for (const id of chain.members) {
    const node = nodes[id];
    if (!node || node.kind === 'equals' || node.kind === 'result') continue;
    const glyph = memberGlyph(node, nodes, locale);
    // An empty string is a real return (a number mid-typing, raw === '') but not a
    // useful token to join in — same reasoning as skipping `null` for a valueless kind.
    if (glyph) parts.push(glyph);
  }
  return parts.join(' ');
}
